///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import config from "../../config";
import { createStandaloneFakeRedisClient } from "../../helpers/FakeRedis.js";
import { Logger, MemoryStore } from "@rapidrest/core";
import { ObjectFactory } from "../../../src/ObjectFactory";
import { ConnectionManager } from "../../../src/database/ConnectionManager";
import { RedisSessionStore } from "../../../src/http/session/RedisSessionStore";
import { SessionManager } from "../../../src/http/session/SessionManager";

/** Minimal fake config object — avoids any shared state with the real test/config.ts singleton. */
function makeConfig(sessionOverrides: any = {}) {
    const data: any = {
        session: { secret: "test-session-secret", ttl: 60, ...sessionOverrides },
    };
    return { get: (key: string) => data[key] };
}

describe("RedisSessionStore Tests", () => {
    const objectFactory = new ObjectFactory(config, Logger());

    it("Can save and load session data.", async () => {
        const store: RedisSessionStore = await objectFactory.newInstance(RedisSessionStore, {
            args: [createStandaloneFakeRedisClient() as any],
        });
        await store.save("abc", { uid: "user-1" }, 60);
        const loaded = await store.load("abc");
        expect(loaded).toEqual({ uid: "user-1" });
    });

    it("Returns undefined for a session ID that was never saved.", async () => {
        const store: RedisSessionStore = await objectFactory.newInstance(RedisSessionStore, {
            args: [createStandaloneFakeRedisClient() as any],
        });
        expect(await store.load("does-not-exist")).toBeUndefined();
    });

    it("Removes session data on destroy().", async () => {
        const store: RedisSessionStore = await objectFactory.newInstance(RedisSessionStore, {
            args: [createStandaloneFakeRedisClient() as any],
        });
        await store.save("to-destroy", { uid: "user-3" }, 60);
        await store.delete("to-destroy");
        expect(await store.load("to-destroy")).toBeUndefined();
    });

    it("Returns undefined when the stored value is not valid JSON.", async () => {
        const client = createStandaloneFakeRedisClient() as any;
        const store: RedisSessionStore = await objectFactory.newInstance(RedisSessionStore, { args: [client] });
        await client.set("session:corrupted", "not-json");
        expect(await store.load("corrupted")).toBeUndefined();
    });
});

describe("SessionManager Tests", () => {
    const objectFactory = new ObjectFactory(config, Logger());

    it("Selects MemorySessionStore when no `cache` connection is configured.", async () => {
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        expect((mgr as any).store).toBeInstanceOf(MemoryStore);
        await objectFactory.destroy();
    });

    it("Selects RedisSessionStore when a `cache` connection is available.", async () => {
        const objectFactory = new ObjectFactory(makeConfig(), new Logger());
        const connMgr: ConnectionManager = await objectFactory.newInstance(ConnectionManager, { name: "default" });
        connMgr.connections.set("cache", createStandaloneFakeRedisClient() as any);
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        expect((mgr as any).store).toBeInstanceOf(RedisSessionStore);
        await objectFactory.destroy();
    });

    it("Throws when session.store is explicitly 'redis' but no `cache` connection exists.", async () => {
        const objectFactory = new ObjectFactory(makeConfig({ store: "redis" }), new Logger());
        await expect(objectFactory.newInstance(SessionManager, { name: "default" })).rejects.toThrow();
    });

    it("Throws when neither session.secret nor cookie_secret is configured.", async () => {
        const config = { get: (key: string) => (key === "session" ? {} : undefined) };
        const objectFactory = new ObjectFactory(config, new Logger());
        await expect(objectFactory.newInstance(SessionManager, { name: "default" })).rejects.toThrow();
    });

    it("signId/verifyId round-trip to the original session ID.", async () => {
        const objectFactory = new ObjectFactory(makeConfig(), new Logger());
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        const signed = mgr.signId("session-id-123");
        expect(mgr.verifyId(signed)).toBe("session-id-123");
        await objectFactory.destroy();
    });

    it("generateId returns a fresh, non-empty session ID each call.", async () => {
        const objectFactory = new ObjectFactory(makeConfig(), new Logger());
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        const a = mgr.generateId();
        const b = mgr.generateId();
        expect(a).not.toBe(b);
        expect(a.length).toBeGreaterThan(0);
        await objectFactory.destroy();
    });

    it("delegates load/save/destroy to the underlying store.", async () => {
        const objectFactory = new ObjectFactory(makeConfig(), new Logger());
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        await mgr.save("sess-1", { uid: "user-1" });
        expect(await mgr.load("sess-1")).toEqual({ uid: "user-1" });
        await mgr.delete("sess-1");
        expect(await mgr.load("sess-1")).toBeUndefined();
        await objectFactory.destroy();
    });

    it("verifyId rejects a tampered signature.", async () => {
        const objectFactory = new ObjectFactory(makeConfig(), new Logger());
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        const signed = mgr.signId("session-id-123");
        const tampered = signed.slice(0, -1) + (signed.endsWith("A") ? "B" : "A");
        expect(mgr.verifyId(tampered)).toBeUndefined();
        await objectFactory.destroy();
    });

    it("verifyId rejects a malformed value with no signature separator.", async () => {
        const objectFactory = new ObjectFactory(makeConfig(), new Logger());
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        expect(mgr.verifyId("not-a-signed-value")).toBeUndefined();
        await objectFactory.destroy();
    });

    it("verifyId rejects a signature of the wrong length.", async () => {
        const objectFactory = new ObjectFactory(makeConfig(), new Logger());
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        expect(mgr.verifyId("session-id.short")).toBeUndefined();
        await objectFactory.destroy();
    });

    it("defaults ttlSeconds to 3600 when session.ttl is not configured.", async () => {
        const config = { get: (key: string) => (key === "session" ? { secret: "s" } : undefined) };
        const objectFactory = new ObjectFactory(config, new Logger());
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        expect(mgr.ttlSeconds).toBe(3600);
        await objectFactory.destroy();
    });
});
