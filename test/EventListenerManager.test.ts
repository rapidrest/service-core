///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { Logger } from "@rapidrest/core";
import config from "./config";
import { EventListenerManager } from "../src/EventListenerManager";
import { ObjectFactory } from "../src/ObjectFactory";
import { EventListener, OnEvent } from "../src/decorators/EventDecorators";

// `EventListenerManager.init()` is decorated with `@Init`, which `ObjectFactory.initialize()` invokes
// automatically. Construct manually and initialize exactly once so `init()` doesn't run twice (which would
// double-subscribe the "message" handler and double-register any handlers found in the ObjectFactory).
async function createManager(objectFactory: ObjectFactory, redis: any): Promise<EventListenerManager> {
    const manager = new EventListenerManager(objectFactory, redis);
    await objectFactory.initialize(manager);
    return manager;
}

// node-redis (unlike ioredis) has no client-wide "message" event — the listener that decodes and dispatches
// incoming events is instead passed directly to `subscribe(channel, listener)` per channel. This fake tracks
// the listener registered for each channel and exposes `emit(channel, message)` to simulate an incoming
// pub/sub message for it.
function makeRedis() {
    const listeners: Record<string, Function> = {};
    const redis: any = {
        subscribe: vi.fn((channel: string, listener: Function) => {
            listeners[channel] = listener;
            return Promise.resolve();
        }),
        unsubscribe: vi.fn().mockResolvedValue(undefined),
        duplicate: vi.fn(() => redis),
        emit(channel: string, message: string) {
            listeners[channel]?.(message, channel);
        },
    };
    return redis;
}

describe("EventListenerManager Tests", () => {
    beforeAll(() => {
        config.set("events:channels", ["channel1"]);
    });

    it("subscribes to the configured channels and registers a message handler", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        await createManager(objectFactory, redis);
        expect(redis.subscribe).toHaveBeenCalledWith("channel1", expect.any(Function));
    });

    it("logs and continues when the redis subscribe call fails", async () => {
        const redis = makeRedis();
        redis.subscribe = vi.fn().mockRejectedValue(new Error("boom"));
        const objectFactory = new ObjectFactory(config, Logger());
        await expect(createManager(objectFactory, redis)).resolves.toBeDefined();
    });

    it("dispatches parsed events to handlers whose type matches", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const manager = await createManager(objectFactory, redis);

        const received: any[] = [];
        class Handler {
            @OnEvent("user.created")
            public onCreated(evt: any) {
                received.push(["created", evt]);
            }

            @OnEvent(["user.updated", "user.deleted"])
            public onChanged(evt: any) {
                received.push(["changed", evt]);
            }
        }
        manager.register(new Handler());

        redis.emit("channel1", JSON.stringify({ type: "user.created", data: {} }));
        redis.emit("channel1", JSON.stringify({ type: "user.updated", data: {} }));
        redis.emit("channel1", JSON.stringify({ type: "unrelated.event", data: {} }));

        expect(received).toEqual([
            ["created", { type: "user.created", data: {} }],
            ["changed", { type: "user.updated", data: {} }],
        ]);
    });

    it("logs and continues when the incoming message cannot be parsed", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        await createManager(objectFactory, redis);
        expect(() => redis.emit("channel1", "not-json")).not.toThrow();
    });

    it("logs and continues when a well-formed event has no valid type field", async () => {
        // Regression test: `onEvent()` used to call `evt.type.match(...)` with no guard, throwing an
        // uncaught TypeError (and crashing the process) for any well-formed event missing `type`.
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const manager = await createManager(objectFactory, redis);

        const received: any[] = [];
        class Handler {
            @OnEvent("user.created")
            public onCreated(evt: any) {
                received.push(evt);
            }
        }
        manager.register(new Handler());

        expect(() => redis.emit("channel1", JSON.stringify({ data: {} }))).not.toThrow();
        expect(received).toEqual([]);
    });

    it("isolates a handler that throws synchronously so other handlers still run", async () => {
        // Regression test: a synchronous throw from a handler used to propagate up through onEvent() and
        // get caught by the *message parsing* try/catch, mislabeling a handler bug as "could not parse"
        // the (successfully parsed) event — and would have stopped any later handler from running too.
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const manager = await createManager(objectFactory, redis);

        const received: any[] = [];
        class ThrowingHandler {
            @OnEvent("thing.happened")
            public onThing() {
                throw new Error("handler boom");
            }
        }
        class WorkingHandler {
            @OnEvent("thing.happened")
            public onThing(evt: any) {
                received.push(evt);
            }
        }
        manager.register(new ThrowingHandler());
        manager.register(new WorkingHandler());

        expect(() => redis.emit("channel1", JSON.stringify({ type: "thing.happened" }))).not.toThrow();
        expect(received).toEqual([{ type: "thing.happened" }]);
    });

    it("does not produce an unhandled rejection when an async handler rejects", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const manager = await createManager(objectFactory, redis);

        const received: any[] = [];
        class RejectingHandler {
            @OnEvent("thing.happened")
            public async onThing() {
                throw new Error("async handler boom");
            }
        }
        class WorkingHandler {
            @OnEvent("thing.happened")
            public onThing(evt: any) {
                received.push(evt);
            }
        }
        manager.register(new RejectingHandler());
        manager.register(new WorkingHandler());

        const unhandled = vi.fn();
        process.on("unhandledRejection", unhandled);
        try {
            redis.emit("channel1", JSON.stringify({ type: "thing.happened" }));
            // Let the rejected promise's .catch() run before asserting.
            await new Promise((resolve) => setImmediate(resolve));
            expect(unhandled).not.toHaveBeenCalled();
            expect(received).toEqual([{ type: "thing.happened" }]);
        } finally {
            process.off("unhandledRejection", unhandled);
        }
    });

    it("does not register the same method twice when walking the prototype chain", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const manager = await createManager(objectFactory, redis);

        const calls: any[] = [];
        class Base {
            @OnEvent("thing.happened")
            public onThing(evt: any) {
                calls.push(evt);
            }
        }
        class Derived extends Base {
            public onThing(evt: any) {
                calls.push(evt);
            }
        }
        manager.register(new Derived());

        redis.emit("channel1", JSON.stringify({ type: "thing.happened" }));
        expect(calls.length).toBe(1);
    });

    it("does not add the exact same handler function twice for a given event", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const manager = await createManager(objectFactory, redis);

        const fn = () => undefined;
        (manager as any).addEventHandler("dup.event", fn);
        (manager as any).addEventHandler("dup.event", fn);
        expect((manager as any).handlers.get("dup.event")).toEqual([fn]);
    });

    it("adds a second distinct handler for an event that already has one registered", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const manager = await createManager(objectFactory, redis);

        const fnA = () => undefined;
        const fnB = () => undefined;
        (manager as any).addEventHandler("shared.event", fnA);
        (manager as any).addEventHandler("shared.event", fnB);
        expect((manager as any).handlers.get("shared.event")).toEqual([fnA, fnB]);
    });

    it("instantiates and registers @EventListener classes found in the ObjectFactory", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const received: any[] = [];

        @EventListener()
        class AutoHandler {
            @OnEvent("auto.event")
            public onAuto(evt: any) {
                received.push(evt);
            }
        }
        objectFactory.classes.set("AutoHandler", AutoHandler);

        await createManager(objectFactory, redis);

        redis.emit("channel1", JSON.stringify({ type: "auto.event" }));
        expect(received.length).toBe(1);
    });

    it("skips classes without the @EventListener decorator", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());

        class PlainClass {}
        objectFactory.classes.set("PlainClass", PlainClass);

        await expect(createManager(objectFactory, redis)).resolves.toBeDefined();
    });

    it("skips @EventListener classes whose constructor requires arguments", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());

        @EventListener()
        class NeedsArgs {
            constructor(public dep: any) {}
        }
        objectFactory.classes.set("NeedsArgs", NeedsArgs);

        await expect(createManager(objectFactory, redis)).resolves.toBeDefined();
    });

    it("logs and continues when instantiating an @EventListener class throws", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());

        @EventListener()
        class Throws {
            constructor() {
                throw new Error("construction failed");
            }
        }
        objectFactory.classes.set("Throws", Throws);

        await expect(createManager(objectFactory, redis)).resolves.toBeDefined();
    });

    it("registers existing instances found in the ObjectFactory", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const received: any[] = [];

        class InstanceHandler {
            @OnEvent("instance.event")
            public onEvt(evt: any) {
                received.push(evt);
            }
        }
        objectFactory.instances.set("InstanceHandler:default", new InstanceHandler());

        await createManager(objectFactory, redis);

        redis.emit("channel1", JSON.stringify({ type: "instance.event" }));
        expect(received.length).toBe(1);
    });

    it("unsubscribes and clears handlers on destroy", async () => {
        const redis = makeRedis();
        const objectFactory = new ObjectFactory(config, Logger());
        const manager = await createManager(objectFactory, redis);

        const received: any[] = [];
        class Handler {
            @OnEvent("some.event")
            public onEvt(evt: any) {
                received.push(evt);
            }
        }
        manager.register(new Handler());

        await manager.destroy();
        expect(redis.unsubscribe).toHaveBeenCalled();

        redis.emit("channel1", JSON.stringify({ type: "some.event" }));
        expect(received.length).toBe(0);
    });
});
