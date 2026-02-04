///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect } from "vitest";
import { default as config } from "./config.js";
import { ObjectFactory, OpenApiSpec, RouteUtils, AdminRoute } from "../src/index.js";
import express from "express";

import { Logger } from "@rapidrest/core";

describe("OpenApiSpec Tests", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());

    afterAll(async () => {
        await objectFactory.destroy();
    });

    const createSpec = async (): Promise<OpenApiSpec | undefined> => {
        objectFactory.clear();
        const apiSpec: OpenApiSpec | undefined = await objectFactory.newInstance(OpenApiSpec, { name: "default" });
        const admin: AdminRoute = await objectFactory.newInstance(AdminRoute);
        const routeUtils: RouteUtils = await objectFactory.newInstance(RouteUtils);
        await routeUtils.registerRoute(express(), admin);
        return apiSpec;
    }

    it("Can serve OpenAPI spec.", async () => {
        const apiSpec: OpenApiSpec | undefined = await createSpec();
        apiSpec?.addServer({ url: "http://localhost:3005" })

        const apiSpec1: OpenApiSpec | undefined = await createSpec();;
        apiSpec1?.addServer({ url: "http://localhost:3001" })
        apiSpec1?.addServer({ url: "http://localhost:3000" })

        const apiSpec2: OpenApiSpec | undefined = await createSpec();
        apiSpec2?.addServer({ url: "http://localhost:3000" })
        apiSpec2?.addServer({ url: "http://localhost:3001" })

        expect(apiSpec1).toBeDefined();
        if (apiSpec1) {
            expect(apiSpec1.openapi).toBe("3.1.0");
            expect(apiSpec1.servers).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    url: config.get("cluster_url")
                })
            ]));
            expect(apiSpec1.paths["/admin/clear-cache"].get?.summary).toEqual("api_service - flush second-level cache");
        }
        expect(apiSpec2).toBeDefined();
        if (apiSpec2) {
            expect(apiSpec2.openapi).toBe("3.1.0");
            expect(apiSpec2.servers).toEqual(expect.arrayContaining([
                expect.objectContaining({
                    url: config.get("cluster_url")
                })
            ]));
        }
        apiSpec.merge(apiSpec1?.getSpec());
        expect(apiSpec?.servers?.length).toEqual(4);
        expect(Object.entries(apiSpec?.paths).length).toEqual(5);
        for (const [key, value] of Object.entries(apiSpec?.paths)) {
            expect(value.get.security.length).toBe(1)
        }
        apiSpec.merge(apiSpec2?.getSpec());
        expect(apiSpec?.servers?.length).toEqual(4);
    });
});
