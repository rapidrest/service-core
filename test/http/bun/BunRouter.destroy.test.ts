///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// A real Bun.serve() server (no fakes) for `BunResponse.destroy()`: the unit tests in BunAdapters.test.ts can only
// show what the adapter does to its stream, not what Bun then does to the connection. Bun does not exist under Node, so
// the server runs in a child process started with the `bun` executable, and the suite is skipped where there is none.
import { spawn, spawnSync, type ChildProcess } from "child_process";
import http from "http";
import path from "path";

const PORT = 37961;
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;

describe.skipIf(!hasBun)("BunResponse.destroy() (real Bun.serve())", () => {
    let child: ChildProcess;
    let output = "";

    beforeAll(async () => {
        child = spawn("bun", [path.resolve("test/helpers/bunDestroyServer.ts"), String(PORT)], {
            stdio: ["ignore", "pipe", "pipe"],
        });
        child.stderr!.on("data", (d) => (output += d.toString()));
        await new Promise<void>((resolve, reject) => {
            child.once("error", reject);
            child.once("exit", (code) => reject(new Error(`fixture exited early (${code}): ${output}`)));
            child.stdout!.on("data", (d) => d.toString().includes("ready") && resolve());
        });
        child.removeAllListeners("exit");
    }, 30000);

    afterAll(() => {
        child?.kill();
    });

    /** Issues a GET with Node's own HTTP client and reports how the transfer ended. */
    const get = (urlPath: string) =>
        new Promise<{ status: number; body: string; complete: boolean; failed: boolean }>((resolve) => {
            let responded = false;
            const req = http.get({ host: "127.0.0.1", port: PORT, path: urlPath }, (res) => {
                responded = true;
                let body = "";
                let failed = false;
                res.on("data", (d) => (body += d.toString()));
                res.on("aborted", () => (failed = true));
                res.on("error", () => (failed = true));
                res.on("close", () => resolve({ status: res.statusCode ?? 0, body, complete: res.complete, failed }));
            });
            // Also raised for a response that failed part way, which is reported through the response instead.
            req.on("error", () => !responded && resolve({ status: 0, body: "", complete: false, failed: true }));
        });

    it("completes a stream that ends normally", async () => {
        const result = await get("/ok");
        expect(result).toEqual({ status: 200, body: "first,second", complete: true, failed: false });
    });

    it("cuts a stream that is destroyed part way: the client gets what was sent, then a failed transfer", async () => {
        const result = await get("/destroy-late");
        expect(result.status).toBe(200);
        expect(result.body).toBe("first,second");
        expect(result.complete).toBe(false);
        expect(result.failed).toBe(true);
    });

    it("answers a response destroyed before it started with a 500 and no body", async () => {
        const result = await get("/destroy-early");
        expect(result.status).toBe(500);
        expect(result.body).toBe("");
    });
});
