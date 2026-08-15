///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
// This mock MUST be defined before we import ConnectionManager (or anything that pulls it in such as Server)
vi.mock("ioredis", async () => {
    const RedisMock = await import("ioredis-mock");
    return { Redis: RedisMock.default || RedisMock };
});

import { default as config } from "../config";
import { BaseAdminRoute, ObjectFactory, Server } from "../../src";
import { RedisTransport } from "../../src/routes/BaseAdminRoute";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as sqlite3 from "sqlite3";
import * as uuid from "uuid";
import { Redis } from "ioredis";
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
const sqlite: sqlite3.Database = new sqlite3.Database(":memory:");
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
        return await new Promise<void>((resolve) => {
            sqlite.close((err) => {
                if (err) {
                    throw new Error(err.message);
                }
                resolve();
            });
        });
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
        const result = await request(server).get(`${basePath}/clear-cache`).set("Authorization", `jwt ${authToken}`);
        expect(result.status).toBe(403);
    });

    it("Can clear the cache with a trusted role.", async () => {
        const cacheClient = new Redis("redis://localhost:6379");
        await cacheClient.set("db.cache.foo", "1");
        await cacheClient.set("db.cache.bar", "2");
        await cacheClient.set("unrelated-key", "3");

        const result = await request(server).get(`${basePath}/clear-cache`).set("Authorization", `jwt ${adminToken}`);
        expect(result.status).toBe(204);

        expect(await cacheClient.get("db.cache.foo")).toBeNull();
        expect(await cacheClient.get("db.cache.bar")).toBeNull();
        expect(await cacheClient.get("unrelated-key")).toBe("3");
    });

    it("Can clear the cache when there are no matching keys.", async () => {
        const result = await request(server).get(`${basePath}/clear-cache`).set("Authorization", `jwt ${adminToken}`);
        expect(result.status).toBe(204);
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
        const result = await request(server).get(`${basePath}/restart`).set("Authorization", `jwt ${authToken}`);
        expect(result.status).toBe(403);
    });

    it("Can restart with a trusted role, which broadcasts RESTART to the admin channel.", async () => {
        // The admin channel subscription set up in `init()` is still listening on this same channel, so
        // publishing "RESTART" here also delivers it back to that subscription synchronously, which calls
        // `process.kill(process.pid, "SIGINT")`. Stub `process.kill` for the duration of this request so
        // that exercises that code path without actually tearing down the test process.
        const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);
        try {
            const result = await request(server).get(`${basePath}/restart`).set("Authorization", `jwt ${adminToken}`);
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
