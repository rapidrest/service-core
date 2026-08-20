///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { RedisClientType } from "redis";
import { Event, ObjectDecorators } from "@rapidrest/core";
import { ObjectFactory } from "./ObjectFactory.js";
const { Config, Destroy, Init, Logger } = ObjectDecorators;

/**
 * The `EventListenerManager` is responsible for managing event handlers and processing of incoming
 * events from the configured redis pubsub channels. An event handler is any function that has been
 * decorated with the `@OnEvent` decorator and registered with this manager. Once registered, any event
 * that is received corresponding to the list of types specified in the decorator arguments will be
 * sent to the designated function(s). If no type is specified, the handler function will be called
 * for any event that is received.
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class EventListenerManager {
    @Config("events:channels", [])
    private readonly channels: string[] = [];
    @Logger
    private readonly logger: any;
    private readonly objectFactory: ObjectFactory;
    private handlers: Map<string, Function[]> = new Map();
    // Compiled RegExp per registered handler-type key, populated lazily in onEvent() and reused across every
    // dispatch — avoids recompiling a pattern from scratch for every incoming event.
    private readonly typePatterns: Map<string, RegExp> = new Map();
    private readonly redis: RedisClientType;

    constructor(objectFactory: ObjectFactory, redis: RedisClientType) {
        this.objectFactory = objectFactory;
        this.redis = redis.duplicate();
    }

    @Init
    public async init(): Promise<void> {
        for (const channel of this.channels) {
            try {
                await this.redis.subscribe(channel, (message) => {
                    let decoded: any;
                    try {
                        decoded = JSON.parse(message);
                    } catch (err) {
                        this.logger.error("EventManager: Received event but could not parse it.");
                        this.logger.debug(`EventManager: Channel=${channel}, Event=${message}, Error=${err}`);
                        return;
                    }
                    this.onEvent(decoded);
                });
            } catch (err: any) {
                this.logger.error("EventManager: Failed to subscribe to pubsub channel: " + channel);
                this.logger.debug(err);
            }
        }

        // Go through each class in the ObjectFactory and create any with event listener decorator.
        const classes: Map<string, any> | undefined = this.objectFactory.classes;
        if (classes) {
            for (const clazz of classes.values()) {
                try {
                    if (
                        Reflect.hasOwnMetadata("rrst:eventListeners", clazz) &&
                        clazz.prototype.constructor.length === 0
                    ) {
                        // Registration happens below via the `instances` loop — `newInstance` has
                        // already stored this object there by the time it resolves, and registering
                        // it here too would double-add its handlers (each `register()` call binds
                        // fresh function references, so the dedup check in `addEventHandler` can't catch it).
                        await this.objectFactory.newInstance(clazz, { name: "default" });
                    }
                } catch (err) {
                    this.logger.debug(`EventListeners: Unable to process class[${clazz}], Error=${err}`);
                }
            }
        }
        // Go through each object instance in the ObjectFactory that is an event processor.
        const objs: Map<string, any> | undefined = this.objectFactory.instances;
        if (objs) {
            for (const obj of objs.values()) {
                this.register(obj);
            }
        }
    }

    @Destroy
    public async destroy(): Promise<void> {
        await this.redis.unsubscribe(...this.channels);
        this.handlers.clear();
        this.typePatterns.clear();
    }

    /**
     * Handler function for events that arrive from redis.
     */
    private onEvent(evt: Event): void {
        if (!evt || typeof evt.type !== "string") {
            this.logger.error("EventManager: Received event with no valid type; ignoring.");
            return;
        }

        // The registered event types can be regular expression patterns so we
        // need to test each one against our type in order to idenity which
        // handlers to send to.
        for (const entry of this.handlers.entries()) {
            // We'll perform regex comparisons with case-insentivity to make it easier
            let pattern: RegExp | undefined = this.typePatterns.get(entry[0]);
            if (!pattern) {
                pattern = new RegExp(entry[0], "i");
                this.typePatterns.set(entry[0], pattern);
            }
            if (evt.type.match(pattern)) {
                const handlers: Function[] = entry[1];
                if (handlers) {
                    for (const handler of handlers) {
                        // Each handler is isolated: a synchronous throw or an async rejection from one
                        // handler must not prevent the remaining handlers (for this or other matching
                        // event types) from running, and must be reported as a handler failure — not
                        // conflated with the unrelated JSON-parsing try/catch this used to run inside.
                        try {
                            const result: any = handler(evt);
                            if (result instanceof Promise) {
                                result.catch((err: any) => {
                                    this.logger.error(
                                        "EventManager: An event handler rejected while processing an event.",
                                    );
                                    this.logger.debug(err);
                                });
                            }
                        } catch (err: any) {
                            this.logger.error("EventManager: An event handler threw while processing an event.");
                            this.logger.debug(err);
                        }
                    }
                }
            }
        }
    }

    /**
     * Adds the given function to the list of designated event handlers for the specified type.
     * @param event The type of event to add a handler for
     * @param func The function to add
     */
    private addEventHandler(event: string, func: Function): void {
        let handlers: Function[] | undefined = this.handlers.get(event);

        // Create the list if not already exists
        if (!handlers) {
            handlers = [];
        }

        // Add the handler to the list if not already registered
        if (!handlers.includes(func)) {
            handlers.push(func);
        }

        // Update the list in the map
        this.handlers.set(event, handlers);
    }

    /**
     * Registers the given object to be notified of events that arrive.
     * @param obj The object to register for event handling.
     */
    public register(obj: any): void {
        const members: string[] = [];
        // Search through the object looking for all functions that have
        // the @Event decorator.
        let proto: any = Object.getPrototypeOf(obj);
        while (proto) {
            for (const member of Object.getOwnPropertyNames(proto)) {
                const events: any = Reflect.getMetadata("rrst:events", proto, member);
                // Don't register the same member more than once
                if (events && !members.includes(member)) {
                    const func: Function = obj[member].bind(obj);
                    if (Array.isArray(events)) {
                        for (const event of events) {
                            this.addEventHandler(event, func);
                        }
                    } else {
                        this.addEventHandler(events, func);
                    }
                    members.push(member);
                }
            }

            proto = Object.getPrototypeOf(proto);
        }
    }
}
