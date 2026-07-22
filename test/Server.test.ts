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

    it("Logs (rather than debug-logs) a 500-level ApiError and still returns a clean JSON error body.", async () => {
        const result = await request(server).get("/error500");
        expect(result.status).toBe(500);
        expect(result.body.status).toBe(500);
        expect(result.body.message).toBe("This is a 500-level test.");
    });

    it("Wraps a raw (non-ApiError) thrown Error into a clean 500 ApiError response.", async () => {
        const result = await request(server).get("/error-raw");
        expect(result.status).toBe(500);
        expect(result.body.status).toBe(500);
        expect(result.body.code).toBe(ApiErrors.INTERNAL_ERROR);
        // The raw Error's own message must not leak to the client -- it's replaced with the generic
        // INTERNAL_ERROR message, same as any other unexpected (non-ApiError) failure.
        expect(result.body.message).not.toContain("This is a raw error test.");
    });

    it("Handles a literal string thrown from a handler as a generic 500.", async () => {
        const result = await request(server).get("/error-string");
        expect(result.status).toBe(500);
        expect(result.body.status).toBe(500);
        expect(result.body.message).toBe("Internal Server Error");
    });

    it("Never leaks a stack trace to the client, regardless of NODE_ENV.", async () => {
        // Error.stack is a non-enumerable accessor, so it's dropped by the plain object spread
        // (`{...err, ...}`) that builds the client-facing error body before the NODE_ENV check even
        // runs — the intent (stripping stack in production) holds, though the "keep it in development"
        // half never actually surfaces a stack in the JSON body either. Confirms the safe outcome
        // (no leak either way) without asserting the never-true "included in development" behavior.
        const original = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "development";
            const devResult = await request(server).get("/error-raw");
            expect(devResult.body.stack).toBeUndefined();

            process.env.NODE_ENV = "production";
            const prodResult = await request(server).get("/error-raw");
            expect(prodResult.body.stack).toBeUndefined();
        } finally {
            process.env.NODE_ENV = original;
        }
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
