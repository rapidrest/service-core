///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for BasePushRoute's error/edge-case branches that PushRoute.test.ts's
// real-server integration tests don't reach: the `events` datastore being unconfigured, a
// redis.subscribe() failure during connect(), and a failed message-forward callback. Constructs
// BasePushRoute directly with manually-set fields, the same approach ACLUtils.unit.test.ts uses,
// rather than spinning up a full Server/ObjectFactory/Mongo/Redis stack for these narrow cases.
const { subscribeMock, createdInstances } = vi.hoisted(() => ({
    subscribeMock: vi.fn().mockResolvedValue(undefined),
    createdInstances: [] as any[],
}));

vi.mock("ioredis", () => {
    class FakeRedis {
        public url?: string;
        public options?: any;
        public handlers: Record<string, Function[]> = {};
        constructor(url?: string, options?: any) {
            this.url = url;
            this.options = options;
            createdInstances.push(this);
        }
        subscribe(...args: any[]) {
            return subscribeMock(...args);
        }
        unsubscribe() {
            return Promise.resolve();
        }
        on(event: string, cb: Function) {
            (this.handlers[event] ??= []).push(cb);
        }
        disconnect() {
            // no-op
        }
        emit(event: string, ...args: any[]) {
            this.handlers[event]?.forEach((h) => h(...args));
        }
    }
    return { Redis: FakeRedis };
});

import { BasePushRoute } from "../../src/routes/BasePushRoute";

function makeRoute(overrides: Partial<{ redisConfig: any; aclUtils: any }> = {}): any {
    const route: any = new BasePushRoute();
    route.logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    route.redisConfig = "redisConfig" in overrides ? overrides.redisConfig : { url: "redis://localhost:6379" };
    route.aclUtils = overrides.aclUtils ?? { hasPermission: vi.fn().mockResolvedValue(true) };
    route.maxSocketsPerUser = 10;
    route.maxSubscriptionsPerUser = 50;
    return route;
}

function makeSock() {
    return {
        close: vi.fn(),
        send: vi.fn((_data: any, cb?: (err?: any) => void) => cb?.(undefined)),
        on: vi.fn(),
    };
}

describe("BasePushRoute Tests (unit)", () => {
    beforeEach(() => {
        subscribeMock.mockReset().mockResolvedValue(undefined);
        createdInstances.length = 0;
    });

    describe("init", () => {
        it("warns and leaves redisPub unset when the `events` datastore is not configured", () => {
            const route = makeRoute({ redisConfig: undefined });
            route.init();
            expect(route.logger.warn).toHaveBeenCalledWith(
                "Could not initialize the push notification publisher. The `events` datastore is not configured.",
            );
            expect(route.redisPub).toBeUndefined();
        });

        it("initializes redisPub when the `events` datastore is configured", () => {
            const route = makeRoute();
            route.init();
            expect(route.redisPub).toBeDefined();
            expect(route.logger.warn).not.toHaveBeenCalled();
        });
    });

    describe("send", () => {
        it("throws a 500 instead of publishing when the `events` datastore isn't configured", async () => {
            const route = makeRoute({ redisConfig: undefined });
            route.init();
            const user = { uid: "u1" };
            await expect(route.send("channel1", { message: "hi" }, user)).rejects.toMatchObject({ status: 500 });
            expect(route.logger.error).toHaveBeenCalledWith(
                "Failed to send push message to channel channel1. The `events` datastore is not configured.",
            );
        });

        it("throws a 403 without touching redisPub when the user lacks create permission", async () => {
            const route = makeRoute({ aclUtils: { hasPermission: vi.fn().mockResolvedValue(false) } });
            route.init();
            const user = { uid: "u1" };
            await expect(route.send("channel1", { message: "hi" }, user)).rejects.toMatchObject({ status: 403 });
        });

        it("publishes the message when configured and permitted", async () => {
            const route = makeRoute();
            route.init();
            route.redisPub.publish = vi.fn().mockResolvedValue(1);
            const user = { uid: "u1" };
            await route.send("channel1", { message: "hi" }, user);
            expect(route.redisPub.publish).toHaveBeenCalledWith(
                "channel1",
                JSON.stringify({ type: "MESSAGE", channel: "channel1", data: { message: "hi" } }),
            );
        });
    });

    describe("connect", () => {
        it("logs but does not throw when redis.subscribe() rejects", async () => {
            subscribeMock.mockRejectedValueOnce(new Error("subscribe failed"));
            const route = makeRoute();
            const user = { uid: "u1" };
            const sock = makeSock();

            await expect(route.connect(sock, user)).resolves.toBeUndefined();
            expect(route.logger.error).toHaveBeenCalledWith(
                expect.stringContaining("Failed to subscribe to push channels"),
            );
            // Despite the subscribe failure, the socket is still tracked so it isn't cleaned up.
            expect(route.activeSocks.get("u1")).toEqual([sock]);
        });

        it("logs when forwarding a pub/sub message to the client fails", async () => {
            const route = makeRoute();
            const user = { uid: "u1" };
            const sock = makeSock();
            sock.send.mockImplementation((_data: any, cb?: (err?: any) => void) => cb?.(new Error("backpressure")));

            await route.connect(sock, user);
            const redisInstance = createdInstances[createdInstances.length - 1];
            redisInstance.emit("message", "u1", JSON.stringify({ hello: "world" }));

            expect(route.logger.debug).toHaveBeenCalledWith("Failed to forward message to u1");
        });

        it("leaves existing subscriptions untouched when UNSUBSCRIBE names a channel the client isn't subscribed to", async () => {
            // Regression test: `origSubs.splice(origSubs.indexOf(channel), 1)` used to delete the *last*
            // tracked subscription whenever `channel` wasn't found (indexOf returns -1, splice(-1, 1)
            // removes the last element) instead of leaving the list untouched.
            const route = makeRoute();
            const user = { uid: "u1" };
            const sock = makeSock();

            await route.connect(sock, user);
            expect(route.activeSubs.get("u1")).toEqual(["u1"]);

            const onMessage = sock.on.mock.calls.find(([event]: [string]) => event === "message")![1];
            await onMessage(JSON.stringify({ id: 1, type: "UNSUBSCRIBE", data: "not-subscribed" }), false);

            expect(route.activeSubs.get("u1")).toEqual(["u1"]);
        });
    });
});
