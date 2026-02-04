///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Redis } from "ioredis";
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
    private channels: string[] = [];
    @Logger
    private logger: any;
    private objectFactory: ObjectFactory;
    private handlers: Map<string, Function[]> = new Map();
    private redis: Redis;

    constructor(objectFactory: ObjectFactory, redis: Redis) {
        this.objectFactory = objectFactory;
        this.redis = redis;
    }

    @Init
    public async init(): Promise<void> {
        try {
            await this.redis.subscribe(...this.channels);
        } catch (err: any) {
            this.logger.error("EventManager: Failed to subscribe to pubsub channels: " + this.channels);
            this.logger.debug(err);
        }
        this.redis.on("message", (channel, message) => {
            try {
                const decoded: any = JSON.parse(message);
                this.onEvent(decoded);
            } catch (err) {
                this.logger.error("EventManager: Received event but could not parse it.");
                this.logger.debug(`EventManager: Channel=${channel}, Event=${message}, Error=${err}`);
            }
        });

        // Go through each class in the ObjectFactory and create any with event listener decorator.
        const classes: Map<string, any> | undefined = this.objectFactory.classes;
        if (classes) {
            for (const clazz of classes.values()) {
                try {
                    if (
                        Reflect.hasOwnMetadata("rrst:eventListeners", clazz) &&
                        clazz.prototype.constructor.length === 0
                    ) {
                        const obj = await this.objectFactory.newInstance(clazz, { name: "default" });
                        this.register(obj);
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
    }

    /**
     * Handler function for events that arrive from redis.
     */
    private onEvent(evt: Event): void {
        // The registered event types can be regular expression patterns so we
        // need to test each one against our type in order to idenity which
        // handlers to send to.
        for (const entry of this.handlers.entries()) {
            // We'll perform regex comparisons with case-insentivity to make it easier
            if (evt.type.match(new RegExp(entry[0], "i"))) {
                const handlers: Function[] = entry[1];
                if (handlers) {
                    for (const handler of handlers) {
                        handler(evt);
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
