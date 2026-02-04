///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";

/**
 * Apply this to a function that will be called when events arrive for the specified type(s). If no event type is
 * specified, then the function will be called upon each event that arrives.
 *
 * @param type The name or list of names corresponding to events that the function will handle.
 */
export function OnEvent(type?: string | string[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        Reflect.defineMetadata("rrst:events", type ? type : ".*", target, propertyKey);
    };
}

/**
 * Apply this optionally to a abitary class, that has a no argument constructor, to auto register it as an event listener. Will still require add `@OnEvent` to methods
 */
export function EventListener() {
    return function (target: any) {
        Reflect.defineMetadata("rrst:eventListeners", true, target);
    };
}
