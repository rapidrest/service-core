///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import Redis from "ioredis-mock";
import { Logger } from "@rapidrest/core";
import { ObjectFactory } from "../../../src/ObjectFactory";
import { ConnectionManager } from "../../../src/database/ConnectionManager";
import { MemorySessionStore } from "../../../src/http/session/MemorySessionStore";
import { RedisSessionStore } from "../../../src/http/session/RedisSessionStore";
import { SessionManager } from "../../../src/http/session/SessionManager";

/** Minimal fake config object — avoids any shared state with the real test/config.ts singleton. */
function makeConfig(sessionOverrides: any = {}) {
    const data: any = {
        session: { secret: "test-session-secret", ttl: 60, ...sessionOverrides },
    };
    return { get: (key: string) => data[key] };
}

describe("MemorySessionStore Tests", () => {
    it("Can save and load session data.", async () => {
        const store = new MemorySessionStore();
        await store.save("abc", { uid: "user-1" }, 60);
        const loaded = await store.load("abc");
        expect(loaded).toEqual({ uid: "user-1" });
        store.dispose();
    });

    it("Returns undefined for a session ID that was never saved.", async () => {
        const store = new MemorySessionStore();
        expect(await store.load("does-not-exist")).toBeUndefined();
        store.dispose();
    });

    it("Expires session data after its TTL elapses.", async () => {
        const store = new MemorySessionStore();
        await store.save("expiring", { uid: "user-2" }, 0);
        // ttlSeconds=0 means expiresAt is effectively "now" — a later Date.now() reads past it.
        await new Promise((resolve) => setTimeout(resolve, 5));
        expect(await store.load("expiring")).toBeUndefined();
        store.dispose();
    });

    it("Removes session data on destroy().", async () => {
        const store = new MemorySessionStore();
        await store.save("to-destroy", { uid: "user-3" }, 60);
        await store.destroy("to-destroy");
        expect(await store.load("to-destroy")).toBeUndefined();
        store.dispose();
    });

    it("Reclaims expired, never-reloaded sessions via the periodic sweep.", async () => {
        vi.useFakeTimers();
        try {
            const store = new MemorySessionStore();
            await store.save("expired", { uid: "user-4" }, 0);
            await store.save("still-valid", { uid: "user-5" }, 3600);

            // Advance past both the TTL and the sweep interval so the sweep timer fires.
            await vi.advanceTimersByTimeAsync(60_000);

            expect((store as any).entries.has("expired")).toBe(false);
            expect((store as any).entries.has("still-valid")).toBe(true);
            store.dispose();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("RedisSessionStore Tests", () => {
    it("Can save and load session data.", async () => {
        const store = new RedisSessionStore(new Redis() as any);
        await store.save("abc", { uid: "user-1" }, 60);
        const loaded = await store.load("abc");
        expect(loaded).toEqual({ uid: "user-1" });
    });

    it("Returns undefined for a session ID that was never saved.", async () => {
        const store = new RedisSessionStore(new Redis() as any);
        expect(await store.load("does-not-exist")).toBeUndefined();
    });

    it("Removes session data on destroy().", async () => {
        const store = new RedisSessionStore(new Redis() as any);
        await store.save("to-destroy", { uid: "user-3" }, 60);
        await store.destroy("to-destroy");
        expect(await store.load("to-destroy")).toBeUndefined();
    });

    it("Returns undefined when the stored value is not valid JSON.", async () => {
        const client = new Redis() as any;
        const store = new RedisSessionStore(client);
        await client.set("session:corrupted", "not-json");
        expect(await store.load("corrupted")).toBeUndefined();
    });
});

describe("SessionManager Tests", () => {
    it("Selects MemorySessionStore when no `cache` connection is configured.", async () => {
        const objectFactory = new ObjectFactory(makeConfig(), new Logger());
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        expect((mgr as any).store).toBeInstanceOf(MemorySessionStore);
        await objectFactory.destroy();
    });

    it("Selects RedisSessionStore when a `cache` connection is available.", async () => {
        const objectFactory = new ObjectFactory(makeConfig(), new Logger());
        const connMgr: ConnectionManager = await objectFactory.newInstance(ConnectionManager, { name: "default" });
        connMgr.connections.set("cache", new Redis() as any);
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
        await mgr.destroy("sess-1");
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

    it("defaults ttlSeconds to 1800 when session.ttl is not configured.", async () => {
        const config = { get: (key: string) => (key === "session" ? { secret: "s" } : undefined) };
        const objectFactory = new ObjectFactory(config, new Logger());
        const mgr: SessionManager = await objectFactory.newInstance(SessionManager, { name: "default" });
        expect(mgr.ttlSeconds).toBe(1800);
        await objectFactory.destroy();
    });
});
