///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { BaseOpenAPIRoute, ObjectFactory, Server } from "../../src";
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

@Route("/openapi")
export class OpenAPIRoute extends BaseOpenAPIRoute {}

vi.setConfig({ testTimeout: 30000 });
describe("OpenAPIRoute Tests", () => {
    const classLoader: ClassLoader = new ClassLoader("./test/server", true, true, config.get("class_loader:ignore"));
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", classLoader, objectFactory });

    beforeAll(async () => {
        // Register the test route class with the class loader
        classLoader.getClasses().set("routes.OpenAPIRoute", OpenAPIRoute);

        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    it("Can serve OpenAPI spec.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server).get("/openapi/json");
        expect(result).toHaveProperty("status");
        expect(result.type).toBe("application/json");
        expect(result.status).toBe(200);
        expect(result).toHaveProperty("body");
        expect(result.body.openapi).toBe("3.1.0");

        const result2 = await request(server).get("/openapi/yaml");
        expect(result2).toHaveProperty("status");
        expect(result2.status).toBe(200);
        expect(result2).toHaveProperty("text");
        expect(result2.type).toBe("text/yaml");

        const result3 = await request(server).get("/openapi");
        expect(result3).toHaveProperty("status");
        expect(result3.status).toBe(200);
        expect(result3).toHaveProperty("body");
    });

    it("Can serve OpenAPI expected JSON.", async () => {
        expect(server.isRunning()).toBe(true);
        const result = await request(server).get("/openapi/json");
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
        expect(Object.keys(result.body.paths).length).toBe(31);
        const schemas = Object.keys(result.body.components.schemas);
        const parameters = Object.keys(result.body.components.parameters);
        expect(result.body.servers[0].url).toBe(config.get("cluster_url"));
        for (const path of Object.keys(result.body.paths)) {
            const pathData = result.body.paths[path];
            if (pathData.parameters) {
                expect(parameters).toEqual(
                    expect.arrayContaining(
                        pathData.parameters
                            .filter((item) => item["$ref"])
                            .map((item) => item["$ref"].replace("#/components/parameters/", "")),
                    ),
                );
            }
            expect(pathData["x-name"]).toBeDefined();
            expect(pathData["x-name"]).not.toBeNull();
            if (/.*.websocket/.test(path)) {
                expect(pathData["x-upgrade"]).toEqual(true);
            }
            for (const method of Object.keys(pathData).filter(
                (item) => typeof pathData[item] === "object" && !["x-after", "x-before", "parameters"].includes(item),
            )) {
                const methodData = pathData[method];
                expect(methodData.summary).toBeDefined();
                expect(methodData.summary).not.toBeNull();
                expect(methodData.description).toBeDefined();
                expect(methodData.description).not.toBeNull();
                expect(methodData["x-name"]).toBeDefined();
                expect(methodData["x-name"]).not.toBeNull();
                expect(methodData.responses).toBeDefined();
                expect(methodData.responses).not.toBeNull();
                for (const response of Object.keys(methodData.responses)) {
                    if (
                        response === "200" &&
                        methodData.responses[response].content &&
                        methodData.responses[response].content["application/json"]
                    ) {
                        const content = methodData.responses[response].content["application/json"];
                        expect(content.schema).toBeDefined();
                        if (content.schema.type) {
                            continue;
                        }
                        if (content.schema.oneOf) {
                            expect(Array.isArray(content.schema.oneOf)).toBe(true);
                            for (const item of content.schema.oneOf) {
                                let ref = item["$ref"] ?? item.items["$ref"];
                                expect(schemas).toContain(ref.replace("#/components/schemas/", ""));
                            }
                        } else {
                            expect(content.schema["$ref"]).toBeDefined();
                            expect(schemas).toContain(content.schema["$ref"].replace("#/components/schemas/", ""));
                        }
                    }
                }
                // Check response
            }
        }
    });
});
