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

    describe("Required auth options (loginFallback, authCloseCode, authCloseReason)", () => {
        it("closes at once with the route's code and reason when loginFallback is off [anonymous]", async () => {
            const started = Date.now();
            await requestws(server).ws("/connect-strict").expectClosed(4001, "auth required");
            expect(Date.now() - started).toBeLessThan(1500); // well under the 2 s LOGIN wait
        });

        it("does not read a LOGIN frame when loginFallback is off", async () => {
            const user: any = { uid: uuid.v4() };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            await requestws(server)
                .ws("/connect-strict")
                .sendJson({ id: 0, type: "LOGIN", data: token })
                .expectClosed(4001, "auth required");
        });

        it("closes with 4001 for an invalid token in the header", async () => {
            await requestws(server)
                .ws("/connect-strict", { headers: { Authorization: "jwt not-a-token" } })
                .expectClosed(4001, "auth required");
        });

        it("accepts a valid header when loginFallback is off", async () => {
            const user: any = { uid: uuid.v4() };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            await requestws(server)
                .ws("/connect-strict", { headers: { Authorization: `jwt ${token}` } })
                .expectText("hello " + user.uid)
                .sendText("ping")
                .expectText("echo ping")
                .close()
                .expectClosed();
        });

        it("keeps the LOGIN fallback by default and still accepts a LOGIN with a custom code set", async () => {
            const user: any = { uid: uuid.v4() };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            await requestws(server)
                .ws("/connect-code")
                .sendJson({ id: 0, type: "LOGIN", data: token })
                .expectJson({ id: 0, type: "LOGIN_RESPONSE", success: true })
                .expectText("hello " + user.uid)
                .close()
                .expectClosed();
        });

        it("uses the custom code when a LOGIN token is bad, and the default code elsewhere", async () => {
            await requestws(server)
                .ws("/connect-code")
                .sendJson({ id: 0, type: "LOGIN", data: "bad" })
                .expectClosed(4001);
            // Unchanged default route: 1002
            await requestws(server).ws("/connect-secure").expectClosed(1002);
        });
    });

    describe("Send backpressure", () => {
        it("reports bufferedAmount and drain for a slow client", async () => {
            const { WebSocket } = await import("ws");
            const client = new WebSocket(`ws://localhost:${server.port}/connect-flood`);
            const ready = new Promise<void>((resolve) => client.once("message", () => resolve()));
            await new Promise<void>((resolve, reject) => {
                client.once("open", () => resolve());
                client.once("error", reject);
            });
            // The route's optional auth waits for a LOGIN frame first, so wait for its greeting before sending.
            await ready;
            // Stop reading so the server's frames pile up in its send buffer.
            (client as any)._socket.pause();
            const status = new Promise<string>((resolve) => {
                client.on("message", (data, isBinary) => {
                    if (!isBinary) resolve(data.toString());
                });
            });
            client.send("flood");
            await new Promise((r) => setTimeout(r, 500));
            (client as any)._socket.resume();
            const text = await Promise.race([
                status,
                new Promise<string>((_, rej) => setTimeout(() => rej(new Error("no status")), 20000)),
            ]);
            client.terminate();
            expect(text).toContain("buffered=true needDrain=true");
            expect(text).toContain("onDrain");
            expect(text).toContain("drained=true buffered=0 needDrain=false");
        });
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
