///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Real-Bun smoke test for BunRouter — run via `bun test bun-smoke/router.smoke.test.ts`,
// NOT picked up by `yarn vitest run` (outside test/**) or `yarn lint`/`yarn build` (outside
// eslint's `./src ./test` scope and tsc's `include: ["src"]").
//
// The `test/http/bun/*.test.ts` Vitest suites already drive full branch/line coverage of
// BunRouter/BunAdapters/BunWebSocket by stubbing `globalThis.Bun` — this file exists to catch
// drift between that stub and what the real Bun runtime actually does, particularly around
// `Bun.serve()`'s real Request/Response/WebSocket handling. It intentionally does NOT contribute
// to the Vitest/v8 coverage numbers (Bun runs on JavaScriptCore, not V8 — there is no lcov output
// to merge here).
import { afterAll, beforeAll, expect, test } from "bun:test";
import { BunRouter } from "../src/http/bun/BunRouter.js";

const router = new BunRouter();
let baseUrl: string;

router.get("/hello/:name", (req, res) => {
    res.json({ hello: req.params.name, query: req.query });
});

router.post("/echo", (req, res) => {
    res.status(201).json(req.body);
});

router.ws("/chat", [
    (req, _res, next) => {
        req.websocket.on("message", (msg: Buffer) => {
            req.websocket.send(`echo:${msg}`);
        });
        req.wsHandled = true;
        next();
    },
]);

beforeAll(async () => {
    await router.listen("127.0.0.1", 0);
    baseUrl = `http://127.0.0.1:${router.listenPort}`;
});

afterAll(() => {
    router.close();
});

test("GET with :param and query string round-trips through real Bun.serve()", async () => {
    const res = await fetch(`${baseUrl}/hello/world?x=1`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world", query: { x: "1" } });
});

test("POST with a JSON body is read correctly from a real Bun Request stream", async () => {
    const res = await fetch(`${baseUrl}/echo`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ a: 1, b: "two" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ a: 1, b: "two" });
});

test("an unregistered path (after listen()) reaches the app-level NOT_FOUND fallback", async () => {
    const res = await fetch(`${baseUrl}/nope`);
    expect(res.status).toBe(404);
});

test("a real WebSocket connection upgrades, exchanges a message, and closes cleanly", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${router.listenPort}/chat`);

    await new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", (err) => reject(err), { once: true });
    });

    const echoed = new Promise<string>((resolve) => {
        ws.addEventListener(
            "message",
            (event) => resolve(typeof event.data === "string" ? event.data : event.data.toString()),
            { once: true },
        );
    });
    ws.send("ping");
    expect(await echoed).toBe("echo:ping");

    await new Promise<void>((resolve) => {
        ws.addEventListener("close", () => resolve(), { once: true });
        ws.close();
    });
});
