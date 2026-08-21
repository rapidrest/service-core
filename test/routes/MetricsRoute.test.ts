///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { BaseMetricsRoute, ObjectFactory, Server } from "../../src";
import { MongoMemoryServer } from "mongodb-memory-server";

import { ClassLoader, JWTUtils, Logger } from "@rapidrest/core";
import { Route } from "../../src/decorators/RouteDecorators";
import { request } from "../../src/test";
import * as uuid from "uuid";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});

@Route("/metrics")
class MetricsRoute extends BaseMetricsRoute {}

vi.setConfig({ testTimeout: 30000 });
describe("MetricsRoute Tests", () => {
    const classLoader: ClassLoader = new ClassLoader("./test/server", true, true, config.get("class_loader:ignore"));
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", classLoader, objectFactory });

    const admin: any = { uid: uuid.v4(), roles: config.get("trusted_roles") };
    const adminToken: string = JWTUtils.createTokenSync(config.get("auth"), admin);
    const user: any = { uid: uuid.v4() };
    const userToken: string = JWTUtils.createTokenSync(config.get("auth"), user);

    beforeAll(async () => {
        config.set("metrics:authRequired", true);

        // Register the test route class with the class loader
        classLoader.getClasses().set("routes.MetricsRoute", MetricsRoute);

        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
        config.set("metrics:authRequired", false);
    });

    it("Can serve metrics as a trusted user.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server)
            .get("/metrics")
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("text");
        expect(result.text).not.toHaveLength(0);
    });

    it("Can serve single metric as a trusted user.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server)
            .get("/metrics/num_total_requests")
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("text");
        expect(result.text).not.toHaveLength(0);
    });

    it("Cannot serve metrics without authentication.", async () => {
        const result = await request(server).get("/metrics");
        expect(result.status).toBe(403);
    });

    it("Cannot serve metrics as an untrusted user.", async () => {
        const result = await request(server)
            .get("/metrics")
            .set("Authorization", "jwt " + userToken);
        expect(result.status).toBe(403);
    });

    it("Cannot serve a single metric without authentication.", async () => {
        const result = await request(server).get("/metrics/num_total_requests");
        expect(result.status).toBe(403);
    });

    it("Cannot serve a single metric as an untrusted user.", async () => {
        const result = await request(server)
            .get("/metrics/num_total_requests")
            .set("Authorization", "jwt " + userToken);
        expect(result.status).toBe(403);
    });
});
