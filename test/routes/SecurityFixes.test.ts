///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { request } from "../../src/test/request.js";
import { Server, ObjectFactory, MongoConnection, MongoRepository } from "../../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import { JWTUtils, Logger } from "@rapidrest/core";
import { AccessControlListMongo } from "../../src/security/AccessControlListMongo";
import { ConnectionManager } from "../../src/database/ConnectionManager";
import * as http from "http";
import * as uuid from "uuid";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
    },
});

/** Issues a raw HTTP request with a literal body, bypassing axios's own request handling. */
function rawPost(port: number, path: string, body: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        const req = http.request(
            {
                host: "localhost",
                port,
                path,
                method: "POST",
                headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) },
            },
            (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body: data }));
            },
        );
        req.on("error", reject);
        req.end(body);
    });
}

vi.setConfig({ testTimeout: 60000 });
describe("Security Fixes Tests [MongoDB]", () => {
    const basePath = "/api/securedocs";
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", objectFactory });
    let aclRepo: MongoRepository<AccessControlListMongo>;

    const tokenFor = (uid: string, roles: string[] = []): string =>
        JWTUtils.createTokenSync(config.get("auth"), { uid, name: uid, roles });

    beforeAll(async () => {
        // A small limit keeps the oversized-body test fast — no need to actually send 10+ MiB.
        config.set("max_body_size", 1024 * 1024);

        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("acl");
        if (conn instanceof MongoConnection) {
            aclRepo = conn.getRepository(AccessControlListMongo);
        }
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    describe("Mass assignment protection (@ReadOnly)", () => {
        it("Strips a client-supplied value for a @ReadOnly field on create.", async () => {
            const token = tokenFor(uuid.v4());
            const result = await request(server)
                .post(basePath)
                .set("Authorization", `jwt ${token}`)
                .send({ name: uuid.v4(), content: "hello", locked: true });
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.body.locked).toBe(false);
        });

        it("Strips a client-supplied value for a @ReadOnly field on update.", async () => {
            const token = tokenFor(uuid.v4());
            const created = await request(server)
                .post(basePath)
                .set("Authorization", `jwt ${token}`)
                .send({ name: uuid.v4(), content: "hello" });
            expect(created.body.locked).toBe(false);

            const updated = await request(server)
                .put(`${basePath}/${created.body.uid}`)
                .set("Authorization", `jwt ${token}`)
                .send({ ...created.body, content: "updated", locked: true });
            expect(updated.status).toBeGreaterThanOrEqual(200);
            expect(updated.status).toBeLessThan(300);
            expect(updated.body.locked).toBe(false);
        });
    });

    describe("Type confusion via _type/_fqn", () => {
        it("Ignores a _type pointing at an unrelated registered model.", async () => {
            const token = tokenFor(uuid.v4());
            const result = await request(server)
                .post(basePath)
                .set("Authorization", `jwt ${token}`)
                .send({ name: uuid.v4(), content: "hello", _type: "ProtectedUser" });
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            // If _type had been honored, the object would have been instantiated as a ProtectedUser (which has no
            // `content` field) before being saved into this route's own collection, silently dropping `content`.
            expect(result.body.content).toBe("hello");
        });
    });

    describe("trackChanges + recordACL re-creation hijack", () => {
        it("Denies a non-owner attempting to inject a new version under an existing uid.", async () => {
            const ownerToken = tokenFor(uuid.v4());
            const created = await request(server)
                .post(basePath)
                .set("Authorization", `jwt ${ownerToken}`)
                .send({ name: uuid.v4(), content: "original" });
            expect(created.status).toBeGreaterThanOrEqual(200);
            expect(created.status).toBeLessThan(300);

            const attackerToken = tokenFor(uuid.v4());
            const hijackAttempt = await request(server)
                .post(basePath)
                .set("Authorization", `jwt ${attackerToken}`)
                .send({ uid: created.body.uid, name: created.body.name, content: "hijacked" });
            expect(hijackAttempt.status).toBe(403);

            // The original owner's ACL must be untouched — they can still update their own record.
            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: created.body.uid } as any);
            expect(acl).toBeDefined();
            if (acl) {
                expect(acl.records.some((r) => r.userOrRoleId !== "anonymous" && r.userOrRoleId !== ".*" && r.update)).toBe(
                    true,
                );
            }

            const ownerFollowup = await request(server)
                .get(`${basePath}/${created.body.uid}`)
                .set("Authorization", `jwt ${ownerToken}`);
            expect(ownerFollowup.status).toBe(200);
            expect(ownerFollowup.body.content).toBe("original");
        });

        it("Allows the owner to create a new version under their own uid.", async () => {
            const ownerToken = tokenFor(uuid.v4());
            const created = await request(server)
                .post(basePath)
                .set("Authorization", `jwt ${ownerToken}`)
                .send({ name: uuid.v4(), content: "v1" });
            expect(created.status).toBeGreaterThanOrEqual(200);
            expect(created.status).toBeLessThan(300);

            const revised = await request(server)
                .post(basePath)
                .set("Authorization", `jwt ${ownerToken}`)
                .send({ uid: created.body.uid, name: created.body.name, content: "v2" });
            expect(revised.status).toBeGreaterThanOrEqual(200);
            expect(revised.status).toBeLessThan(300);
        });
    });

    describe("Request body size limit", () => {
        it("Rejects a request body larger than the configured maximum with a 413.", async () => {
            const token = tokenFor(uuid.v4());
            const oversizedContent = "a".repeat(2 * 1024 * 1024); // 2 MiB, over the 1 MiB test limit set below
            const result = await rawPost(
                server.port,
                basePath,
                JSON.stringify({ name: uuid.v4(), content: oversizedContent }),
            );
            expect(result.status).toBe(413);
        });
    });
});
