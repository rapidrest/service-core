///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { BaseStatusRoute, ObjectFactory, Server, StatusExtraData } from "../../src";
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

@Route("/status")
class StatusRoute extends BaseStatusRoute {}

vi.setConfig({ testTimeout: 30000 });
describe("StatusRoute Tests", () => {
    const classLoader: ClassLoader = new ClassLoader("./test/server", true, true, config.get("class_loader:ignore"));
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", classLoader, objectFactory });

    beforeAll(async () => {
        // Register the test route class with the class loader
        classLoader.getClasses().set("routes.StatusRoute", StatusRoute);

        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    it("Can serve status.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server).get("/status");
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("body");
        expect(result.body).toHaveProperty("name");
        expect(result.body).toHaveProperty("version");
    });

    it("Can serve status, with data updates.", async () => {
        const statusExtraData: StatusExtraData = await objectFactory.newInstance(StatusExtraData, { name: "default" });
        statusExtraData.data = {
            test: "Updates",
        };
        expect(server.isRunning()).toBe(true);
        const result = await request(server).get("/status");
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("body");
        expect(result.body).toHaveProperty("name");
        expect(result.body).toHaveProperty("version");
        expect(result.body.test).toBe("Updates");
    });
});
