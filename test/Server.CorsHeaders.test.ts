///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Covers `cors:allowedHeaders` / `cors:exposedHeaders`. They are read when the server starts, so they must be set
// before `server.start()`, hence a dedicated server (the default CORS behaviour is covered in Server.test.ts).
import { default as config } from "./config";
import { Server } from "../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import { request } from "../src/test/request.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
vi.setConfig({ testTimeout: 60000 });

config.set("port", 39201);

describe("Server CORS header options Tests", () => {
    const server: Server = new Server({ config, basePath: "./test/server" });
    const origin = "https://app.example.com";

    beforeAll(async () => {
        config.set("cors:origins", [origin]);
        // A list (with padding, a duplicate and an empty entry) and a comma separated string are both accepted.
        config.set("cors:allowedHeaders", ["X-File-Name", " X-Access-Reason ", "Accept", ""]);
        config.set("cors:exposedHeaders", "X-Total-Count, Retry-After");
        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        config.clear("port");
        config.clear("cors:allowedHeaders");
        config.clear("cors:exposedHeaders");
        config.set("cors:origins", ["http://localhost:3000"]);
    });

    it("appends cors:allowedHeaders to the built-in list without duplicates", async () => {
        const result = await request(server).options("/").set("Origin", origin);
        expect(result.status).toBe(204);
        expect(String(result.headers["access-control-allow-headers"]).split(", ")).toEqual([
            "Accept",
            "Authorization",
            "Content-Type",
            "Location",
            "Origin",
            "Set-Cookie",
            "X-Requested-With",
            "X-File-Name",
            "X-Access-Reason",
        ]);
    });

    it("sends cors:exposedHeaders as Access-Control-Expose-Headers, and only for an allowed origin", async () => {
        const result = await request(server).get("/hello").set("Origin", origin);
        expect(result.headers["access-control-expose-headers"]).toEqual("X-Total-Count, Retry-After");
        const foreign = await request(server).get("/hello").set("Origin", "https://evil.example.com");
        expect(foreign.headers["access-control-expose-headers"]).not.toBeDefined();
        expect(foreign.headers["access-control-allow-origin"]).not.toBeDefined();
    });
});
