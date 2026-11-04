///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Covers the `websocket:allowedOrigins` / `websocket:checkOrigin` overrides end-to-end. These are read once when
// the server's RouteUtils is created, so they must be set before `server.start()`, hence a dedicated server
// (the default-config behaviour is covered in Server.WebSocket.test.ts).
import { default as config } from "./config";
import { Server } from "../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import { requestws } from "../src/test/requestws.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
vi.setConfig({ testTimeout: 60000 });

describe("Server WebSocket Origin override Tests", () => {
    const server: Server = new Server({ config, basePath: "./test/server" });

    beforeAll(async () => {
        config.set("cors:origins", ["https://cors.example.com"]);
        config.set("websocket:allowedOrigins", ["https://app.example.com"]);
        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        config.clear("websocket:allowedOrigins");
        config.set("cors:origins", ["http://localhost:3000"]);
    });

    it("accepts an origin listed in websocket:allowedOrigins", async () => {
        await requestws(server)
            .ws("/connect", { headers: { Origin: "https://app.example.com" } })
            .expectText("hello guest")
            .close()
            .expectClosed();
    });

    it("no longer falls back to cors:origins once websocket:allowedOrigins is set", async () => {
        await expect(
            requestws(server).ws("/connect", { headers: { Origin: "https://cors.example.com" } }).expectText("hello guest"),
        ).rejects.toThrow("403");
    });

    it("still accepts the own origin and rejects a foreign origin", async () => {
        await requestws(server)
            .ws("/connect", { headers: { Origin: `http://localhost:${server.port}` } })
            .expectText("hello guest")
            .close()
            .expectClosed();
        await expect(
            requestws(server).ws("/connect", { headers: { Origin: "https://evil.example.com" } }).expectText("hello guest"),
        ).rejects.toThrow("403");
    });
});
