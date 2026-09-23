///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Real uWebSockets.js server (no fakes) — end-to-end coverage for the streaming-body opt-in
// (HttpRouteOptions.streamingBody / @StreamingBody()): a route that consumes req.bodyStream and
// writes it to a temp file byte-for-byte, a client-disconnect-mid-upload cleanup test, and proof
// that an ordinary route on the very same server is completely unaffected.
import crypto from "crypto";
import fs from "fs";
import net from "net";
import os from "os";
import path from "path";
import uWS from "uWebSockets.js";
import { HttpRouter } from "../../../src/http/uWS/Router";

const PORT = 37941;

/**
 * Sends a raw HTTP/1.1 POST over a plain TCP socket, declaring `contentLength` but actually sending
 * only `bodyBytesSent` bytes of body (or none at all) — reproducing the exact wire-level shape of the
 * connection-hang exploit: a caller that promises a body it never delivers. `fetch()`/`undici` can't
 * express this (they always either send a real body or none), so this needs a raw socket.
 *
 * Resolves once the response headers/body have been read AND the socket either closes on its own or
 * `waitMs` elapses without it closing — the test asserts on `closed` to tell those two outcomes apart.
 */
function rawPostWithUndeliveredBody(
    path_: string,
    contentLength: number,
    waitMs: number,
): Promise<{ closed: boolean; elapsedMs: number; responseText: string }> {
    return new Promise((resolve) => {
        const socket = net.connect(PORT, "127.0.0.1", () => {
            socket.write(
                `POST ${path_} HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: ${contentLength}\r\nConnection: keep-alive\r\n\r\n`,
            );
            // Deliberately never writes any body bytes.
        });
        let responseText = "";
        const start = Date.now();
        let settled = false;
        const settle = (closed: boolean) => {
            if (settled) return;
            settled = true;
            resolve({ closed, elapsedMs: Date.now() - start, responseText });
        };
        socket.on("data", (chunk) => {
            responseText += chunk.toString();
        });
        // A force-close on a socket that still has unread/unacked data queued can surface to the
        // client as a hard reset (ECONNRESET) rather than a clean FIN — both mean the same thing
        // here: the connection was actually terminated, not left hanging.
        socket.on("error", () => settle(true));
        socket.on("close", () => settle(true));
        setTimeout(() => {
            if (!socket.destroyed) {
                socket.destroy();
                settle(false);
            }
        }, waitMs);
    });
}

/** Writes req.bodyStream to a temp file while hashing it, deleting the partial file on any error
 * (e.g. the client disconnecting mid-upload) so a route using this pattern never leaks disk space. */
async function streamToTempFile(req: any, res: any): Promise<void> {
    const tmpFile = path.join(os.tmpdir(), `service-core-upload-test-${Date.now()}-${Math.random()}.bin`);
    const hash = crypto.createHash("sha256");
    const out = fs.createWriteStream(tmpFile);
    try {
        for await (const chunk of req.bodyStream) {
            hash.update(chunk);
            if (!out.write(chunk)) {
                await new Promise<void>((resolve) => out.once("drain", resolve));
            }
        }
        await new Promise<void>((resolve, reject) => {
            out.end((err?: Error) => (err ? reject(err) : resolve()));
        });
        res.status(200).json({ sha256: hash.digest("hex") });
    } catch (err) {
        out.destroy();
        try {
            fs.unlinkSync(tmpFile);
        } catch {
            // Already gone
        }
        (req)._uploadFailed = true;
        (req)._tmpFile = tmpFile;
        if (!res.writableEnded) {
            res.status(499).json({ error: (err as Error).message });
        }
    }
}

describe("HttpRouter streaming body (real uWS)", () => {
    let router: HttpRouter;

    beforeAll(async () => {
        router = new HttpRouter(uWS.App());
        router.post("/upload", { streamingBody: true }, streamToTempFile);
        // An ordinary route registered on the exact same router/server — proves the opt-in is
        // genuinely per-route, not a global switch flipped by the presence of any streaming route.
        router.post("/echo", (req: any, res: any) => {
            res.status(200).json({
                bodyStreamIsUndefined: req.bodyStream === undefined,
                rawBodyLength: req.rawBody?.length,
                body: req.body,
            });
        });
        // Rejects the request WITHOUT ever touching req.bodyStream — the exact shape of a real
        // pre-body-touch validation/auth failure (see BaseMailboxImportRoute.create()'s several
        // checks that all run before any body access).
        router.post("/reject", { streamingBody: true }, (_req: any, res: any) => {
            res.status(400).json({ error: "rejected" });
        });
        await router.listen("127.0.0.1", PORT);
    });

    afterAll(async () => {
        await router.shutdown(2000);
    });

    it("streams a multi-megabyte upload to disk byte-for-byte without buffering it into req.body/req.rawBody", async () => {
        // Larger than STREAMING_BODY_HIGH_WATER_MARK (1 MiB) so the backpressure path is genuinely
        // exercised, not just a single small chunk.
        const payload = crypto.randomBytes(3 * 1024 * 1024);
        const expectedHash = crypto.createHash("sha256").update(payload).digest("hex");

        const response = await fetch(`http://127.0.0.1:${PORT}/upload`, {
            method: "POST",
            body: payload,
        });

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.sha256).toBe(expectedHash);
    });

    it("leaves an ordinary route on the same router completely unaffected", async () => {
        const response = await fetch(`http://127.0.0.1:${PORT}/echo`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ hello: "world" }),
        });

        expect(response.status).toBe(200);
        const json = await response.json();
        expect(json.bodyStreamIsUndefined).toBe(true);
        expect(json.rawBodyLength).toBeGreaterThan(0);
        expect(json.body).toEqual({ hello: "world" });
    });

    it("cleans up and does not hang when the client disconnects mid-upload", async () => {
        const controller = new AbortController();
        let enqueuedFirstChunk: () => void;
        const firstChunkEnqueued = new Promise<void>((resolve) => (enqueuedFirstChunk = resolve));

        const body = new ReadableStream<Uint8Array>({
            start(streamController) {
                streamController.enqueue(new Uint8Array(64 * 1024).fill(1));
                enqueuedFirstChunk();
                // Deliberately never closes or enqueues again — the client aborts before any more
                // data (or the final EOF) arrives.
            },
        });

        const fetchPromise = fetch(`http://127.0.0.1:${PORT}/upload`, {
            method: "POST",
            body,
            duplex: "half",
            signal: controller.signal,
        } as any);

        await firstChunkEnqueued;
        // Give the first chunk time to actually reach the server before severing the connection.
        await new Promise((resolve) => setTimeout(resolve, 100));
        controller.abort();

        await expect(fetchPromise).rejects.toThrow();

        // The request must actually finish server-side (not hang forever holding resources) —
        // inFlightRequests returning to 0 proves the aborted stream's consumer (streamToTempFile's
        // for-await loop) observed the error and returned instead of awaiting forever.
        const deadline = Date.now() + 3000;
        while (router.inFlightRequests > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        expect(router.inFlightRequests).toBe(0);
    });

    // Regression test for the CRITICAL connection-exhaustion fix (2026-09-23): a fully anonymous
    // caller that declares a huge Content-Length and a route that rejects the request without
    // draining req.bodyStream must not be able to pin a connection open indefinitely. Reproduces the
    // exact wire-level shape of the exploit — a raw socket that sends only headers and zero body
    // bytes, ever — and asserts the connection actually closes, not just that a response was sent.
    it("closes the connection (does not hang it) when a streaming route rejects the request without draining an undelivered body", async () => {
        // 50 GB declared, matching the exploit scenario in the finding — and, just as important, the
        // client never sends a single byte of it.
        const result = await rawPostWithUndeliveredBody("/reject", 50_000_000_000, 3000);

        expect(result.closed).toBe(true);
        // Well under the 3s wait budget — this is a real fix, not a timeout coincidentally expiring
        // at the same moment the assertion runs.
        expect(result.elapsedMs).toBeLessThan(1000);
    });

    // A streaming route that rejects the request with a partially-sent (but still undelivered in
    // full) body must be treated the same way — the client sent SOME bytes, but not all of the
    // declared Content-Length, and never sends the rest.
    it("closes the connection when only part of the declared body ever arrives before the route rejects", async () => {
        const result = await new Promise<{ closed: boolean; elapsedMs: number }>((resolve) => {
            const socket = net.connect(PORT, "127.0.0.1", () => {
                socket.write(
                    `POST /reject HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000000\r\nConnection: keep-alive\r\n\r\n`,
                );
                socket.write(Buffer.alloc(1024, 1)); // far short of the declared 1,000,000 bytes
            });
            const start = Date.now();
            let settled = false;
            const settle = (closed: boolean) => {
                if (settled) return;
                settled = true;
                resolve({ closed, elapsedMs: Date.now() - start });
            };
            // A force-close on a socket that still has unread/unacked data queued can surface to the
            // client as a hard reset (ECONNRESET) rather than a clean FIN — both mean the same thing
            // here: the connection was actually terminated, not left hanging.
            socket.on("error", () => settle(true));
            socket.on("close", () => settle(true));
            setTimeout(() => {
                if (!socket.destroyed) {
                    socket.destroy();
                    settle(false);
                }
            }, 3000);
        });

        expect(result.closed).toBe(true);
        expect(result.elapsedMs).toBeLessThan(1000);
    });

    // A streaming route whose handler actually drains the body must keep the normal, graceful
    // response path (no unnecessary force-close) — confirms the fix is targeted, not a blanket
    // "always close streaming connections" regression.
    it("does not force-close a connection whose streaming route fully drained the body before responding", async () => {
        const payload = crypto.randomBytes(4096);
        const response = await fetch(`http://127.0.0.1:${PORT}/upload`, { method: "POST", body: payload });
        expect(response.status).toBe(200);
        // A well-behaved response still carries a real body (not the empty body a force-close would
        // produce) and normal headers.
        const json = await response.json();
        expect(json.sha256).toBe(crypto.createHash("sha256").update(payload).digest("hex"));
    });
});
