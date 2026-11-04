///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Real uWebSockets.js server (no fakes) — end-to-end coverage for streaming a response from outside of the
// synchronous part of a handler: writes must be corked (no uWS warning), `write()` must report backpressure and
// `waitForDrain()` must resume after it, and a client abort must let the producer stop.
import { spawn, type ChildProcess } from "child_process";
import crypto from "crypto";
import net from "net";
import path from "path";
import uWS from "uWebSockets.js";
import { HttpRouter } from "../../../src/http/uWS/Router";

const PORT = 37942;
const CHILD_PORT = 37943;
const CORK_WARNING = "corked callback";

describe("HttpRouter streaming responses (real uWS)", () => {
    describe("outside of the synchronous handler (child process)", () => {
        let child: ChildProcess;
        let stderr = "";

        beforeAll(async () => {
            child = spawn(
                process.execPath,
                ["--import", "tsx", path.resolve("test/helpers/streamingResponseServer.ts"), String(CHILD_PORT)],
                { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "" } },
            );
            child.stderr!.on("data", (d) => (stderr += d.toString()));
            await new Promise<void>((resolve, reject) => {
                child.once("error", reject);
                child.once("exit", (code) => reject(new Error(`fixture exited early (${code}): ${stderr}`)));
                child.stdout!.on("data", (d) => d.toString().includes("ready") && resolve());
            });
            child.removeAllListeners("exit");
        }, 30000);

        afterAll(() => {
            child?.kill();
        });

        // 600 x 8 KiB = 4.7 MiB in many async writes.
        for (const mode of ["backpressure", "ignore"]) {
            it(`delivers several MB intact without the uncorked-write warning [${mode}]`, async () => {
                stderr = "";
                const chunks = 600;
                const size = 8 * 1024;
                const expected = crypto.createHash("sha256");
                for (let i = 0; i < chunks; i++) expected.update(Buffer.alloc(size, i % 251));

                const response = await fetch(
                    `http://127.0.0.1:${CHILD_PORT}/big?chunks=${chunks}&size=${size}&mode=${mode}`,
                );
                expect(response.status).toBe(200);
                const body = Buffer.from(await response.arrayBuffer());
                expect(body.length).toBe(chunks * size);
                expect(crypto.createHash("sha256").update(body).digest("hex")).toBe(expected.digest("hex"));
                expect(stderr).not.toContain(CORK_WARNING);
            });
        }
    });

    describe("backpressure and abort (in process)", () => {
        let router: HttpRouter;
        const state: any = {};

        beforeAll(async () => {
            router = new HttpRouter(uWS.App());
            router.get("/slow-client", async (_req: any, res: any) => {
                state.sawBackpressure = false;
                state.resumedAfterDrain = false;
                state.written = 0;
                await new Promise((r) => setTimeout(r, 5));
                res.status(200);
                const chunk = Buffer.alloc(256 * 1024, 7);
                // 64 MiB is far more than the kernel socket buffers, so a client that is not reading must
                // eventually cause write() to report backpressure.
                for (let i = 0; i < 256; i++) {
                    const ok = res.write(chunk);
                    state.written += chunk.length;
                    if (!ok) {
                        state.sawBackpressure = true;
                        state.writtenAtBackpressure = state.written;
                        state.needDrain = res.writableNeedDrain;
                        if (!(await res.waitForDrain())) return;
                        state.resumedAfterDrain = true;
                        state.needDrainAfter = res.writableNeedDrain;
                    }
                }
                res.end();
            });
            router.get("/abortable", async (_req: any, res: any) => {
                state.abortStopped = false;
                state.abortCallbacks = 0;
                state.abortWrites = 0;
                res.onAbort(() => state.abortCallbacks++);
                await new Promise((r) => setTimeout(r, 5));
                res.status(200);
                const chunk = Buffer.alloc(256 * 1024, 1);
                // An endless producer: only the abort can stop it.
                for (;;) {
                    if (res.aborted) break;
                    const ok = res.write(chunk);
                    state.abortWrites++;
                    if (!ok && !(await res.waitForDrain())) break;
                    await new Promise((r) => setImmediate(r));
                }
                state.abortStopped = true;
            });
            await router.listen("127.0.0.1", PORT);
        });

        afterAll(async () => {
            await router.shutdown(2000);
        });

        const get = (urlPath: string): Promise<net.Socket> =>
            new Promise((resolve) => {
                const socket = net.connect(PORT, "127.0.0.1", () => {
                    socket.write(`GET ${urlPath} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
                    resolve(socket);
                });
            });

        it("write() returns false when the client is not reading, and resumes once it drains", async () => {
            const socket = await get("/slow-client");
            socket.pause(); // the client stops reading: kernel buffers fill, then uWS buffers, then write() === false
            await vi.waitFor(() => expect(state.sawBackpressure).toBe(true), { timeout: 10000 });
            expect(state.needDrain).toBe(true);
            // Backpressure appeared long before the producer ran out of data, i.e. it was told to slow down.
            // (Whether uWS also drains on its own while the client is paused depends on kernel buffer
            // autotuning, so nothing is asserted about the stalled period itself.)
            expect(state.writtenAtBackpressure).toBeLessThan(256 * 256 * 1024);

            let received = 0;
            socket.on("data", (d) => (received += d.length));
            // Listen for close before resuming: once the client reads again the rest of the body crosses loopback in
            // milliseconds, so the socket can close between vi.waitFor's polls and a later listener would never fire.
            const closed = new Promise<void>((resolve) => socket.once("close", () => resolve()));
            socket.resume();
            await vi.waitFor(() => expect(state.resumedAfterDrain).toBe(true), { timeout: 10000 });
            expect(state.needDrainAfter).toBe(false);
            await closed;
            expect(received).toBeGreaterThanOrEqual(256 * 256 * 1024);
        }, 30000);

        it("a client abort fires onAbort and stops the producer", async () => {
            const socket = await get("/abortable");
            let received = 0;
            socket.on("data", (d) => (received += d.length));
            await vi.waitFor(() => expect(received).toBeGreaterThan(0), { timeout: 5000 });
            socket.destroy();
            await vi.waitFor(() => expect(state.abortStopped).toBe(true), { timeout: 5000 });
            expect(state.abortCallbacks).toBe(1);
            const writes = state.abortWrites;
            await new Promise((r) => setTimeout(r, 100));
            expect(state.abortWrites).toBe(writes);
            await vi.waitFor(() => expect(router.inFlightRequests).toBe(0), { timeout: 3000 });
        }, 30000);
    });
});
