///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// A real Bun.serve() server (no fakes): the Bun counterpart of test/http/uWS/Router.bodyConnection.test.ts. A response
// sent before the request body was read must reach the client, a client that never sends its declared body must not
// hold the connection open for good, and a keep-alive connection that has just carried a large body must take the next
// request. Bun does not exist under Node, so the server runs in a child process started with the `bun` executable, and
// the suite is skipped where there is none.
import { spawn, spawnSync, type ChildProcess } from "child_process";
import crypto from "crypto";
import http from "http";
import net from "net";
import path from "path";

const PORT = 37962;
const MiB = 1024 * 1024;
const hasBun = spawnSync("bun", ["--version"], { stdio: "ignore" }).status === 0;

/** Posts `body` with Node's HTTP client and resolves the status and body, or the error the client saw. */
function post(
    urlPath: string,
    body: Buffer,
    agent?: http.Agent,
): Promise<{ status: number; body: string; error?: string }> {
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
                res.on("end", () => resolve({ status: res.statusCode ?? 0, body: text }));
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

describe.skipIf(!hasBun)("BunRouter request body and the connection (real Bun.serve())", () => {
    let child: ChildProcess;
    let output = "";

    beforeAll(async () => {
        child = spawn("bun", [path.resolve("test/helpers/bunBodyServer.ts"), String(PORT)], {
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

    it("answers a client that is still uploading a large body", async () => {
        const result = await post("/refuse", crypto.randomBytes(8 * MiB));
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(401);
        expect(JSON.parse(result.body)).toEqual({ error: "unauthorized" });
    });

    it("answers a client whose route stopped reading part way", async () => {
        const result = await post("/read-some", crypto.randomBytes(8 * MiB));
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(413);
    });

    it("answers a client that declared a body it never sends, and does not hold the connection for good", async () => {
        const result = await new Promise<{ text: string; closed: boolean }>((resolve) => {
            let text = "";
            let settled = false;
            const settle = (closed: boolean) => {
                if (settled) return;
                settled = true;
                resolve({ text, closed });
            };
            const socket = net.connect(PORT, "127.0.0.1", () => {
                socket.write("POST /refuse HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Length: 1000000\r\n\r\n");
            });
            socket.on("data", (chunk) => (text += chunk.toString()));
            socket.on("error", () => settle(true));
            socket.on("close", () => settle(true));
            // Bun's own idle timeout (10 s by default) is what closes such a connection.
            setTimeout(() => {
                settle(false);
                socket.destroy();
            }, 15000);
        });
        expect(result.text).toMatch(/^HTTP\/1\.1 401 /);
        expect(result.closed).toBe(true);
    }, 20000);

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

    it("takes the next request on the same connection after a refused large body", async () => {
        const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
        try {
            const refused = await post("/refuse", crypto.randomBytes(8 * MiB), agent);
            expect(refused.status).toBe(401);
            const next = await get("/ping", agent);
            expect(next.status).toBe(200);
            expect(next.ms).toBeLessThan(1000);
        } finally {
            agent.destroy();
        }
    }, 30000);
});
