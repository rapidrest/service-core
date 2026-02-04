///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////

/**
 * Apply this to a property to have the TypeORM `MongoRepository` for the given entity type injected at instantiation.
 *
 * @param {any} type The entity type whose repository will be injected.
 */
export function MongoRepository(type: any) {
    return function (target: any, propertyKey: string | symbol) {
        Reflect.defineMetadata("rrst:injectMongoRepo", type, target, propertyKey);
        const key = `__${String(propertyKey)}`;
        Object.defineProperty(target, propertyKey, {
            enumerable: true,
            writable: true,
            value: undefined,
        });
    };
}

/**
 * Apply this to a property to have the TypeORM `Repository` for the given entity type injected at instantiation.
 *
 * @param {any} type The entity type whose repository will be injected.
 */
export function Repository(type: any) {
    return function (target: any, propertyKey: string | symbol) {
        Reflect.defineMetadata("rrst:injectRepo", type, target, propertyKey);
        const key = `__${String(propertyKey)}`;
        Object.defineProperty(target, propertyKey, {
            enumerable: true,
            writable: true,
            value: undefined,
        });
    };
}

/**
 * Apply this to a property to have the `Redis` connection injected at instantiation.
 *
 * @param {string} name The name of the database connection to inject.
 */
export function RedisConnection(name: string) {
    return function (target: any, propertyKey: string | symbol) {
        Reflect.defineMetadata("rrst:injectRedisRepo", name, target, propertyKey);
        const key = `__${String(propertyKey)}`;
        Object.defineProperty(target, propertyKey, {
            enumerable: true,
            writable: true,
            value: undefined,
        });
    };
}