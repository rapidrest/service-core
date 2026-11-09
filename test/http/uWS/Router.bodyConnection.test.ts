///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Real uWebSockets.js server (no fakes): what happens to the connection around a request body.
//  - A response sent before a streaming route's body has been read (an auth middleware's 401, a rate limiter's 429, a
//    size limit's 413) must reach the client. The rest of the body is read and discarded within UNREAD_BODY_DRAIN's
//    limits so the connection stays usable; past them the answer goes out with `Connection: close` and the connection
//    closes, so it can't be held open.
//  - A keep-alive connection that has just carried a large body must take the next request.
import crypto from "crypto";
import http from "http";
import net from "net";
import uWS from "uWebSockets.js";
import { UNREAD_BODY_DRAIN } from "../../../src/http/uWS/Adapters";
import { HttpRouter } from "../../../src/http/uWS/Router";

const PORT = 37945;
const MiB = 1024 * 1024;

/** Reads and hashes `req.bodyStream`, the way an upload route consumes it. */
async function hashBody(req: any, res: any): Promise<void> {
    const hash = crypto.createHash("sha256");
    let size = 0;
    for await (const chunk of req.bodyStream) {
        hash.update(chunk);
        size += chunk.length;
        // A slow consumer, so the stream fills up and pauses the connection (backpressure).
        if (size % (2 * MiB) < chunk.length) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    res.status(200).json({ sha256: hash.digest("hex"), size });
}

/** A middleware that refuses the request before anything has read the body. */
function refuse(_req: any, res: any): void {
    res.status(401).json({ error: "unauthorized" });
}

interface RawResult {
    /** Everything the server sent. */
    text: string;
    /** Whether the server closed the connection (FIN or reset) before the wait was over. */
    closed: boolean;
    /** The time from the request to the first byte of the response, or -1 for none. */
    firstByteMs: number;
    /** The time from the request until the connection closed, or -1. */
    closedMs: number;
}

/**
 * Sends the head of a request over a raw socket, then `bodyBytes` bytes of its body, and reports what came back within
 * `waitMs`. `trickle` then keeps writing `trickle()`'s output every 50 ms, like a slow client.
 */
function rawRequest(head: string, bodyBytes: number, waitMs: number, trickle?: () => string): Promise<RawResult> {
    return new Promise((resolve) => {
        const start = Date.now();
        let text = "";
        let firstByteMs = -1;
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        const socket = net.connect(PORT, "127.0.0.1", () => {
            // One write, so the body bytes arrive with the head: see the "over the drain limit" test.
            socket.write(Buffer.concat([Buffer.from(head), Buffer.alloc(bodyBytes, 1)]));
            if (trickle) {
                timer = setInterval(() => {
                    if (!socket.destroyed && socket.writable) socket.write(trickle());
                }, 50);
            }
        });
        const settle = (closed: boolean) => {
            if (settled) return;
            settled = true;
            clearInterval(timer);
            resolve({ text, closed, firstByteMs, closedMs: closed ? Date.now() - start : -1 });
        };
        socket.on("data", (chunk) => {
            if (firstByteMs < 0) firstByteMs = Date.now() - start;
            text += chunk.toString();
        });
        socket.on("error", () => settle(true));
        socket.on("close", () => settle(true));
        setTimeout(() => {
            settle(false);
            socket.destroy();
        }, waitMs);
    });
}

/** Posts `body` with Node's HTTP client and resolves the status and body, or the error the client saw. */
function post(
    urlPath: string,
    body: Buffer,
    agent?: http.Agent,
): Promise<{ status: number; body: string; error?: string; connection?: string }> {
    return new Promise((resolve) => {
        const req = http.request(
            {
                host: "127.0.0.1",
                port: PORT,
                path: urlPath,
                method: "POST",
                agent,
                headers: { "content-type": "application/octet-stream", "content-length": body.length },
            },
            (res) => {
                let text = "";
                res.on("data", (d) => (text += d.toString()));
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text, connection: res.headers.connection }));
            },
        );
        req.on("error", (err) => resolve({ status: 0, body: "", error: err.message }));
        req.end(body);
    });
}

function get(urlPath: string, agent: http.Agent): Promise<{ status: number; reusedSocket: boolean; ms: number }> {
    const start = Date.now();
    return new Promise((resolve, reject) => {
        const req = http.get({ host: "127.0.0.1", port: PORT, path: urlPath, agent, timeout: 4000 }, (res) => {
            res.resume();
            res.on("end", () => resolve({ status: res.statusCode ?? 0, reusedSocket: req.reusedSocket, ms: Date.now() - start }));
        });
        req.on("timeout", () => req.destroy(new Error("timed out")));
        req.on("error", reject);
    });
}

describe("HttpRouter request body and the connection (real uWS)", () => {
    let router: HttpRouter;

    beforeAll(async () => {
        router = new HttpRouter(uWS.App());
        router.post("/upload", { streamingBody: true }, hashBody);
        router.post("/refuse", { streamingBody: true }, refuse);
        // Reads the first 2 MiB, then refuses the rest, the way an upload route enforces its own size limit.
        router.post("/read-some", { streamingBody: true }, async (req: any, res: any) => {
            let size = 0;
            for await (const chunk of req.bodyStream) {
                size += chunk.length;
                if (size > 2 * MiB) break;
            }
            res.status(413).json({ error: "too large" });
        });
        router.post("/echo", (req: any, res: any) => {
            res.status(200).json({ size: req.rawBody?.length ?? 0 });
        });
        router.get("/ping", (_req: any, res: any) => {
            res.status(200).json({ ok: true });
        });
        await router.listen("127.0.0.1", PORT);
    });

    afterAll(async () => {
        await router.shutdown(2000);
    });

    describe("a response sent before the body was read", () => {
        const defaults = { ...UNREAD_BODY_DRAIN };
        afterEach(() => {
            Object.assign(UNREAD_BODY_DRAIN, defaults);
        });

        it("reaches a client that is still uploading a large body, and the connection stays usable", async () => {
            const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
            try {
                const result = await post("/refuse", crypto.randomBytes(8 * MiB), agent);
                expect(result.error).toBeUndefined();
                expect(result.status).toBe(401);
                expect(JSON.parse(result.body)).toEqual({ error: "unauthorized" });
                expect(result.connection).not.toBe("close");
                // The rest of the body was read and discarded, so the same connection takes the next request.
                const next = await get("/ping", agent);
                expect(next.status).toBe(200);
                expect(next.reusedSocket).toBe(true);
            } finally {
                agent.destroy();
            }
        });

        it("reaches a client whose route stopped reading part way, with the connection paused", async () => {
            const result = await post("/read-some", crypto.randomBytes(8 * MiB));
            expect(result.error).toBeUndefined();
            expect(result.status).toBe(413);
        });

        it("reaches a client uploading a chunked body", async () => {
            const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
                const req = http.request(
                    { host: "127.0.0.1", port: PORT, path: "/refuse", method: "POST", agent: false },
                    (res) => {
                        let text = "";
                        res.on("data", (d) => (text += d.toString()));
                        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
                    },
                );
                req.on("error", reject);
                // No Content-Length: Node sends the body chunked.
                for (let i = 0; i < 16; i++) req.write(crypto.randomBytes(256 * 1024));
                req.end();
            });
            expect(result.status).toBe(401);
            expect(JSON.parse(result.body)).toEqual({ error: "unauthorized" });
        });

        it("waits for the rest of a small body, then answers on a connection that stays open", async () => {
            const result = await new Promise<{ first: string; firstMs: number; second: string }>((resolve, reject) => {
                const start = Date.now();
                let text = "";
                let first = "";
                let firstMs = 0;
                const socket = net.connect(PORT, "127.0.0.1", () => {
                    socket.write("POST /refuse HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100000\r\n\r\n");
                    socket.write(Buffer.alloc(50000, 1));
                    // The rest arrives a little later, and the answer waits for it.
                    setTimeout(() => socket.write(Buffer.alloc(50000, 1)), 300);
                });
                socket.on("data", (chunk) => {
                    text += chunk.toString();
                    if (!first && text.includes(`{"error":"unauthorized"}`)) {
                        first = text;
                        firstMs = Date.now() - start;
                        text = "";
                        socket.write("GET /ping HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
                    } else if (first && text.includes(`{"ok":true}`)) {
                        socket.destroy();
                        resolve({ first, firstMs, second: text });
                    }
                });
                socket.on("error", reject);
                setTimeout(() => reject(new Error(`timed out: ${JSON.stringify(first + text)}`)), 3000);
            });
            expect(result.first).toMatch(/^HTTP\/1\.1 401 /);
            expect(result.first).not.toMatch(/connection: close/i);
            expect(result.firstMs).toBeGreaterThanOrEqual(250);
            expect(result.second).toMatch(/^HTTP\/1\.1 200 /);
        });

        // The client here stops sending. One that keeps sending after the connection closes can get a reset instead of
        // the answer, as from any server that closes without lingering: that is the cost of not reading it all.
        it("answers at once and closes when the rest of the declared body is over the drain limit", async () => {
            const result = await rawRequest(
                "POST /refuse HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 50000000000\r\n\r\n",
                1024,
                3000,
            );
            expect(result.text).toMatch(/^HTTP\/1\.1 401 /);
            expect(result.text).toMatch(/\r\nconnection: close\r\n/i);
            expect(result.text).toContain(`{"error":"unauthorized"}`);
            expect(result.closed).toBe(true);
            expect(result.closedMs).toBeLessThan(1000);
        });

        it("answers at once and closes for a client that declared a huge body and sent none of it", async () => {
            const result = await rawRequest(
                "POST /refuse HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 50000000000\r\n\r\n",
                0,
                3000,
            );
            expect(result.text).toMatch(/^HTTP\/1\.1 401 /);
            expect(result.closed).toBe(true);
            expect(result.closedMs).toBeLessThan(1000);
        });

        it("answers at once and closes when draining is turned off", async () => {
            UNREAD_BODY_DRAIN.maxBytes = 0;
            const result = await rawRequest(
                "POST /refuse HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 100000\r\n\r\n",
                10,
                3000,
            );
            expect(result.text).toMatch(/^HTTP\/1\.1 401 /);
            expect(result.text).toMatch(/\r\nconnection: close\r\n/i);
            expect(result.closed).toBe(true);
            expect(result.closedMs).toBeLessThan(1000);
        });

        it("does not let a client that trickles the body hold the connection past the drain timeout", async () => {
            UNREAD_BODY_DRAIN.timeoutMs = 500;
            const result = await rawRequest(
                "POST /refuse HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000000\r\n\r\n",
                1024,
                5000,
                () => "x",
            );
            expect(result.text).toMatch(/^HTTP\/1\.1 401 /);
            expect(result.text).toMatch(/\r\nconnection: close\r\n/i);
            expect(result.firstByteMs).toBeGreaterThanOrEqual(400);
            expect(result.closed).toBe(true);
            expect(result.closedMs).toBeLessThan(2000);
        });

        it("does not read a chunked body past the drain limit", async () => {
            UNREAD_BODY_DRAIN.maxBytes = 64 * 1024;
            const chunk = `8000\r\n${"y".repeat(0x8000)}\r\n`;
            const result = await rawRequest(
                "POST /refuse HTTP/1.1\r\nHost: 127.0.0.1\r\nTransfer-Encoding: chunked\r\n\r\n",
                0,
                5000,
                () => chunk,
            );
            expect(result.closed).toBe(true);
            // 64 KiB at 32 KiB every 50 ms: well before the 30 s timeout.
            expect(result.closedMs).toBeLessThan(2000);
        });

        it("answers a buffered route's oversized body with 413 instead of dropping the connection", async () => {
            const result = await post("/echo", crypto.randomBytes(12 * MiB));
            expect(result.error).toBeUndefined();
            expect(result.status).toBe(413);
        });
    });

    describe("keep-alive after a large body", () => {
        it("takes the next request on the same connection after a large streamed body", async () => {
            const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
            try {
                for (let i = 0; i < 3; i++) {
                    const payload = crypto.randomBytes(10 * MiB + 12345);
                    const upload = await post("/upload", payload, agent);
                    expect(upload.error).toBeUndefined();
                    expect(upload.status).toBe(200);
                    expect(JSON.parse(upload.body)).toEqual({
                        sha256: crypto.createHash("sha256").update(payload).digest("hex"),
                        size: payload.length,
                    });
                    const next = await get("/ping", agent);
                    expect(next.status).toBe(200);
                    expect(next.reusedSocket).toBe(true);
                    expect(next.ms).toBeLessThan(1000);
                }
            } finally {
                agent.destroy();
            }
        }, 30000);

        it("takes the next request on the same connection after a large buffered body", async () => {
            const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
            try {
                const upload = await post("/echo", crypto.randomBytes(10 * MiB - 1), agent);
                expect(upload.status).toBe(200);
                const next = await get("/ping", agent);
                expect(next.status).toBe(200);
                expect(next.reusedSocket).toBe(true);
                expect(next.ms).toBeLessThan(1000);
            } finally {
                agent.destroy();
            }
        }, 30000);
    });
});
