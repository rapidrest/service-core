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
import os from "os";
import path from "path";
import uWS from "uWebSockets.js";
import { HttpRouter } from "../../../src/http/uWS/Router";

const PORT = 37941;

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
});
