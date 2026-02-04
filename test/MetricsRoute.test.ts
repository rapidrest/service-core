///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";

// This mock MUST be defined before we import ConnectionManager (or anything that pulls it in such as Server)
vi.mock('ioredis', () => require('ioredis-mock'));

import { default as config } from "./config.js";
import { Server } from "../src/index.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import { v4 as uuidV4 } from "uuid";
import * as request from "supertest";

import { JWTUtils } from "@rapidrest/core";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});

describe("MetricsRoute Tests", () => {
    const basePath = "/metrics";
    const server: Server = new Server(config, "./test/server");

    const user: any = {
        uid: uuidV4(),
        personas: [
            {
                uid: uuidV4(),
                name: "Persona1"
            },
            {
                uid: uuidV4(),
                name: "Persona2"
            }
        ]
    };
    const authToken = JWTUtils.createToken(config.get("auth"), user);

    beforeAll(async () => {
        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
    });

    it("Can Get Metrics", async () => {
        let result;
        for (let i = 0; i < 20; i++) {
            await request(server.getApplication()).get("/users").set("Authorization", `jwt ${authToken}`);
            await new Promise(r => setTimeout(r, Math.floor(Math.random() * 500)));
        }
        result = await request(server.getApplication()).get(basePath).set("Authorization", `jwt ${authToken}`);
        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.type).toBe("text/plain");
        expect(result.text).toBeDefined();
        expect(result.text.length).toBeGreaterThanOrEqual(1900);
        expect(result.text).toMatch(new RegExp('request_path{path="/users"} [0-9]+'));
        expect(result.text).toMatch(new RegExp('request_status{method=\"GET\",path=\"/users\",statusCode=\"200\"} [0-9]+'));
    });

    it("Can Get a Single Metric", async () => {
        let result = await request(server.getApplication()).get("/users").set("Authorization", `jwt ${authToken}`);
        result = await request(server.getApplication()).get(`${basePath}/request_status`).set("Authorization", `jwt ${authToken}`);
        expect(result).toBeDefined();
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        expect(result.type).toBe("text/plain");
        expect(result.text).toBeDefined();
        expect(result.text.length).toBeGreaterThanOrEqual(250);
        expect(result.text).toMatch(new RegExp('request_status{method=\"GET\",path=\"/users\",statusCode=\"200\"} [0-9]+'));
        expect(result.text).not.toMatch(new RegExp('request_path{path="/users"} [0-9]+'));
    });
});
