///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Real uWebSockets.js server (no fakes): verifies that HttpRouter.shutdown() lets an in-flight request finish, stops
// accepting new connections, and closes lingering WebSocket connections.
import uWS from "uWebSockets.js";
import WebSocket from "ws";
import { HttpRouter } from "../../../src/http/uWS/Router";

const PORT = 37931;

describe("HttpRouter.shutdown (real uWS)", () => {
    it("drains an in-flight request, refuses new connections and closes open WebSockets", async () => {
        const router = new HttpRouter(uWS.App());
        let seenPattern: string | undefined;
        router.get("/slow/:id", async (req: any, res: any) => {
            seenPattern = req.routePattern;
            await new Promise((resolve) => setTimeout(resolve, 300));
            res.status(200).send({ done: true });
        });
        router.ws("/socket", [
            (req: any) => {
                // Keep the connection open.
                req.wsHandled = true;
            },
        ]);
        await router.listen("127.0.0.1", PORT);

        const socket = new WebSocket(`ws://127.0.0.1:${PORT}/socket`);
        await new Promise<void>((resolve, reject) => {
            socket.once("open", () => resolve());
            socket.once("error", reject);
        });
        const socketClosed = new Promise<void>((resolve) => socket.once("close", () => resolve()));

        const inFlight = fetch(`http://127.0.0.1:${PORT}/slow/abc`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(router.inFlightRequests).toBe(1);

        await router.shutdown(5000);

        const response = await inFlight;
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ done: true });
        expect(seenPattern).toBe("/slow/:id");
        expect(router.isListening).toBe(false);

        await socketClosed;
        await expect(fetch(`http://127.0.0.1:${PORT}/slow/def`)).rejects.toThrow();
    });
});
