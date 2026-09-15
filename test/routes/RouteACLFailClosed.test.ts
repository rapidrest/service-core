///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// End-to-end check, against a real `acl` datastore, that a `@Protect`-ed route never registers without its
// permission check. The exploit: an attacker removed a route's user-editable ACL (uid = the route class name), and
// after a restart `ACLUtils.saveDefaultACL()` returned null, so `RouteUtils.registerRoute()` skipped the permission
// middleware and anonymous `GET /victim/secret` returned 200.
import { default as config } from "../config";
import { Logger } from "@rapidrest/core";
import { MongoMemoryServer } from "mongodb-memory-server";
import { ACLUtils, ObjectFactory, RouteUtils, Server } from "../../src";
import { Get, Protect, Route } from "../../src/decorators/RouteDecorators";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
    },
});

@Route("/victim")
@Protect()
class VictimFailClosedRoute {
    public called: number = 0;

    @Get("secret")
    public secret() {
        this.called++;
        return { secret: true };
    }
}

/** A stand-in router that records the middleware chain registered for each verb and path. */
function makeApp() {
    const registered: Record<string, any[]> = {};
    const verb =
        (name: string) =>
        (path: string, ...handlers: any[]) => {
            registered[`${name} ${path}`] = handlers;
        };
    return { get: verb("get"), post: verb("post"), put: verb("put"), delete: verb("delete"), registered };
}

/** Runs a registered middleware chain for an anonymous request and returns the first error passed to `next`. */
async function runAnonymous(handlers: any[]): Promise<any> {
    const req: any = { method: "GET", path: "/victim/secret", headers: {}, params: {}, query: {}, socket: {} };
    const res: any = {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn(),
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    };
    for (const handler of handlers) {
        let error: any = undefined;
        let proceed: boolean = false;
        await handler(req, res, (err?: any) => {
            error = err;
            proceed = !err;
        });
        if (error) {
            return error;
        }
        if (!proceed) {
            break;
        }
    }
    return undefined;
}

vi.setConfig({ testTimeout: 60000 });
describe("RouteUtils fails closed when a route ACL is missing [MongoDB]", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", objectFactory });
    let routeUtils: RouteUtils;
    let aclUtils: ACLUtils;

    beforeAll(async () => {
        await mongod.start();
        await server.start();
        routeUtils = objectFactory.getInstance(RouteUtils)!;
        aclUtils = objectFactory.getInstance(ACLUtils)!;
        (routeUtils as any).logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    });

    afterAll(async () => {
        vi.restoreAllMocks();
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    it("denies anonymous access after the user-editable route ACL is removed and the route re-registers", async () => {
        const route = new VictimFailClosedRoute();

        // First start: both ACL records are created.
        await routeUtils.registerRoute(makeApp(), route);
        expect(await aclUtils.findACL("VictimFailClosedRoute", [], { skipCache: true })).toBeDefined();

        // The attack removes the user-editable ACL. Then the service restarts.
        await aclUtils.removeACL("VictimFailClosedRoute");
        const app = makeApp();
        await routeUtils.registerRoute(app, route);

        const err = await runAnonymous(app.registered["get /victim/secret"]);
        expect(err?.status).toBe(403);
        expect(route.called).toBe(0);
    });

    it("denies every request when saveDefaultACL() returns null and no ACL exists", async () => {
        const route = new VictimFailClosedRoute();
        await aclUtils.removeACL("VictimFailClosedRoute");
        const spy = vi.spyOn(aclUtils, "saveDefaultACL").mockResolvedValue(null);
        try {
            const app = makeApp();
            await routeUtils.registerRoute(app, route);

            const err = await runAnonymous(app.registered["get /victim/secret"]);
            expect(err?.status).toBe(403);
            expect(route.called).toBe(0);
            expect((routeUtils as any).logger.error).toHaveBeenCalledWith(
                expect.stringContaining("VictimFailClosedRoute"),
            );
        } finally {
            spy.mockRestore();
        }
    });

    it("refuses to register the route when the ACL datastore fails at startup", async () => {
        const spy = vi.spyOn(aclUtils, "saveDefaultACL").mockRejectedValue(new Error("acl datastore unavailable"));
        try {
            const app = makeApp();
            await expect(routeUtils.registerRoute(app, new VictimFailClosedRoute())).rejects.toThrow(
                "acl datastore unavailable",
            );
            expect(app.registered["get /victim/secret"]).toBeUndefined();
        } finally {
            spy.mockRestore();
        }
    });
});
