///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "fs";

import { default as config } from "./config.js";
import { Server } from "../src/index.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as http from "http";
import * as sqlite3 from "sqlite3";
import { v4 as uuidV4 } from "uuid";
import requestws from "superwstest";

import { JWTUtils } from "@rapidrest/core";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
const sqlite: sqlite3.Database = new sqlite3.Database(":memory:");

describe("Server WebSocket Tests", () => {
    const server: Server = new Server(config, "./test/server");

    beforeAll(async () => {
        await mongod.start();
        await server.start();
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        return await new Promise<void>((resolve) => {
            sqlite.close((err) => {
                if (err) {
                    console.log(err);
                }
                resolve();
            });
        });
    });

    it("Can connect via unsecured WebSocket [anonymous]", async () => {
        expect(server.isRunning()).toBe(true);
        const httpServer: http.Server | undefined = server.getServer();
        if (httpServer) {
            await requestws(httpServer)
                .ws("/connect")
                .expectText("hello guest")
                .sendText("ping")
                .expectText("echo ping")
                .sendText("pong")
                .expectText("echo pong")
                .close()
                .expectClosed();
        }
    });

    it("Can connect via unsecured WebSocket [anonymous] with query parameters", async () => {
        expect(server.isRunning()).toBe(true);
        const httpServer: http.Server | undefined = server.getServer();
        if (httpServer) {
            // No parameters
            await requestws(httpServer)
                .ws("/connect-query")
                .expectText("hello guest")
                .sendText("ping")
                .expectText("echo ping")
                .sendText("pong")
                .expectText("echo pong")
                .close()
                .expectClosed();
            // Message parameter no /
            await requestws(httpServer)
                .ws("/connect-query?message=test2")
                .expectText("hello guest")
                .sendText("ping")
                .expectText("echo test2 ping")
                .sendText("pong")
                .expectText("echo test2 pong")
                .close()
                .expectClosed();
            // Message parameter with /
            await requestws(httpServer)
                .ws("/connect-query/?message=test3")
                .expectText("hello guest")
                .sendText("ping")
                .expectText("echo test3 ping")
                .sendText("pong")
                .expectText("echo test3 pong")
                .close()
                .expectClosed();
            // Other parameter not captured
            await requestws(httpServer)
                .ws("/connect-query?other=test4")
                .expectText("hello guest")
                .sendText("ping")
                .expectText("echo ping")
                .sendText("pong")
                .expectText("echo pong")
                .close()
                .expectClosed();
            // Message parameter with url encoded ?(%3F)
            await requestws(httpServer)
                .ws("/connect-query/?message=test5%3F")
                .expectText("hello guest")
                .sendText("ping")
                .expectText("echo test5? ping")
                .sendText("pong")
                .expectText("echo test5? pong")
                .close()
                .expectClosed();
        }
    });

    it("Can connect via unsecured WebSocket [user via header]", async () => {
        const user: any = { uid: uuidV4() };
        const token = JWTUtils.createToken(config.get("auth"), user);
        expect(server.isRunning()).toBe(true);
        const httpServer: http.Server | undefined = server.getServer();
        if (httpServer) {
            await requestws(httpServer)
                .ws("/connect", { headers: { Authorization: `jwt ${token}` } })
                .expectText("hello " + user.uid)
                .sendText("ping")
                .expectText("echo ping")
                .sendText("pong")
                .expectText("echo pong")
                .close()
                .expectClosed();
        }
    });

    it("Can connect via unsecured WebSocket [user via handshake]", async () => {
        const user: any = { uid: uuidV4() };
        const token = JWTUtils.createToken(config.get("auth"), user);
        expect(server.isRunning()).toBe(true);
        const httpServer: http.Server | undefined = server.getServer();
        if (httpServer) {
            await requestws(httpServer)
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
        }
    });

    it("Cannot connect via secured WebSocket [anonymous]", async () => {
        expect(server.isRunning()).toBe(true);
        const httpServer: http.Server | undefined = server.getServer();
        if (httpServer) {
            await requestws(httpServer).ws("/connect-secure").expectClosed();
        }
    });

    it("Can connect via secured WebSocket [user via header]", async () => {
        const user: any = { uid: uuidV4() };
        const token = JWTUtils.createToken(config.get("auth"), user);
        expect(server.isRunning()).toBe(true);
        const httpServer: http.Server | undefined = server.getServer();
        if (httpServer) {
            await requestws(httpServer)
                .ws("/connect-secure", { headers: { Authorization: `jwt ${token}` } })
                .expectText("hello " + user.uid)
                .sendText("ping")
                .expectText("echo ping")
                .sendText("pong")
                .expectText("echo pong")
                .close()
                .expectClosed();
        }
    });

    it("Can connect via secured WebSocket [user via handshake]", async () => {
        const user: any = { uid: uuidV4() };
        const token = JWTUtils.createToken(config.get("auth"), user);
        expect(server.isRunning()).toBe(true);
        const httpServer: http.Server | undefined = server.getServer();
        if (httpServer) {
            await requestws(httpServer)
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
        }
    });
});
