///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for the thin OpenApiBuilder wrapper methods and createSchemaObject's generic
// (Array/Map/enum) handling — these aren't exercised by the full-server integration test in
// OpenApiSpec.test.ts, which only registers a handful of concrete routes/models.
import "reflect-metadata";
import { OpenApiSpec } from "../src/OpenApiSpec";

describe("OpenApiSpec wrapper methods", () => {
    it("builder getter/setter round-trips the underlying builder", () => {
        const spec = new OpenApiSpec();
        const builder = spec.builder;
        expect(builder).toBeDefined();
        spec.builder = builder;
        expect(spec.builder).toBe(builder);
    });

    it("exposes info/security/tags/externalDocs/webhooks getters", () => {
        const spec = new OpenApiSpec();
        expect(spec.info).toBeDefined();
        expect(spec.security).toBeUndefined();
        expect(spec.tags).toEqual([]);
        expect(spec.externalDocs).toBeUndefined();
        expect(spec.webhooks).toBeUndefined();
    });

    it("getSpecAsJson/getSpecAsYaml return non-empty strings", () => {
        const spec = new OpenApiSpec();
        expect(typeof spec.getSpecAsJson()).toBe("string");
        expect(typeof spec.getSpecAsYaml()).toBe("string");
    });

    it("addOpenApiVersion sets the openapi version", () => {
        const spec = new OpenApiSpec();
        spec.addOpenApiVersion("3.0.0");
        expect(spec.getSpec().openapi).toBe("3.0.0");
    });

    it("addContact/addLicense/addTitle/addDescription/addTermsOfService/addVersion update info", () => {
        const spec = new OpenApiSpec();
        spec.addTitle("My API")
            .addDescription("desc")
            .addTermsOfService("tos")
            .addVersion("1.2.3")
            .addContact({ name: "support" })
            .addLicense({ name: "MIT" });
        expect(spec.info).toEqual(
            expect.objectContaining({
                title: "My API",
                description: "desc",
                termsOfService: "tos",
                version: "1.2.3",
                contact: { name: "support" },
                license: { name: "MIT" },
            }),
        );
    });

    it("addPath adds a raw path item", () => {
        const spec = new OpenApiSpec();
        spec.addPath("/custom", { get: { responses: {} } } as any);
        expect(spec.paths?.["/custom"]).toBeDefined();
    });

    it("addResponse/addExample/addRequestBody/addHeader/addSecurityScheme/addLink/addCallback register components", () => {
        const spec = new OpenApiSpec();
        spec.addResponse("NotFound", { description: "not found" })
            .addExample("Ex1", { value: {} })
            .addRequestBody("Body1", { content: {} } as any)
            .addHeader("X-Custom", { schema: { type: "string" } } as any)
            .addSecurityScheme("jwt", { type: "http", scheme: "bearer" } as any)
            .addLink("Link1", { operationId: "op1" })
            .addCallback("Cb1", {} as any);
        const components = spec.components;
        expect(components?.responses?.NotFound).toBeDefined();
        expect(components?.examples?.Ex1).toBeDefined();
        expect(components?.requestBodies?.Body1).toBeDefined();
        expect(components?.headers?.["X-Custom"]).toBeDefined();
        expect(components?.securitySchemes?.jwt).toBeDefined();
        expect(components?.links?.Link1).toBeDefined();
        expect(components?.callbacks?.Cb1).toBeDefined();
    });

    it("addTag/addExternalDocs/addWebhook update the spec", () => {
        const spec = new OpenApiSpec();
        spec.addTag({ name: "widgets" })
            .addExternalDocs({ url: "https://example.com/docs" })
            .addWebhook("newThing", { post: { responses: {} } } as any);
        expect(spec.tags).toEqual(expect.arrayContaining([{ name: "widgets" }]));
        expect(spec.externalDocs).toEqual({ url: "https://example.com/docs" });
        expect(spec.webhooks?.newThing).toBeDefined();
    });
});

describe("OpenApiSpec.createSchemaObject generic type handling", () => {
    it("builds an array schema from a [Array, ItemType] container", () => {
        const spec = new OpenApiSpec();
        const schema: any = spec.createSchemaObject([Array, String]);
        expect(schema.type).toBe("array");
        expect(schema.items).toEqual(expect.objectContaining({ type: "string" }));
    });

    it("builds an enum schema from a [String, enumObject] container", () => {
        const spec = new OpenApiSpec();
        const schema: any = spec.createSchemaObject([String, { A: "a", B: "b" }]);
        expect(schema.type).toBe("string");
        expect(schema.enum).toEqual(["a", "b"]);
    });

    it("builds a map schema with a built-in value type", () => {
        const spec = new OpenApiSpec();
        const schema: any = spec.createSchemaObject([Map, String, String]);
        expect(schema.type).toBe("object");
        expect(schema.additionalProperties).toEqual({ type: "string" });
    });

    it("builds a map schema with a non-built-in (referenced) value type", () => {
        const spec = new OpenApiSpec();
        class Widget {}
        const schema: any = spec.createSchemaObject([Map, String, Widget]);
        expect(schema.type).toBe("object");
        // No "Widget" schema is registered, so the reference lookup resolves to undefined.
        expect(schema.additionalProperties).toBeUndefined();
    });

    it("throws when a map's key type is not string", () => {
        const spec = new OpenApiSpec();
        expect(() => spec.createSchemaObject([Map, Number, String])).toThrow(
            "Maps in OpenAPI must have a key type of string.",
        );
    });

    it("throws when a map is missing its value type argument", () => {
        const spec = new OpenApiSpec();
        expect(() => spec.createSchemaObject([Map, String])).toThrow(
            "Map types require three arguments. e.g. `[Map, string, string]`",
        );
    });

    it("falls back to a $ref for an unrecognized container type", () => {
        const spec = new OpenApiSpec();
        spec.addSchema("Widget", { type: "object" });
        class Widget {}
        const schema: any = spec.createSchemaObject([Set, Widget]);
        expect(schema["$ref"]).toBe("#/components/schemas/Widget");
    });

    it("encodes a Buffer type as a byte-formatted string", () => {
        const spec = new OpenApiSpec();
        const schema: any = spec.createSchemaObject(Buffer);
        expect(schema.type).toBe("string");
        expect(schema.format).toBe("byte");
    });

    it("encodes a Date type as a date-formatted string", () => {
        const spec = new OpenApiSpec();
        const schema: any = spec.createSchemaObject(Date);
        expect(schema.type).toBe("string");
        expect(schema.format).toBe("date");
    });

    it("falls back to a $ref for a custom (non-built-in) class type", () => {
        const spec = new OpenApiSpec();
        class CustomModel {}
        const schema: any = spec.createSchemaObject(CustomModel);
        expect(schema["$ref"]).toBe("#/components/schemas/CustomModel");
    });
});

describe("OpenApiSpec.merge", () => {
    it("does nothing when given a falsy spec", () => {
        const spec = new OpenApiSpec();
        const before = spec.getSpecAsJson();
        spec.merge(undefined);
        expect(spec.getSpecAsJson()).toBe(before);
    });
});

describe("OpenApiSpec.addRoute isWebSocket flag", () => {
    it("marks the route with x-upgrade and strips response schemas when isWebSocket is true", () => {
        const spec = new OpenApiSpec();
        class FakeRoute {}
        spec.addRoute("logs", "/logs", "get", { authRequired: false }, { description: "test" } as any, FakeRoute, true);
        const pathItem: any = spec.paths?.["/logs"];
        expect(pathItem["x-upgrade"]).toBe(true);
        expect(pathItem.get.responses["200"]).toBeUndefined();
    });

    it("does not mark the route with x-upgrade by default", () => {
        const spec = new OpenApiSpec();
        class FakeRoute {}
        spec.addRoute("get-thing", "/thing", "get", { authRequired: false }, { description: "test" } as any, FakeRoute);
        const pathItem: any = spec.paths?.["/thing"];
        expect(pathItem["x-upgrade"]).toBeUndefined();
    });
});

describe("OpenApiSpec.addRoute query parameter naming", () => {
    it("documents an un-referenced query parameter under its own name, not the route handler's method name", () => {
        // Regression test: `mParams.push({ name, ... })` used the outer `addRoute` function parameter `name`
        // (the route handler's method name, e.g. "search") instead of `qName` (the actual query parameter
        // name, e.g. "term") — an inner `name` from an unrelated earlier loop (over :path parameters) had
        // gone out of scope by this point, so the identifier resolved to the wrong binding.
        const spec = new OpenApiSpec();
        class FakeRoute {
            public search() {
                return undefined;
            }
        }
        Reflect.defineMetadata("rrst:args", { 0: ["query", "term"] }, FakeRoute.prototype, "search");

        // Path includes ":id" so addRoute's "this is probably not a search endpoint" heuristic skips
        // auto-injecting the limit/page/sort parameter references — this bare, un-initialized OpenApiSpec
        // never registered those shared components, so referencing them here would push `undefined`
        // placeholders into the parameter list.
        spec.addRoute(
            "search",
            "/search/:id",
            "get",
            { authRequired: false },
            { description: "test" } as any,
            new FakeRoute(),
        );

        const params: any[] = spec.paths?.["/search/:id"]?.get?.parameters ?? [];
        expect(params).toEqual(expect.arrayContaining([expect.objectContaining({ name: "term", in: "query" })]));
        expect(params.some((p) => p.name === "search")).toBe(false);
    });
});
