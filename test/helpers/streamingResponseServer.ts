///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Child-process fixture for test/http/uWS/Router.streamingResponse.test.ts. uWebSockets.js reports an uncorked
// write ("writes must be made from within a corked callback") with a native write to stderr that cannot be
// intercepted in-process, so the test runs this server in its own process and inspects that process's stderr.
//
// Usage: tsx streamingResponseServer.ts <port>
// Routes: GET /big?chunks=<n>&size=<bytes>&mode=<backpressure|ignore>, streamed asynchronously (after an `await`,
// which is outside uWS's implicit cork) with a deterministic byte pattern the client can verify.
import uWS from "uWebSockets.js";
import { HttpRouter } from "../../src/http/uWS/Router";

const port = Number(process.argv[2]);

const router = new HttpRouter(uWS.App());
router.get("/big", async (req: any, res: any) => {
    const chunks = Number(req.query.chunks);
    const size = Number(req.query.size);
    const mode = req.query.mode;
    // Deliberately leave the synchronous part of the handler, like any real file/DB/stream-driven producer.
    await new Promise((resolve) => setTimeout(resolve, 5));
    res.status(200).setHeader("content-type", "application/octet-stream");
    for (let i = 0; i < chunks; i++) {
        // Deterministic content for chunk `i`, so the client can verify every byte without keeping a copy.
        const ok = res.write(Buffer.alloc(size, i % 251));
        if (!ok && mode === "backpressure") {
            if (!(await res.waitForDrain())) return;
        }
    }
    res.end();
});

void router.listen("127.0.0.1", port).then(() => {
    process.stdout.write("ready\n");
});
