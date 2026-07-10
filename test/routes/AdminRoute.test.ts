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
import { MongoMemoryServer } from "mongodb-memory-server";
import * as sqlite3 from "sqlite3";
import * as uuid from "uuid";
import { requestws } from "../../src/test/requestws.js";

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
    };
    const authToken = JWTUtils.createTokenSync(config.get("auth"), user);

    beforeAll(async () => {
        config.set("datastores:logs", {
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
            .expectClosed(1002, "api-102");
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
            .expectClosed(1002, "api-102");
    });
});
