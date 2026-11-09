///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Child-process fixture for test/http/bun/BunRouter.bodyConnection.test.ts, run with `bun` (Bun.serve() does not exist
// under Node, so the real Bun server can only be exercised from its own process).
//
// Usage: bun bunBodyServer.ts <port>
// Routes:
//   POST /upload     streaming body: reads and hashes it, answers { sha256, size }
//   POST /refuse     streaming body: answers 401 without reading it
//   POST /read-some  streaming body: reads 2 MiB, then answers 413
//   POST /echo       buffered body: answers { size }
//   GET  /ping       answers { ok: true }
import crypto from "crypto";
import { BunRouter } from "../../src/http/bun/BunRouter";

const port = Number(process.argv[2]);
const MiB = 1024 * 1024;

const router = new BunRouter();
router.post("/upload", { streamingBody: true }, async (req: any, res: any) => {
    const hash = crypto.createHash("sha256");
    let size = 0;
    for await (const chunk of req.bodyStream) {
        hash.update(chunk);
        size += chunk.length;
        if (size % (2 * MiB) < chunk.length) await new Promise((resolve) => setTimeout(resolve, 5));
    }
    res.status(200).json({ sha256: hash.digest("hex"), size });
});
router.post("/refuse", { streamingBody: true }, (_req: any, res: any) => {
    res.status(401).json({ error: "unauthorized" });
});
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

void router.listen("127.0.0.1", port).then(() => {
    process.stdout.write("ready\n");
});
