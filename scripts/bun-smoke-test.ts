///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/**
 * Standalone smoke test for the Bun.serve()-backed HTTP adapter. Boots a real `Server` instance
 * under the Bun runtime (no database — see `bun-smoke-fixtures/`) and exercises HTTP + WebSocket
 * routes end-to-end using the same runtime-agnostic test helpers (`src/test/request.ts`,
 * `src/test/requestws.ts`) the Vitest suite uses against the uWS-backed path, proving the two
 * routers behave identically from the outside.
 *
 * Run via: `bun run scripts/bun-smoke-test.ts`
 */
import nconf from "nconf";
import { JWTUtils } from "@rapidrest/core";
import { Server } from "../src/index.js";
import { request } from "../src/test/request.js";
import { requestws } from "../src/test/requestws.js";

if (typeof (globalThis as any).Bun === "undefined") {
    console.error("This script must be run under Bun: `bun run scripts/bun-smoke-test.ts`");
    process.exit(1);
}

const config = nconf.argv().env({ separator: "__", lowerCase: true, parseValues: true });
config.use("memory");
config.defaults({
    service_name: "bun_smoke_test",
    datastores: {},
    rbac: { enabled: false },
    cors: { origins: ["http://localhost:3000"] },
    auth: {
        strategy: "auth.JWTStrategy",
        secret: "BunSmokeTestSecret",
        options: { expiresIn: "1h" },
    },
    // Deliberately small so the oversized-body test below trips the 413 path.
    max_body_size: 1024,
    static_files: "./scripts/bun-smoke-fixtures/static",
});

let failures = 0;
function assert(condition: boolean, message: string): void {
    if (condition) {
        console.log(`ok - ${message}`);
    } else {
        failures++;
        console.error(`FAIL - ${message}`);
    }
}

async function main(): Promise<void> {
    const server = new Server({ config, basePath: "./scripts/bun-smoke-fixtures" });
    await server.start();

    try {
        assert(server.isRunning(), "server starts under the Bun runtime");

        const hello = await request(server).get("/hello");
        assert(hello.status === 200 && hello.body.msg === "Hello World!", "GET /hello returns 200 with expected body");

        const param = await request(server).get("/echo/abc123");
        assert(param.status === 200 && param.body.id === "abc123", "GET /echo/:id resolves path params");

        // Regression coverage for :param decoding parity: uWS's getParameter() does NOT
        // percent-decode, so BunRouter must not either, or param values diverge between runtimes.
        const encodedParam = await request(server).get("/echo/john%20doe%2Fx");
        assert(
            encodedParam.status === 200 && encodedParam.body.id === "john%20doe%2Fx",
            "GET /echo/:id does NOT percent-decode param values, matching uWS's raw getParameter()",
        );

        const echoed = await request(server).post("/echo").send({ hello: "world" });
        assert(echoed.status === 200 && echoed.body.hello === "world", "POST /echo parses a JSON body");

        const big = { data: "x".repeat(4096) };
        const tooLarge = await request(server).post("/echo").send(big);
        assert(tooLarge.status === 413, "oversized POST body is rejected with 413");

        const notFound = await request(server).get("/does-not-exist");
        assert(notFound.status === 404, "unmatched route returns the JSON 404 fallback");

        const preflight = await request(server).options("/hello").set("Origin", "http://localhost:3000");
        assert(
            preflight.headers["access-control-allow-origin"] === "http://localhost:3000",
            "OPTIONS preflight applies CORS headers",
        );

        // Regression coverage for a prefixed wildcard route (`@Route("/static")` + `@Get("/*")`
        // registers as "/static/*"), which previously only matched the literal path "/static/*"
        // and never any real file — silently breaking BaseStaticRoute (and any other prefixed
        // wildcard route) under Bun.
        const staticFile = await request(server).get("/static/hello.txt");
        assert(
            staticFile.status === 200 && staticFile.text.includes("Hello from the Bun smoke test"),
            "GET /static/hello.txt matches a prefixed wildcard route (/static/*) and serves the file",
        );
        const staticBare = await request(server).get("/static");
        assert(
            staticBare.status === 404,
            "GET /static (no trailing slash) does NOT match /static/* — matches uWS's own wildcard boundary rule",
        );

        await requestws(server)
            .ws("/connect")
            .expectText("hello guest")
            .sendText("ping")
            .expectText("echo ping")
            .close()
            .expectClosed();
        console.log("ok - WebSocket /connect open/message/close roundtrip (anonymous)");

        const user = { uid: "smoke-user" };
        const token = JWTUtils.createTokenSync(config.get("auth"), user);

        await requestws(server)
            .ws("/connect-secure", { headers: { Authorization: `jwt ${token}` } })
            .expectText(`hello ${user.uid}`)
            .sendText("ping")
            .expectText("echo ping")
            .close()
            .expectClosed();
        console.log("ok - secured WebSocket /connect-secure via Authorization header (pre-upgrade auth)");

        await requestws(server)
            .ws("/connect-secure")
            .sendJson({ id: 0, type: "LOGIN", data: token })
            .expectJson({ id: 0, type: "LOGIN_RESPONSE", success: true })
            .expectText(`hello ${user.uid}`)
            .sendText("ping")
            .expectText("echo ping")
            .close()
            .expectClosed();
        console.log("ok - secured WebSocket /connect-secure via message-based LOGIN handshake");

        await requestws(server).ws("/connect-secure").expectClosed();
        console.log("ok - secured WebSocket /connect-secure rejects anonymous connections");

        // Regression coverage for BunResponse.writableEnded: a raw streaming handler that calls
        // flushHeaders()/write() and returns WITHOUT calling next() (the documented SSE pattern)
        // previously left runChain's promise permanently pending, since writableEnded never became
        // true until end() was explicitly called. Exercised directly against BunResponse/runChain
        // (rather than through a registered route) since decorator-wrapped routes always call
        // next() themselves via wrapMiddleware, which would mask this exact hang.
        {
            const { BunResponse } = await import("../src/http/bun/BunAdapters.js");
            const { runChain } = await import("../src/http/MiddlewareChain.js");
            const streamingHandler = (_req: any, res: any, _next: any) => {
                res.setHeader("content-type", "text/event-stream");
                res.flushHeaders();
                res.write("data: hello\n\n");
                res.end();
                // Deliberately no next() call — relies on writableEnded to end the chain.
            };
            const fakeReq = new Request("http://localhost/sse");
            const res = new BunResponse(fakeReq);
            const chainPromise = runChain([streamingHandler as any], {} as any, res as any);
            const timeout = new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("runChain did not resolve within 2s — likely hung")), 2000),
            );
            try {
                await Promise.race([chainPromise, timeout]);
                const streamedResponse = await res.responseReady;
                const text = await streamedResponse.text();
                assert(
                    text === "data: hello\n\n",
                    "runChain resolves (does not hang) for a streaming handler that returns without next(), and the streamed body is correct",
                );
            } catch (err: any) {
                assert(false, `runChain hung or errored for a streaming handler: ${err?.message ?? err}`);
            }
        }
    } finally {
        await server.stop();
    }

    if (failures > 0) {
        console.error(`\n${failures} Bun smoke test assertion(s) failed.`);
        process.exit(1);
    }
    console.log("\nAll Bun smoke test assertions passed.");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
