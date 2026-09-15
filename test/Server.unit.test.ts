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
import { ApiError, Logger, ObjectDecorators } from "@rapidrest/core";
import config from "./config";
import * as prom from "prom-client";
import { DEFAULT_DRAIN_TIMEOUT_MS, Server, UNMATCHED_ROUTE_LABEL } from "../src/Server";
import { BulkError } from "../src/BulkError";
import { ApiErrorMessages, ApiErrors } from "../src/ApiErrors";

const { Destroy } = ObjectDecorators;

// Server's constructor registers its prom-client metrics globally, so every describe block shares this one instance.
const server: any = new Server({ config, logger: Logger() });

describe("Server.stop shutdown watchdog", () => {
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

describe("Server.stop graceful shutdown", () => {
    afterEach(() => {
        config.set("shutdown:drain_timeout", undefined);
    });

    it("drains the router, then destroys the event manager, then closes the databases", async () => {
        const calls: string[] = [];
        server.serviceManager = { stopAll: vi.fn(async () => calls.push("services")) };
        server.app = {
            isListening: true,
            shutdown: vi.fn(async () => calls.push("drain")),
            close: vi.fn(),
        };
        class FakeEventManager {
            @Destroy
            public async destroy(): Promise<void> {
                calls.push("events");
            }
        }
        const eventManager = new FakeEventManager();
        server.eventListenerManager = eventManager;
        const destroySpy = vi.spyOn(server.objectFactory, "destroy");
        server.connectionManager = { disconnect: vi.fn(async () => calls.push("databases")) };
        config.set("shutdown:drain_timeout", 1234);

        await server.stop();

        expect(calls).toEqual(["services", "drain", "events", "databases"]);
        expect(server.app.shutdown).toHaveBeenCalledWith(1234);
        expect(server.app.close).not.toHaveBeenCalled();
        expect(destroySpy).toHaveBeenCalledWith(eventManager);
        expect(server.eventListenerManager).toBeUndefined();
    });

    it("uses the default drain timeout when none (or an invalid one) is configured", async () => {
        server.serviceManager = undefined;
        server.connectionManager = undefined;
        server.eventListenerManager = undefined;
        server.app = { isListening: true, shutdown: vi.fn().mockResolvedValue(undefined) };

        await server.stop();
        expect(server.app.shutdown).toHaveBeenCalledWith(DEFAULT_DRAIN_TIMEOUT_MS);

        config.set("shutdown:drain_timeout", "soon");
        server.app = { isListening: true, shutdown: vi.fn().mockResolvedValue(undefined) };
        await server.stop();
        expect(server.app.shutdown).toHaveBeenCalledWith(DEFAULT_DRAIN_TIMEOUT_MS);
    });

    it("falls back to close() for a router without shutdown()", async () => {
        server.serviceManager = undefined;
        server.connectionManager = undefined;
        server.eventListenerManager = undefined;
        server.app = { isListening: true, close: vi.fn() };

        await server.stop();
        expect(server.app.close).toHaveBeenCalledTimes(1);
    });
});

describe("Server request metrics", () => {
    it("exposes the router through getApplication()", () => {
        const app = { isListening: false };
        server.app = app;
        expect(server.getApplication()).toBe(app);
    });

    function makeRes(statusCode: number = 200): any {
        return { statusCode, writableEnded: false, send: vi.fn() };
    }

    async function seriesCount(name: string): Promise<number> {
        const metric: any = prom.register.getSingleMetric(name);
        return (await metric.get()).values.length;
    }

    async function labelValues(name: string, label: string): Promise<string[]> {
        const metric: any = prom.register.getSingleMetric(name);
        return [...new Set<string>((await metric.get()).values.map((v: any) => v.labels[label]))];
    }

    beforeEach(() => {
        server.metricRequestPath.reset();
        server.metricRequestStatus.reset();
        server.metricRequestTime.reset();
    });

    it("does not create a new time series per requested path for unmatched routes", async () => {
        for (let i = 0; i < 250; i++) {
            const req: any = { method: "GET", path: `/random-${i}-${Math.random()}`, _metricsStart: Date.now() };
            server.recordRequestMetrics(req, makeRes(404));
        }

        expect(await seriesCount("request_path")).toBe(1);
        expect(await seriesCount("request_status")).toBe(1);
        // One histogram series per bucket, plus sum and count, for the single label set.
        const histogram: any = prom.register.getSingleMetric("request_time_milliseconds");
        const histogramValues = (await histogram.get()).values;
        expect(new Set(histogramValues.map((v: any) => v.labels.path))).toEqual(new Set([UNMATCHED_ROUTE_LABEL]));
        expect(await labelValues("request_path", "path")).toEqual([UNMATCHED_ROUTE_LABEL]);
    });

    it("labels matched requests with the route pattern rather than the concrete path", async () => {
        for (const id of ["a", "b", "c"]) {
            const req: any = { method: "GET", path: `/items/${id}`, routePattern: "/items/:id" };
            server.recordRequestMetrics(req, makeRes());
        }

        expect(await labelValues("request_path", "path")).toEqual(["/items/:id"]);
        // No `_metricsStart`, so nothing was observed.
        expect(await seriesCount("request_time_milliseconds")).toBe(0);
    });

    it("ends the response only when nothing else has", () => {
        const open = makeRes();
        server.recordRequestMetrics({ method: "GET", path: "/" }, open);
        expect(open.send).toHaveBeenCalledTimes(1);

        const ended = { ...makeRes(), writableEnded: true };
        server.recordRequestMetrics({ method: "GET", path: "/" }, ended);
        expect(ended.send).not.toHaveBeenCalled();
    });
});

describe("Server error responses", () => {
    // Winston stamps a `level` onto the error objects it logs, so use an inert logger to observe the handler alone.
    let originalLogger: any;
    beforeEach(() => {
        originalLogger = server.logger;
        server.logger = { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
    });
    afterEach(() => {
        server.logger = originalLogger;
    });

    function makeRes(headersSent: boolean = false): any {
        const res: any = { headersSent, statusCode: 200 };
        res.status = vi.fn((code: number) => {
            res.statusCode = code;
            return res;
        });
        res.json = vi.fn();
        return res;
    }

    /** Mimics TypeORM's QueryFailedError, which carries the failed SQL and its parameters. */
    function makeQueryFailedError(): Error {
        return Object.assign(new Error("SQLITE_CONSTRAINT: UNIQUE constraint failed: item.name"), {
            name: "QueryFailedError",
            query: "INSERT INTO item (name, secret) VALUES (?, ?)",
            parameters: ["dup", "hunter2"],
            driverError: { code: "SQLITE_CONSTRAINT", errno: 19 },
        });
    }

    it("does not leak raw database errors inside a BulkError", () => {
        const res = makeRes();
        const next = vi.fn();
        const bulk = new BulkError(
            [new ApiError(ApiErrors.INVALID_REQUEST, 400, "bad item"), makeQueryFailedError(), null],
            ApiErrors.BULK_CREATE_FAILURE,
            400,
        );

        server.handleError(bulk, {}, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        const body = res.json.mock.calls[0][0];
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain("INSERT INTO");
        expect(serialized).not.toContain("hunter2");
        expect(serialized).not.toContain("SQLITE_CONSTRAINT");
        expect(body[0]).toEqual({ code: ApiErrors.INVALID_REQUEST, status: 400, message: "bad item" });
        expect(body[1]).toEqual({
            code: ApiErrors.INTERNAL_ERROR,
            status: 500,
            message: ApiErrorMessages.INTERNAL_ERROR,
        });
        expect(body[2]).toBeNull();
        expect(next).toHaveBeenCalled();
        // The raw error is still logged server-side.
        expect(server.logger.error).toHaveBeenCalledWith(expect.objectContaining({ name: "QueryFailedError" }));
    });

    it("never includes stack traces in a BulkError response, even in development", () => {
        const original = process.env.NODE_ENV;
        try {
            process.env.NODE_ENV = "development";
            const item: any = new ApiError(ApiErrors.INVALID_REQUEST, 400, "bad item");
            Object.defineProperty(item, "stack", { value: "at secret.ts:1", enumerable: true });
            const res = makeRes(true);
            server.handleError(new BulkError([item], ApiErrors.BULK_CREATE_FAILURE, 400), {}, res, vi.fn());

            expect(res.status).not.toHaveBeenCalled();
            expect(JSON.stringify(res.json.mock.calls[0][0])).not.toContain("secret.ts");
        } finally {
            process.env.NODE_ENV = original;
        }
    });

    it("replaces a single raw error with the generic internal error", () => {
        const res = makeRes();
        server.handleError(makeQueryFailedError(), {}, res, vi.fn());

        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
            code: ApiErrors.INTERNAL_ERROR,
            status: 500,
            message: ApiErrorMessages.INTERNAL_ERROR,
        });
    });

    it("keeps an ApiError's own fields, strips color codes from level, and skips status once headers are sent", () => {
        const res = makeRes(true);
        const err: any = new ApiError(ApiErrors.NOT_FOUND, 404, "missing");
        err.level = "[31merror[39m";
        server.handleError(err, {}, res, vi.fn());

        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith({
            code: ApiErrors.NOT_FOUND,
            status: 404,
            level: "error",
            message: "missing",
        });
    });

    it("answers a thrown string with a generic 500, and just calls next() without an error", () => {
        const res = makeRes();
        const next = vi.fn();
        server.handleError("boom", {}, res, next);
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({ message: "Internal Server Error", status: 500 });

        const idle = makeRes();
        server.handleError(undefined, {}, idle, next);
        expect(idle.json).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledTimes(2);
    });
});
