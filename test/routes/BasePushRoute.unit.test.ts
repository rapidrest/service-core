///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for BasePushRoute's error/edge-case branches that PushRoute.test.ts's
// real-server integration tests don't reach: the `events` datasource being unconfigured, a
// redis.subscribe() failure during connect(), and a failed message-forward callback. Constructs
// BasePushRoute directly with manually-set fields, the same approach ACLUtils.unit.test.ts uses,
// rather than spinning up a full Server/ObjectFactory/Mongo/Redis stack for these narrow cases.
const { subscribeMock, createdInstances } = vi.hoisted(() => ({
    subscribeMock: vi.fn().mockResolvedValue(undefined),
    createdInstances: [] as any[],
}));

vi.mock("redis", () => {
    // node-redis (unlike ioredis) has no client-wide "message" event — the listener passed to
    // subscribe() is what receives messages for that channel, as (message, channel).
    class FakeRedisClient {
        public url?: string;
        public listenersByChannel: Map<string, Function> = new Map();
        constructor(opts?: any) {
            this.url = opts?.url;
            createdInstances.push(this);
        }
        async connect() {
            return this;
        }
        async subscribe(channels: string | string[], listener: Function) {
            const result = await subscribeMock(channels, listener);
            for (const channel of Array.isArray(channels) ? channels : [channels]) {
                this.listenersByChannel.set(channel, listener);
            }
            return result;
        }
        async unsubscribe() {
            return Promise.resolve();
        }
        async disconnect() {
            // no-op
        }
        async publish() {
            return 0;
        }
    }
    return { createClient: (opts?: any) => new FakeRedisClient(opts), RedisClient: FakeRedisClient };
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
        it("warns and leaves redisPub unset when the `events` datasource is not configured", async () => {
            const route = makeRoute({ redisConfig: undefined });
            await route.init();
            expect(route.logger.warn).toHaveBeenCalledWith(
                "Could not initialize the push notification publisher. The `events` datasource is not configured.",
            );
            expect(route.redisPub).toBeUndefined();
        });

        it("initializes redisPub when the `events` datasource is configured", async () => {
            const route = makeRoute();
            await route.init();
            expect(route.redisPub).toBeDefined();
            expect(route.logger.warn).not.toHaveBeenCalled();
        });
    });

    describe("send", () => {
        it("throws a 500 instead of publishing when the `events` datasource isn't configured", async () => {
            const route = makeRoute({ redisConfig: undefined });
            await route.init();
            const user = { uid: "u1" };
            await expect(route.send("channel1", { message: "hi" }, user)).rejects.toMatchObject({ status: 500 });
            expect(route.logger.error).toHaveBeenCalledWith(
                "Failed to send push message to channel channel1. The `events` datasource is not configured.",
            );
        });

        it("throws a 403 without touching redisPub when the user lacks create permission", async () => {
            const route = makeRoute({ aclUtils: { hasPermission: vi.fn().mockResolvedValue(false) } });
            await route.init();
            const user = { uid: "u1" };
            await expect(route.send("channel1", { message: "hi" }, user)).rejects.toMatchObject({ status: 403 });
        });

        it("publishes the message when configured and permitted", async () => {
            const route = makeRoute();
            await route.init();
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
            const onMessage = redisInstance.listenersByChannel.get("u1");
            onMessage(JSON.stringify({ hello: "world" }), "u1");

            expect(route.logger.debug).toHaveBeenCalledWith("Failed to forward message to u1");
        });

        it("does not lose either subscription when two SUBSCRIBE messages race for the same user", async () => {
            // Regression test for a TOCTOU race: both messages used to read the same stale `activeSubs`
            // snapshot before either committed, so the second commit would silently clobber the first's
            // addition instead of merging with it. hasPermission resolves on a delay so the two concurrent
            // onMessage() calls actually interleave instead of one finishing before the other starts.
            const route = makeRoute({
                aclUtils: {
                    hasPermission: vi
                        .fn()
                        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve(true), 5))),
                },
            });
            const user = { uid: "u1" };
            const sock = makeSock();

            await route.connect(sock, user);
            expect(route.activeSubs.get("u1")).toEqual(["u1"]);

            const onMessage = sock.on.mock.calls.find(([event]: [string]) => event === "message")![1];

            const p1 = onMessage(JSON.stringify({ id: 1, type: "SUBSCRIBE", data: "channelA" }), false);
            const p2 = onMessage(JSON.stringify({ id: 2, type: "SUBSCRIBE", data: "channelB" }), false);
            await Promise.all([p1, p2]);

            const finalSubs: string[] = route.activeSubs.get("u1");
            expect(finalSubs).toEqual(expect.arrayContaining(["u1", "channelA", "channelB"]));
            expect(finalSubs.length).toBe(3);
        });

        it("bounds the number of ACL checks per SUBSCRIBE to the remaining budget, even when every channel is denied", async () => {
            // Regression test: the per-channel loop used to only stop early once enough channels had been
            // *granted* to exhaust the budget - a request naming far more channels than could ever be granted
            // (e.g. all denied) ran the full length of the attacker-controlled list, one sequential ACL lookup
            // per entry, with no upper bound.
            const hasPermission = vi.fn().mockResolvedValue(false);
            const route = makeRoute({ aclUtils: { hasPermission } });
            route.maxSubscriptionsPerUser = 5;
            const user = { uid: "u1" };
            const sock = makeSock();

            await route.connect(sock, user);
            hasPermission.mockClear();

            const onMessage = sock.on.mock.calls.find(([event]: [string]) => event === "message")![1];
            const manyChannels: string[] = Array.from({ length: 10_000 }, (_, i) => `channel-${i}`);
            await onMessage(JSON.stringify({ id: 1, type: "SUBSCRIBE", data: manyChannels }), false);

            // Budget is maxSubscriptionsPerUser(5) minus the 1 already-tracked identity channel = 4.
            expect(hasPermission).toHaveBeenCalledTimes(4);
        });

        it("serializes the close handler through the same per-user lock as connect()/SUBSCRIBE/UNSUBSCRIBE", async () => {
            // Regression test: the close handler used to mutate activeSocks/activeSubs directly, unguarded,
            // unlike every other read-modify-write site on these maps - a close racing a concurrent
            // connect()/SUBSCRIBE for the same user could interleave and lose one side's update.
            const route = makeRoute();
            const user = { uid: "u1" };
            const sock = makeSock();

            await route.connect(sock, user);
            const runExclusiveSpy = vi.spyOn(route, "runExclusive");

            const onClose = sock.on.mock.calls.find(([event]: [string]) => event === "close")![1];
            await onClose(1000, "done");

            expect(runExclusiveSpy).toHaveBeenCalledWith("u1", expect.any(Function));
            expect(route.activeSocks.has("u1")).toBe(false);
            expect(route.activeSubs.has("u1")).toBe(false);
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
