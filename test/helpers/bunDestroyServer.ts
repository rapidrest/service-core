///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Child-process fixture for test/http/bun/BunRouter.destroy.test.ts, run with `bun` (Bun.serve() does not exist under
// Node, so the real Bun server can only be exercised from its own process).
//
// Usage: bun bunDestroyServer.ts <port>
// Routes:
//   GET /ok            streams two chunks and ends normally
//   GET /destroy-late  streams two chunks, then destroys the response
//   GET /destroy-early destroys the response before writing anything
import { BunRouter } from "../../src/http/bun/BunRouter";

const port = Number(process.argv[2]);

const router = new BunRouter();
router.get("/ok", async (_req: any, res: any) => {
    res.status(200).setHeader("content-type", "text/plain");
    res.write("first,");
    await new Promise((resolve) => setTimeout(resolve, 20));
    res.write("second");
    res.end();
});
router.get("/destroy-late", async (_req: any, res: any) => {
    res.status(200).setHeader("content-type", "text/plain");
    res.write("first,");
    await new Promise((resolve) => setTimeout(resolve, 20));
    res.write("second");
    await new Promise((resolve) => setTimeout(resolve, 20));
    res.destroy(new Error("the disk read failed"));
});
router.get("/destroy-early", (_req: any, res: any) => {
    res.destroy();
});

void router.listen("127.0.0.1", port).then(() => {
    process.stdout.write("ready\n");
});
