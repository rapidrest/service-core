///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { BaseMetricsRoute, ObjectFactory, Server } from "../../src";
import { MongoMemoryServer } from "mongodb-memory-server";

import { ClassLoader, Logger } from "@rapidrest/core";
import { Route } from "../../src/decorators/RouteDecorators";
import { request } from "../../src/test";

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

    beforeAll(async () => {
        // Register the test route class with the class loader
        classLoader.getClasses().set("routes.MetricsRoute", MetricsRoute);

        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    it("Can serve metrics.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server).get("/metrics");
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("text");
        expect(result.text).not.toHaveLength(0);
    });

    it("Can serve single metric.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server).get("/metrics/num_total_requests");
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("text");
        expect(result.text).not.toHaveLength(0);
    });
});
