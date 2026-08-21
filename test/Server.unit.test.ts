///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Unit-level test for Server.stop()'s shutdown watchdog timer — doesn't need a real HTTP listener or
// database connection, so it's kept separate from the full-server integration tests in Server.test.ts.
//
// Server's constructor registers a fixed set of prom-client metrics against the default global
// registry, which throws on a second registration of the same metric name — so, as in Server.test.ts,
// exactly one Server instance is created for this whole file and reused/reconfigured per test.
import "reflect-metadata";
import { Logger } from "@rapidrest/core";
import config from "./config";
import { Server } from "../src/Server";

describe("Server.stop shutdown watchdog", () => {
    const server: any = new Server({ config, logger: Logger() });

    beforeEach(() => {
        server.app = { isListening: false };
        server.serviceManager = { stopAll: vi.fn().mockResolvedValue(undefined) };
        server.connectionManager = { disconnect: vi.fn().mockResolvedValue(undefined) };
    });

    it("clears the watchdog timer once stop() resolves, instead of leaving it pending for 30s", async () => {
        // Regression test: the watchdog setTimeout was previously scheduled unconditionally (even after a
        // successful shutdown) and never cleared, so it fired 30s after every stop() call and kept the
        // event loop alive for that long even though the promise had already settled.
        vi.useFakeTimers();
        try {
            const clearSpy = vi.spyOn(global, "clearTimeout");

            await server.stop();

            expect(clearSpy).toHaveBeenCalled();

            // With the timer cleared, advancing well past the 30s watchdog window must be a no-op —
            // nothing should reject or throw here.
            await vi.advanceTimersByTimeAsync(30_000);
        } finally {
            vi.useRealTimers();
        }
    });

    it("still rejects via the watchdog if shutdown never completes", async () => {
        vi.useFakeTimers();
        try {
            // Never resolves — simulates a shutdown step that hangs.
            server.serviceManager = {
                stopAll: vi.fn(
                    () =>
                        new Promise(() => {
                            /* Do nothing */
                        }),
                ),
            };

            const stopPromise = server.stop();
            const assertion = expect(stopPromise).rejects.toBe("Failed to shut down server.");
            await vi.advanceTimersByTimeAsync(30_000);
            await assertion;
        } finally {
            vi.useRealTimers();
        }
    });

    it("clears the watchdog timer when shutdown throws", async () => {
        vi.useFakeTimers();
        try {
            const clearSpy = vi.spyOn(global, "clearTimeout");
            server.connectionManager = { disconnect: vi.fn().mockRejectedValue(new Error("disconnect failed")) };

            await expect(server.stop()).rejects.toThrow("disconnect failed");
            expect(clearSpy).toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }
    });
});
