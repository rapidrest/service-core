///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
const corsOrigins = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];
process.env[`cors__origins`] = JSON.stringify(corsOrigins);

import { default as config } from "./config";
import { Server, ObjectFactory, ApiErrors } from "../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import { request } from "../src/test/request.js";
import * as sqlite3 from "sqlite3";
import * as uuid from "uuid";

import { JWTUtils, Logger, sleep } from "@rapidrest/core";
import { StatusExtraData } from "../src/models/StatusExtraData";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
const sqlite: sqlite3.Database = new sqlite3.Database(":memory:");
vi.setConfig({ testTimeout: 1200000 });
describe("Server Tests", () => {
    const logger = new Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server", logger, objectFactory });

    beforeAll(async () => {
        await mongod.start();
    });

    afterAll(async () => {
        await mongod.stop();
        await new Promise<void>((resolve) => {
            sqlite.close((err) => {
                if (err) {
                    throw new Error(err.message);
                }
                resolve();
            });
        });
    });

    beforeEach(async () => {
        expect(server).toBeInstanceOf(Server);
        await server.start();
        // Wait a bit longer each time. This allows objects to finish initialization before we proceed.
        await sleep(1000);
    });

    afterEach(async () => {
        await server.stop();
    });

    it("Can start server.", async () => {
        expect(server.isRunning()).toBe(true);
        // Cors Check
        let result = await request(server).options("/").set("Origin", corsOrigins[0]);
        expect(result.headers["access-control-allow-origin"]).toEqual(corsOrigins[0]);
        result = await request(server).options("/").set("Origin", "http://localhost:3005");
        expect(result.headers["access-control-allow-origin"]).not.toBeDefined();
    });

    it("Can stop server.", async () => {
        expect(server.isRunning()).toBe(true);
        await server.stop();
        expect(server.isRunning()).toBe(false);
    });

    it("Can restart server.", async () => {
        expect(server.isRunning()).toBe(true);
        await server.restart();
        expect(server.isRunning()).toBe(true);
    });

    it("Can serve hello world.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server).get("/hello");
        expect(result.status).toBe(200);
        expect(result.body).toBeDefined();
        expect(result.body.msg).toBe("Hello World!");
    });

    it("Can authorize user.", async () => {
        const user: any = { uid: uuid.v4() };
        const token = JWTUtils.createTokenSync(config.get("auth"), user);
        const result = await request(server)
            .get("/token")
            .set("Authorization", "jwt " + token);
        expect(result.status).toBe(200);
        expect(result.body).toEqual(user);
    });

    it("Can authorize user with query param.", async () => {
        const user: any = { uid: uuid.v4() };
        const token = JWTUtils.createTokenSync(config.get("auth"), user);
        const result = await request(server).get("/token?auth_token=" + token);
        expect(result.status).toBe(200);
        expect(result.body).toEqual(user);
    });

    it("Can handle error gracefully.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server).get("/error");
        expect(result.status).toBe(400);
        expect(result.body.status).toBe(400);
        expect(result.body.code).toBe(ApiErrors.INVALID_REQUEST);
        expect(result.body.message).toBe("This is a test.");
    });

    it("Returns a JSON 404 for a path that matches no registered route.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server).get("/this-path-does-not-exist");
        expect(result.status).toBe(404);
        expect(result.type).toBe("application/json");
        expect(result.body.status).toBe(404);
        expect(result.body.code).toBe(ApiErrors.NOT_FOUND);
    });

    it("Returns a JSON 404 for an unbound path regardless of HTTP method.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server).post("/this-path-does-not-exist").send({});
        expect(result.status).toBe(404);
        expect(result.type).toBe("application/json");
        expect(result.body.status).toBe(404);
        expect(result.body.code).toBe(ApiErrors.NOT_FOUND);
    });
});
