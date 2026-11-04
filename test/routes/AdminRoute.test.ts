///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// This mock MUST be defined before we import ConnectionManager (or anything that pulls it in such as Server).
// A synchronous factory (backed by a normal, statically-resolved import rather than a dynamic one inside the
// factory) avoids a race where BaseAdminRoute connects two redis datastores ("cache" and "logs") concurrently,
// each dynamically importing "redis", before an async factory's own internal import has resolved.
import { createFakeRedisModule } from "../helpers/FakeRedis.js";
vi.mock("redis", () => createFakeRedisModule());

import { default as config } from "../config";
import { createClient } from "redis";
import { BaseAdminRoute, ObjectFactory, Server } from "../../src";
import { RedisTransport } from "../../src/routes/BaseAdminRoute";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as uuid from "uuid";
import { requestws } from "../../src/test/requestws.js";
import { request } from "../../src/test/request.js";

import { ClassLoader, JWTUtils, Logger } from "@rapidrest/core";
import { Route } from "../../src/decorators/RouteDecorators";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
vi.setConfig({ testTimeout: 30000 });

@Route("/admin")
class AdminRoute extends BaseAdminRoute {}

describe("AdminRoute Tests", () => {
    const basePath = "/admin";
    const classLoader: ClassLoader = new ClassLoader("./test/server", true, true, config.get("class_loader:ignore"));
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", classLoader, objectFactory });
    const serviceName: string = config.get("service_name");
    const admin: any = {
        uid: uuid.v4(),
        personas: [
            {
                uid: uuid.v4(),
                name: "Persona1",
            },
            {
                uid: uuid.v4(),
                name: "Persona2",
            },
        ],
        roles: config.get("trusted_roles"),
        elevated: Date.now(),
    };
    const adminToken = JWTUtils.createTokenSync(config.get("auth"), admin);
    const user: any = {
        uid: uuid.v4(),
        personas: [
            {
                uid: uuid.v4(),
                name: "Persona1",
            },
            {
                uid: uuid.v4(),
                name: "Persona2",
            },
        ],
        elevated: Date.now(),
    };
    const authToken = JWTUtils.createTokenSync(config.get("auth"), user);

    beforeAll(async () => {
        config.set("datastores:logs", {
            type: "redis",
            url: "redis://localhost:6379",
        });
        config.set("datastores:cache", {
            type: "redis",
            url: "redis://localhost:6379",
        });

        // Register the test route class with the class loader
        classLoader.getClasses().set("routes.AdminRoute", AdminRoute);

        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    it("Can connect to logs with auth header.", async () => {
        await requestws(server)
            .ws(basePath + "/logs", { headers: { Authorization: `jwt ${adminToken}` } })
            .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: serviceName + "-logs" })
            .close()
            .expectClosed();
    });

    it("Cannot connect to logs with auth header using untrusted user.", async () => {
        await requestws(server)
            .ws(basePath + "/logs", { headers: { Authorization: `jwt ${authToken}` } })
            .expectClosed(1002, "api-103");
    });

    it("Can connect to logs with LOGIN message.", async () => {
        await requestws(server)
            .ws(basePath + "/logs")
            .sendJson({ id: 0, type: "LOGIN", data: adminToken })
            .expectJson({ id: 0, type: "LOGIN_RESPONSE", success: true })
            .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: serviceName + "-logs" })
            .close()
            .expectClosed();
    });

    it("Cannot connect to logs with LOGIN message using untrusted user.", async () => {
        await requestws(server)
            .ws(basePath + "/logs")
            .sendJson({ id: 0, type: "LOGIN", data: authToken })
            .expectJson({ id: 0, type: "LOGIN_RESPONSE", success: true })
            .expectClosed(1002, "api-103");
    });

    it("Cannot clear the cache without a trusted role.", async () => {
        const result = await request(server).post(`${basePath}/clear-cache`).set("Authorization", `jwt ${authToken}`);
        expect(result.status).toBe(403);
    });

    it("Can clear the cache with a trusted role.", async () => {
        const cacheClient = createClient({ url: "redis://localhost:6379" });
        await cacheClient.connect();
        // `clearCache()` matches keys against the glob pattern "cache.*", which (like real Redis SCAN MATCH)
        // requires the key to actually start with "cache." — these keys are named accordingly.
        await cacheClient.set("cache.foo", "1");
        await cacheClient.set("cache.bar", "2");
        await cacheClient.set("unrelated-key", "3");

        const result = await request(server).post(`${basePath}/clear-cache`).set("Authorization", `jwt ${adminToken}`);
        expect(result.status).toBe(204);

        expect(await cacheClient.get("cache.foo")).toBeNull();
        expect(await cacheClient.get("cache.bar")).toBeNull();
        expect(await cacheClient.get("unrelated-key")).toBe("3");
    });

    it("Can clear the cache when there are no matching keys.", async () => {
        const result = await request(server).post(`${basePath}/clear-cache`).set("Authorization", `jwt ${adminToken}`);
        expect(result.status).toBe(204);
    });

    it("Rejects the legacy GET /clear-cache with 405 and does not clear the cache.", async () => {
        const cacheClient = createClient({ url: "redis://localhost:6379" });
        await cacheClient.connect();
        await cacheClient.set("cache.keepme", "1");
        const result = await request(server).get(`${basePath}/clear-cache`).set("Authorization", `jwt ${adminToken}`);
        expect(result.status).toBe(405);
        expect(result.headers["allow"]).toBe("POST");
        expect(result.body.message).toContain("POST");
        expect(await cacheClient.get("cache.keepme")).toBe("1");
        await cacheClient.del("cache.keepme");
    });

    it("Rejects the legacy GET /restart with 405 and does not restart.", async () => {
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
        try {
            const result = await request(server).get(`${basePath}/restart`).set("Authorization", `jwt ${adminToken}`);
            expect(result.status).toBe(405);
            expect(result.headers["allow"]).toBe("POST");
            expect(result.body.message).toContain("POST");
            await new Promise((r) => setTimeout(r, 100));
            expect(killSpy).not.toHaveBeenCalled();
        } finally {
            killSpy.mockRestore();
        }
    });

    it("Requires recent elevation to clear the cache or restart.", async () => {
        const stale = JWTUtils.createTokenSync(config.get("auth"), { ...admin, elevated: Date.now() - 3600 * 1000 });
        const unelevated = JWTUtils.createTokenSync(config.get("auth"), { ...admin, elevated: undefined });
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
        try {
            for (const token of [stale, unelevated]) {
                for (const path of ["clear-cache", "restart"]) {
                    const result = await request(server).post(`${basePath}/${path}`).set("Authorization", `jwt ${token}`);
                    expect(result.status).toBe(403);
                    expect(result.body.code).toBe("api-104");
                }
            }
            await new Promise((r) => setTimeout(r, 100));
            expect(killSpy).not.toHaveBeenCalled();
        } finally {
            killSpy.mockRestore();
        }
    });

    it("Honours the admin:elevation_max_age override.", async () => {
        const aged = JWTUtils.createTokenSync(config.get("auth"), { ...admin, elevated: Date.now() - 120 * 1000 });
        const ok = await request(server).post(`${basePath}/clear-cache`).set("Authorization", `jwt ${aged}`);
        expect(ok.status).toBe(204);
        config.set("admin:elevation_max_age", 60);
        try {
            const denied = await request(server).post(`${basePath}/clear-cache`).set("Authorization", `jwt ${aged}`);
            expect(denied.status).toBe(403);
        } finally {
            config.clear("admin:elevation_max_age");
        }
    });

    it("Requires a CSRF token for cookie-authenticated POST /clear-cache and /restart.", async () => {
        for (const path of ["clear-cache", "restart"]) {
            const result = await request(server).post(`${basePath}/${path}`).set("Cookie", `jwt=${adminToken}`);
            expect(result.status).toBe(403);
        }
    });

    it("Cannot get release notes without a trusted role.", async () => {
        const result = await request(server).get(`${basePath}/release-notes`).set("Authorization", `jwt ${authToken}`);
        expect(result.status).toBe(403);
    });

    it("Can get release notes with a trusted role.", async () => {
        const result = await request(server).get(`${basePath}/release-notes`).set("Authorization", `jwt ${adminToken}`);
        expect(result.status).toBe(204);
    });

    it("Cannot restart without a trusted role.", async () => {
        const result = await request(server).post(`${basePath}/restart`).set("Authorization", `jwt ${authToken}`);
        expect(result.status).toBe(403);
    });

    it("Can restart with a trusted role, which broadcasts RESTART to the admin channel.", async () => {
        // The admin channel subscription set up in `init()` is still listening on this same channel, so
        // publishing "RESTART" here also delivers it back to that subscription synchronously, which calls
        // `process.kill(process.pid, "SIGINT")`. Stub `process.kill` for the duration of this request so
        // that exercises that code path without actually tearing down the test process.
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
        try {
            const result = await request(server).post(`${basePath}/restart`).set("Authorization", `jwt ${adminToken}`);
            expect(result.status).toBe(204);
            await vi.waitFor(() => expect(killSpy).toHaveBeenCalledWith(process.pid, "SIGINT"));
        } finally {
            killSpy.mockRestore();
        }
    });
});

describe("RedisTransport Tests", () => {
    it("disconnects the underlying redis client on close", () => {
        const redis = { disconnect: vi.fn(), publish: vi.fn() };
        const transport = new RedisTransport({ channelName: "chan", redis });
        transport.close();
        expect(redis.disconnect).toHaveBeenCalled();
    });

    it("publishes log entries to the configured channel", () => {
        const redis = { disconnect: vi.fn(), publish: vi.fn() };
        const transport = new RedisTransport({ channelName: "chan", redis });
        const next = vi.fn();
        transport.log({ level: "info", message: "hi" }, next);
        expect(redis.publish).toHaveBeenCalledWith("chan", JSON.stringify({ level: "info", message: "hi" }));
        expect(next).toHaveBeenCalled();
    });
});
