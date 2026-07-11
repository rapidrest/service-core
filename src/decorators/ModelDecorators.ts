///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { AccessControlList } from "../security/AccessControlList.js";

/**
 * Describes a column registration that must be bridged into TypeORM's metadata storage when (and only when) a SQL
 * connection is established. Entries are queued here by decorators so that this module does not depend on the
 * optional `typeorm` package.
 */
export interface PendingTypeOrmColumn {
    target: any;
    propertyName: string;
    mode: "regular";
    options: any;
}

/**
 * The list of column registrations waiting to be bridged into TypeORM's metadata storage. This list is drained by
 * the TypeORM support module when a SQL connection is created.
 */
export const pendingTypeOrmColumns: PendingTypeOrmColumn[] = [];

/**
 * Indicates that the class is cacheable with the specified TTL.
 *
 * @param ttl The time, in seconds, that an object will be cached before being invalidated.
 */
export function Cache(ttl: number = 30) {
    return function (target: any) {
        Reflect.defineMetadata("rrst:cacheTTL", ttl, target);
        Object.defineProperty(target, "cacheTTL", {
            enumerable: true,
            writable: true,
            value: ttl,
        });
    };
}

/**
 * Indicates that a class is a child entity to some parent. Child entities will inherit all datastore configuration
 * of the parent, including cache settings.
 */
export function ChildEntity() {
    return function <T extends { new (...args: any[]): {} }>(constructor: T) {
        // Queue the `_type` property registration so that it gets bridged to TypeORM if a SQL connection is
        // created. MongoDB connections store the `_type` instance property natively and need no registration.
        pendingTypeOrmColumns.push({
            target: constructor,
            propertyName: "_type",
            mode: "regular",
            options: {},
        });

        Reflect.defineMetadata("rrst:childEntity", true, constructor);

        // Add the property so that it becomes an instance member
        const child = class extends constructor {
            /** The class type of the instance. */
            public readonly _type: string = constructor.name;
        };
        Reflect.defineMetadata("rrst:childEntity", true, child);
        return child;
    };
}

/**
 * Indicates that the class describes an entity that will be persisted in the datastore with the given name.
 *
 * @param datastore The name of the datastore to store records of the decorated class.
 */
export function DataStore(datastore: string) {
    return function (target: any) {
        Reflect.defineMetadata("rrst:datastore", datastore, target);
        Object.defineProperty(target, "datastore", {
            enumerable: true,
            writable: true,
            value: datastore,
        });
    };
}

/**
 * Apply this to a property that is considered a unique identifier.
 */
export function Identifier(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata("rrst:isIdentifier", true, target, propertyKey);
    const key = `__${String(propertyKey)}`;
    Object.defineProperty(target, propertyKey, {
        enumerable: true,
        writable: true,
        value: undefined,
    });
}

/**
 * Apply this to a property that must never be settable by a client. `RepoUtils.create()`/`update()` strip any
 * client-supplied value for a `@ReadOnly` property before persisting — the property's existing/declared-default
 * value is kept instead, regardless of what the request body contains. Use this for fields that should only ever
 * be changed by application/business logic (e.g. `roles`, ownership fields, computed/derived state).
 */
export function ReadOnly(target: any, propertyKey: string | symbol) {
    Reflect.defineMetadata("rrst:readOnly", true, target, propertyKey);
    // Class field initializers are compiled as own-instance assignments, so the property never otherwise
    // appears on the prototype — forcing a placeholder onto the prototype (same technique @Identifier uses)
    // is what makes it discoverable via Object.getOwnPropertyNames() in ModelUtils.getReadOnlyPropertyNames().
    Object.defineProperty(target, propertyKey, {
        enumerable: true,
        writable: true,
        value: undefined,
    });
}

type PartialACL = Partial<AccessControlList> & Pick<AccessControlList, "records">;

/**
 * Apply this to a model class to indicate that it should be protected by the AccessControlList security system.
 * The `classACL` parameter specifies the default ACL governing access to general operations against the model class
 * (e.g. create, truncate, find). The `recordACL` parameter indicates whether or not per-record ACLs should be created
 * for this type in order to govern access to individual record operations (e.g. delete, update, find).
 *
 * @param classACL The default access control list to limit access to general class operations.
 * @param recordACL Set to `true` to create an ACL for each new record of the given type, otherwise set to false. Default
 * is `false`.
 */
export function Protect(
    classACL: PartialACL = {
        uid: "<ClassName>",
        records: [
            {
                userOrRoleId: "anonymous",
                create: false,
                read: true,
                update: false,
                delete: false,
                special: false,
                full: false,
            },
            {
                userOrRoleId: ".*",
                create: false,
                read: true,
                update: false,
                delete: false,
                special: false,
                full: false,
            },
        ],
    },
    recordACL: boolean = false
) {
    return function (target: any) {
        if (!classACL.uid || classACL.uid === "<ClassName>") {
            classACL.uid = target.name;
        }

        Reflect.defineMetadata("rrst:classACL", classACL, target);
        Object.defineProperty(target, "classACL", {
            enumerable: true,
            writable: false,
            value: classACL,
        });
        Reflect.defineMetadata("rrst:recordACL", recordACL, target);
        Object.defineProperty(target, "recordACL", {
            enumerable: true,
            writable: false,
            value: recordACL,
        });
    };
}

/**
 * Apply this to a property to indicate that the value is a reference to another stored entity.
 *
 * @param clazz The class type of the referenced object.
 */
export function Reference(clazz: any) {
    return function (target: any, propertyKey: string | symbol) {
        Reflect.defineMetadata("rrst:reference", clazz, target, propertyKey);
    };
}

/**
 * Indicates that the class describes an entity that will be persisted in a sharded database collection.
 *
 * Note: Only supported by MongoDB.
 *
 * @param config The sharding configuration to pass to the database server. Default value is `{ key: { uid: 1 }, unique: false, options: {} }`.
 */
export function Shard(config: any = { key: { uid: 1 }, unique: false, options: {} }) {
    return function (target: any) {
        Reflect.defineMetadata("rrst:shardConfig", config, target);
        Object.defineProperty(target, "shardConfig", {
            enumerable: true,
            writable: true,
            value: config,
        });
    };
}

/**
 * Indicates that the class will track changes for each document update limited to the specified number of versions.
 *
 * @param versions The number of versions that will be tracked for each document change. Set to `-1` to store all
 * versions. Default value is `-1`.
 */
export function TrackChanges(versions: number = -1) {
    return function (target: any) {
        Reflect.defineMetadata("rrst:trackChanges", versions, target);
        Object.defineProperty(target, "trackChanges", {
            enumerable: true,
            writable: true,
            value: versions,
        });
    };
}
