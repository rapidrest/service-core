///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
const corsOrigins = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];
process.env[`cors__origins`] = JSON.stringify(corsOrigins);

import * as fs from "fs";
import { default as config } from "./config.js";
import { Server, ObjectFactory, ApiErrors } from "../src/index.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as request from "supertest";
import * as sqlite3 from "sqlite3";
import { v4 as uuidV4 } from "uuid";

import { JWTUtils, Logger, sleep } from "@rapidrest/core";
import { StatusExtraData } from "../src/models/StatusExtraData.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
const sqlite: sqlite3.Database = new sqlite3.Database(":memory:");
const regenOpenapiFile = process.env["XBE_REGEN"] || false;
describe("Server Tests", () => {
    const logger = new Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server(config, "./test/server", logger, objectFactory);

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
        let result = await request(server.getApplication()).options("/").set("Origin", corsOrigins[0]);
        expect(result.headers["access-control-allow-origin"]).toEqual(corsOrigins[0]);
        result = await request(server.getApplication()).options("/").set("Origin", "http://localhost:3005");
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

    it("Can serve status.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server.getApplication()).get("/status");
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("body");
        expect(result.body).toHaveProperty("name");
        expect(result.body).toHaveProperty("version");
    });

    it("Can serve status, with data updates.", async () => {
        const statusExtraData: StatusExtraData = await objectFactory.newInstance(StatusExtraData, { name: "default" });
        statusExtraData.data = {
            test: "Updates"
        };
        expect(server.isRunning()).toBe(true);
        const result = await request(server.getApplication()).get("/status");
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("body");
        expect(result.body).toHaveProperty("name");
        expect(result.body).toHaveProperty("version");
        expect(result.body.test).toBe("Updates");
    });

    it("Can serve OpenAPI spec.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server.getApplication()).get("/openapi.json");
        expect(result).toHaveProperty("status");
        expect(result.type).toBe("application/json");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("body");
        expect(result.body.openapi).toBe("3.1.0");

        const result2 = await request(server.getApplication()).get("/openapi.yaml");
        expect(result2).toHaveProperty("status");
        expect(result2.status).toBe(200);
        expect(result2).toHaveProperty("text");
        expect(result2.type).toBe("text/yaml");

        if (regenOpenapiFile) {
            fs.writeFileSync(`./test/openapi.yaml`, result2.text);
        }

        const result3 = await request(server.getApplication()).get("/api-docs");
        expect(result3).toHaveProperty("status");
        expect(result3.status).toBe(200);
        expect(result3).toHaveProperty("body");
    });

    it("Can serve OpenAPI expected JSON.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server.getApplication()).get("/openapi.json");
        expect(result).toHaveProperty("status");
        expect(result.type).toBe("application/json");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("body");
        expect(result.body.openapi).toBe("3.1.0");
        expect(result.body.info.title).toBe(config.get("title"));
        expect(result.body.info.description).toBe(config.get("description"));
        expect(result.body.info.termsOfService).toBe(config.get("termsOfService"));
        expect(result.body.info.license).toBe(config.get("license"));
        expect(result.body.info.version).toBe(config.get("version"));
        expect(Object.keys(result.body.paths).length).toBe(34)
        fs.writeFileSync("./openapi.json", JSON.stringify(result.body));
        const schemas = Object.keys(result.body.components.schemas);
        const parameters = Object.keys(result.body.components.parameters);
        expect(result.body.servers[0].url).toBe(config.get("cluster_url"));
        for (const path of Object.keys(result.body.paths)) {
            const pathData = result.body.paths[path];
            if (pathData.parameters) {
                expect(parameters).toEqual(expect.arrayContaining(pathData.parameters.filter(item => item["$ref"]).map(item => item["$ref"].replace("#/components/parameters/", ""))));
            }
            logger.info(`Checking ${path}`);
            expect(pathData["x-name"]).toBeDefined();
            expect(pathData["x-name"]).not.toBeNull();
            if (/.*.websocket/.test(path)) {
                expect(pathData["x-upgrade"]).toEqual(true);
            }
            for (const method of (Object.keys(pathData).filter(item => typeof pathData[item] === "object" && !["x-after", "x-before", "parameters"].includes(item)))) {
                const methodData = pathData[method];
                logger.info(`Checking ${path}: ${method}`);
                expect(methodData.summary).toBeDefined();
                expect(methodData.summary).not.toBeNull();
                expect(methodData.description).toBeDefined();
                expect(methodData.description).not.toBeNull();
                expect(methodData["x-name"]).toBeDefined();
                expect(methodData["x-name"]).not.toBeNull();
                expect(methodData.responses).toBeDefined();
                expect(methodData.responses).not.toBeNull();
                for (const response of Object.keys(methodData.responses)) {
                    if (response === "200" && methodData.responses[response].content && methodData.responses[response].content["application/json"]) {
                        const content = methodData.responses[response].content["application/json"];
                        expect(content.schema).toBeDefined();
                        if (content.schema.type) {
                            continue;
                        }
                        if (content.schema.oneOf) {
                            expect(Array.isArray(content.schema.oneOf)).toBe(true);
                            for (const item of content.schema.oneOf) {
                                let ref = (item["$ref"]) ?? item.items["$ref"];
                                expect(schemas).toContain(ref.replace("#/components/schemas/", ""));
                            }
                        } else {
                            expect(content.schema["$ref"]).toBeDefined();
                            expect(schemas).toContain(content.schema["$ref"].replace("#/components/schemas/", ""))
                        }
                    }
                }
                // Check response
            }
        }
    });

    it("Can serve metrics.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server.getApplication()).get("/metrics");
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("text");
        expect(result.text).not.toHaveLength(0);
    });

    it("Can serve single metric.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server.getApplication()).get("/metrics/num_total_requests");
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("text");
        expect(result.text).not.toHaveLength(0);
    });

    it("Can serve hello world.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server.getApplication()).get("/hello");
        expect(result.status).toBe(200);
        expect(result.body).toBeDefined();
        expect(result.body.msg).toBe("Hello World!");
    });

    it("Can authorize user.", async () => {
        const user: any = { uid: uuidV4() };
        const token = JWTUtils.createToken(config.get("auth"), user);
        const result = await request(server.getApplication())
            .get("/token")
            .set("Authorization", "jwt " + token);
        expect(result.status).toBe(200);
        expect(result.body).toEqual(user);
    });

    it("Can authorize user with query param.", async () => {
        const user: any = { uid: uuidV4() };
        const token = JWTUtils.createToken(config.get("auth"), user);
        const result = await request(server.getApplication()).get("/token?jwt_token=" + token);
        expect(result.status).toBe(200);
        expect(result.body).toEqual(user);
    });

    it("Can handle error gracefully.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server.getApplication()).get("/error");
        expect(result.status).toBe(400);
        expect(result.body.status).toBe(400);
        expect(result.body.code).toBe(ApiErrors.INVALID_REQUEST);
        expect(result.body.message).toBe("This is a test.");
    });
});
