///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import * as fs from "fs";

import { default as config } from "./config";
import { Server } from "../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as uuid from "uuid";
import { requestws } from "../src/test/requestws.js";

import { JWTUtils } from "@rapidrest/core";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
vi.setConfig({ testTimeout: 60000 });

describe("Server WebSocket Tests", () => {
    const server: Server = new Server({ config, basePath: "./test/server" });

    beforeAll(async () => {
        // The default test port (3000) is also the one in the stock cors:origins entry, which would make that
        // entry indistinguishable from the same-origin case, so list a distinct origin for the allow-list tests.
        config.set("cors:origins", ["https://app.example.com"]);
        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        config.set("cors:origins", ["http://localhost:3000"]);
    });

    it("Can connect via unsecured WebSocket [anonymous]", async () => {
        expect(server.isRunning()).toBe(true);
        await requestws(server)
            .ws("/connect")
            .expectText("hello guest")
            .sendText("ping")
            .expectText("echo ping")
            .sendText("pong")
            .expectText("echo pong")
            .close()
            .expectClosed();
    });

    it("Can connect via unsecured WebSocket [anonymous] with query parameters", async () => {
        expect(server.isRunning()).toBe(true);
        // No parameters
        await requestws(server)
            .ws("/connect-query")
            .expectText("hello guest")
            .sendText("ping")
            .expectText("echo ping")
            .sendText("pong")
            .expectText("echo pong")
            .close()
            .expectClosed();
        // Message parameter no /
        await requestws(server)
            .ws("/connect-query?message=test2")
            .expectText("hello guest")
            .sendText("ping")
            .expectText("echo test2 ping")
            .sendText("pong")
            .expectText("echo test2 pong")
            .close()
            .expectClosed();
        // Message parameter with /
        await requestws(server)
            .ws("/connect-query/?message=test3")
            .expectText("hello guest")
            .sendText("ping")
            .expectText("echo test3 ping")
            .sendText("pong")
            .expectText("echo test3 pong")
            .close()
            .expectClosed();
        // Other parameter not captured
        await requestws(server)
            .ws("/connect-query?other=test4")
            .expectText("hello guest")
            .sendText("ping")
            .expectText("echo ping")
            .sendText("pong")
            .expectText("echo pong")
            .close()
            .expectClosed();
        // Message parameter with url encoded ?(%3F)
        await requestws(server)
            .ws("/connect-query/?message=test5%3F")
            .expectText("hello guest")
            .sendText("ping")
            .expectText("echo test5? ping")
            .sendText("pong")
            .expectText("echo test5? pong")
            .close()
            .expectClosed();
    });

    it("Can connect via unsecured WebSocket [user via header]", async () => {
        const user: any = { uid: uuid.v4() };
        const token = JWTUtils.createTokenSync(config.get("auth"), user);
        expect(server.isRunning()).toBe(true);
        await requestws(server)
            .ws("/connect", { headers: { Authorization: `jwt ${token}` } })
            .expectText("hello " + user.uid)
            .sendText("ping")
            .expectText("echo ping")
            .sendText("pong")
            .expectText("echo pong")
            .close()
            .expectClosed();
    });

    it("Can connect via unsecured WebSocket [user via handshake]", async () => {
        const user: any = { uid: uuid.v4() };
        const token = JWTUtils.createTokenSync(config.get("auth"), user);
        expect(server.isRunning()).toBe(true);
        await requestws(server)
            .ws("/connect")
            .sendJson({ id: 0, type: "LOGIN", data: token })
            .expectJson({ id: 0, type: "LOGIN_RESPONSE", success: true })
            .expectText("hello " + user.uid)
            .sendText("ping")
            .expectText("echo ping")
            .sendText("pong")
            .expectText("echo pong")
            .close()
            .expectClosed();
    });

    it("Cannot connect via secured WebSocket [anonymous]", async () => {
        expect(server.isRunning()).toBe(true);
        await requestws(server).ws("/connect-secure").expectClosed();
    });

    it("Can connect via secured WebSocket [user via header]", async () => {
        const user: any = { uid: uuid.v4() };
        const token = JWTUtils.createTokenSync(config.get("auth"), user);
        expect(server.isRunning()).toBe(true);
        await requestws(server)
            .ws("/connect-secure", { headers: { Authorization: `jwt ${token}` } })
            .expectText("hello " + user.uid)
            .sendText("ping")
            .expectText("echo ping")
            .sendText("pong")
            .expectText("echo pong")
            .close()
            .expectClosed();
    });

    it("Can connect via secured WebSocket [user via handshake]", async () => {
        const user: any = { uid: uuid.v4() };
        const token = JWTUtils.createTokenSync(config.get("auth"), user);
        expect(server.isRunning()).toBe(true);
        await requestws(server)
            .ws("/connect-secure")
            .sendJson({ id: 0, type: "LOGIN", data: token })
            .expectJson({ id: 0, type: "LOGIN_RESPONSE", success: true })
            .expectText("hello " + user.uid)
            .sendText("ping")
            .expectText("echo ping")
            .sendText("pong")
            .expectText("echo pong")
            .close()
            .expectClosed();
    });

    describe("Origin validation (cross-site WebSocket hijacking)", () => {
        const sameOrigin = () => `http://localhost:${server.port}`;

        it("accepts an origin on the cors:origins allow-list", async () => {
            await requestws(server)
                .ws("/connect", { headers: { Origin: "https://app.example.com" } })
                .expectText("hello guest")
                .close()
                .expectClosed();
        });

        it("accepts the own origin of the request", async () => {
            await requestws(server)
                .ws("/connect", { headers: { Origin: sameOrigin() } })
                .expectText("hello guest")
                .close()
                .expectClosed();
        });

        it("accepts a request with no Origin header (non-browser client)", async () => {
            await requestws(server).ws("/connect").expectText("hello guest").close().expectClosed();
        });

        it("rejects a foreign origin with 403 before upgrade", async () => {
            await expect(
                requestws(server)
                    .ws("/connect", { headers: { Origin: "https://evil.example.com" } })
                    .expectText("hello guest"),
            ).rejects.toThrow("403");
        });

        it("rejects a sibling-subdomain style origin and the literal null origin", async () => {
            for (const origin of ["http://sibling.localhost:" + server.port, "null"]) {
                await expect(
                    requestws(server).ws("/connect", { headers: { Origin: origin } }).expectText("hello guest"),
                ).rejects.toThrow("403");
            }
        });

        it("rejects a foreign origin even when the cookie would authenticate the socket", async () => {
            const token = JWTUtils.createTokenSync(config.get("auth"), { uid: uuid.v4() });
            await expect(
                requestws(server)
                    .ws("/connect-secure", { headers: { Origin: "https://evil.example.com", Cookie: `jwt=${token}` } })
                    .expectText("hello"),
            ).rejects.toThrow("403");
        });
    });
});
