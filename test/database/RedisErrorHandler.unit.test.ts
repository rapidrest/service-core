///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Deliberately does NOT mock "redis": the point is that a real node-redis client is an EventEmitter that throws
// (crashing the process) on an `error` event with no listener, and that `attachRedisErrorHandler()` prevents it.
import "reflect-metadata";
import { EventEmitter } from "events";
import { createClient } from "redis";
import { attachRedisErrorHandler, ConnectionManager } from "../../src/database/ConnectionManager";

function makeLogger() {
    return { error: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn() };
}

describe("attachRedisErrorHandler", () => {
    it("a real node-redis client throws on an unhandled 'error' event, but not once the handler is attached", () => {
        const unguarded = createClient({ url: "redis://127.0.0.1:1" });
        expect(() => unguarded.emit("error", new Error("Socket closed unexpectedly"))).toThrow(
            "Socket closed unexpectedly",
        );

        const logger = makeLogger();
        const guarded = attachRedisErrorHandler(createClient({ url: "redis://127.0.0.1:1" }), logger, "cache");
        expect(() => guarded.emit("error", new Error("Socket closed unexpectedly"))).not.toThrow();
        expect(logger.error).toHaveBeenCalledWith("Redis connection 'cache' failed: Socket closed unexpectedly");

        const dup = attachRedisErrorHandler(guarded.duplicate(), logger, "cache (duplicate)");
        expect(() => dup.emit("error", new Error("boom"))).not.toThrow();
    });

    it("logs the first error of an outage as an error, later ones as debug, and resets once ready", () => {
        const logger = makeLogger();
        const client = attachRedisErrorHandler(new EventEmitter(), logger, "events");

        client.emit("error", new Error("first"));
        client.emit("error", "second");
        client.emit("reconnecting");
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.debug).toHaveBeenCalledWith("Redis connection 'events' is still failing: second");
        expect(logger.debug).toHaveBeenCalledWith("Redis connection 'events' is reconnecting...");

        client.emit("ready");
        expect(logger.info).toHaveBeenCalledWith("Redis connection 'events' re-established.");
        client.emit("ready");
        expect(logger.info).toHaveBeenCalledTimes(1);

        client.emit("error", new Error("third"));
        expect(logger.error).toHaveBeenCalledTimes(2);
    });

    it("attaches its listeners only once per client", () => {
        const client = new EventEmitter();
        attachRedisErrorHandler(client, makeLogger(), "a");
        attachRedisErrorHandler(client, makeLogger(), "a");
        expect(client.listenerCount("error")).toBe(1);
    });

    it("ignores values that are not event emitters and tolerates a missing logger", () => {
        const plain = { kind: "no-on" };
        expect(attachRedisErrorHandler(plain, makeLogger(), "x")).toBe(plain);
        expect(attachRedisErrorHandler(undefined, makeLogger(), "x")).toBeUndefined();

        const client = attachRedisErrorHandler(new EventEmitter(), undefined, "x");
        expect(() => client.emit("error", new Error("no logger"))).not.toThrow();
        client.emit("error", new Error("still no logger"));
        client.emit("reconnecting");
        client.emit("ready");
    });

    it("is attached to the client ConnectionManager creates for a redis datastore", async () => {
        const manager: any = new ConnectionManager();
        manager.logger = makeLogger();
        const connect = vi.fn().mockResolvedValue(undefined);
        const fakeClient: any = new EventEmitter();
        fakeClient.connect = connect;
        manager.connectDatastore = ConnectionManager.prototype["connectDatastore"];
        vi.spyOn(await import("../../src/database/ConnectionKinds"), "importRedis").mockResolvedValue({
            createClient: () => fakeClient,
        } as any);

        await manager.connectDatastore("cache", { type: "redis", url: "redis://localhost:6379" }, new Map(), new Map());

        expect(connect).toHaveBeenCalled();
        expect(fakeClient.listenerCount("error")).toBe(1);
        expect(manager.connections.get("cache")).toBe(fakeClient);
    });
});
