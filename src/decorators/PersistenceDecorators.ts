///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { snakeCase } from "../database/NamingUtils.js";

/**
 * The set of options available when declaring a persisted column/property via the `@Column` decorator.
 */
export interface ColumnOptions {
    /** The name of the column in the datastore. Defaults to the property name. */
    name?: string;
    /** Set to `true` if the column may store `null`/`undefined` values. */
    nullable?: boolean;
    /** Set to `true` if the column is a primary key. */
    primary?: boolean;
    /** Set to `true` if the column stores a MongoDB `ObjectId` value. */
    isObjectId?: boolean;
}

/**
 * The set of options available when declaring a database index via the `@Index` decorator.
 */
export interface IndexOptions {
    /** Set to `true` to enforce that all values of the indexed properties are unique. */
    unique?: boolean;
    /** Set to `true` to only index documents in which the indexed properties exist. (MongoDB only) */
    sparse?: boolean;
    /** Set to `true` to build the index in the background. (MongoDB only) */
    background?: boolean;
    /** The time, in seconds, after which indexed documents will be automatically deleted. (MongoDB only) */
    expireAfterSeconds?: number;
}

/**
 * Describes a single persisted column/property of a model class.
 */
export interface ColumnInfo {
    /** The name of the class property. */
    propertyName: string;
    /** The design type of the property as captured at decoration time. */
    designType?: any;
    /** The options that the column was declared with. */
    options: ColumnOptions;
}

/**
 * Describes a single database index of a model class.
 */
export interface IndexInfo {
    /** The explicit name of the index, if any. */
    name?: string;
    /** The list of class properties that make up the index. */
    columns: string[];
    /** The options that the index was declared with. */
    options: IndexOptions;
}

const COLUMNS_KEY = "rrst:columns";
const INDEXES_KEY = "rrst:indexes";
const CLASS_INDEXES_KEY = "rrst:classIndexes";
const ENTITY_NAME_KEY = "rrst:entityName";

/**
 * Appends a value to the metadata array stored directly on the given target (never on an ancestor), creating the
 * array if it does not yet exist. Using own-metadata ensures that subclasses do not accidentally mutate the
 * metadata arrays of their parent classes.
 */
function pushOwnMetadata(key: string, target: any, value: any): void {
    const list: any[] = Reflect.getOwnMetadata(key, target) ?? [];
    list.push(value);
    Reflect.defineMetadata(key, list, target);
}

/**
 * Collects metadata arrays of the given key from every level of the prototype or constructor chain, ordered from
 * the most derived class to the most ancestral.
 */
function collectOwnMetadata(key: string, target: any): any[][] {
    const results: any[][] = [];
    for (let t = target; t && t !== Function.prototype && t !== Object.prototype; t = Object.getPrototypeOf(t)) {
        const list: any[] = Reflect.getOwnMetadata(key, t);
        if (list) {
            results.push(list);
        }
    }
    return results;
}

/**
 * Indicates that the decorated property will be persisted as a column/property in the datastore.
 *
 * @param options The options describing the column.
 */
export function Column(options: ColumnOptions = {}) {
    return function (target: any, propertyKey: string | symbol): void {
        const designType: any = Reflect.getMetadata("design:type", target, propertyKey);
        pushOwnMetadata(COLUMNS_KEY, target, {
            propertyName: String(propertyKey),
            designType,
            options,
        } satisfies ColumnInfo);
    };
}

/**
 * Indicates that the decorated property is a primary key column in the datastore.
 *
 * @param options The options describing the column.
 */
export function PrimaryColumn(options: ColumnOptions = {}) {
    return Column({ ...options, primary: true });
}

/**
 * Declares a database index.
 *
 * When applied to a property, creates an index on that single property:
 * ```
 * @Index()                            // unnamed index
 * @Index("myName")                    // named index
 * @Index({ unique: true })            // unnamed unique index
 * @Index("myName", { unique: true })  // named unique index
 * ```
 *
 * When applied to a class, creates a compound index across the given properties:
 * ```
 * @Index(["firstName", "lastName"])
 * @Index("fullName", ["firstName", "lastName"], { unique: true })
 * ```
 */
/* eslint-disable no-redeclare */
export function Index(nameOrOptions?: string | IndexOptions, options?: IndexOptions): PropertyDecorator;
export function Index(fields: string[], options?: IndexOptions): ClassDecorator;
export function Index(name: string, fields: string[], options?: IndexOptions): ClassDecorator;
export function Index(nameOrFieldsOrOptions?: string | string[] | IndexOptions, fieldsOrOptions?: string[] | IndexOptions, maybeOptions?: IndexOptions): any {
    // Normalize the various overload signatures
    const name: string | undefined = typeof nameOrFieldsOrOptions === "string" ? nameOrFieldsOrOptions : undefined;
    const fields: string[] | undefined = Array.isArray(nameOrFieldsOrOptions)
        ? nameOrFieldsOrOptions
        : Array.isArray(fieldsOrOptions)
          ? fieldsOrOptions
          : undefined;
    const options: IndexOptions =
        (typeof nameOrFieldsOrOptions === "object" && !Array.isArray(nameOrFieldsOrOptions)
            ? nameOrFieldsOrOptions
            : typeof fieldsOrOptions === "object" && !Array.isArray(fieldsOrOptions)
              ? fieldsOrOptions
              : maybeOptions) ?? {};

    return function (target: any, propertyKey?: string | symbol): void {
        if (propertyKey !== undefined) {
            // Property-level index
            pushOwnMetadata(INDEXES_KEY, target, {
                name,
                columns: [String(propertyKey)],
                options,
            } satisfies IndexInfo);
        } else {
            // Class-level (compound) index
            if (!fields || fields.length === 0) {
                throw new Error(`@Index on class ${target.name} requires a list of property names.`);
            }
            pushOwnMetadata(CLASS_INDEXES_KEY, target, {
                name,
                columns: fields,
                options,
            } satisfies IndexInfo);
        }
    };
}
/* eslint-enable no-redeclare */

/**
 * Declares a unique constraint. This is shorthand for `@Index` with the `unique` option set to `true` and may be
 * applied to a property (single-column constraint) or a class (compound constraint).
 */
/* eslint-disable no-redeclare */
export function Unique(name?: string): PropertyDecorator;
export function Unique(fields: string[]): ClassDecorator;
export function Unique(name: string, fields: string[]): ClassDecorator;
export function Unique(nameOrFields?: string | string[], maybeFields?: string[]): any {
    if (typeof nameOrFields === "string") {
        return maybeFields ? Index(nameOrFields, maybeFields, { unique: true }) : Index(nameOrFields, { unique: true });
    } else if (Array.isArray(nameOrFields)) {
        return Index(nameOrFields, { unique: true });
    }
    return Index({ unique: true });
}
/* eslint-enable no-redeclare */

/**
 * Indicates that the class describes an entity that is persisted to a datastore.
 *
 * @param name The name of the collection (or table) that records will be stored in. Defaults to the snake_case
 * form of the class name.
 */
export function Entity(name?: string) {
    return function (target: any): void {
        const entityName: string = name ?? snakeCase(target.name);
        Reflect.defineMetadata(ENTITY_NAME_KEY, entityName, target);
        Object.defineProperty(target, "entityName", {
            enumerable: true,
            writable: true,
            value: entityName,
        });
    };
}

/**
 * Returns the merged list of persisted columns declared across the entire class hierarchy of the given model
 * class. Columns declared in subclasses override columns of the same property name declared in parent classes.
 *
 * @param clazz The model class to retrieve column metadata for.
 */
export function getColumnMetadata(clazz: any): ColumnInfo[] {
    const merged: Map<string, ColumnInfo> = new Map();
    // Most-derived first; first occurrence of a property name wins
    for (const list of collectOwnMetadata(COLUMNS_KEY, clazz.prototype ?? clazz)) {
        for (const column of list as ColumnInfo[]) {
            if (!merged.has(column.propertyName)) {
                merged.set(column.propertyName, column);
            }
        }
    }
    return Array.from(merged.values());
}

/**
 * Returns the merged list of indexes declared across the entire class hierarchy of the given model class,
 * including both property-level and class-level (compound) indexes. Indexes declared in subclasses override
 * indexes with the same identity (name, or column set when unnamed) declared in parent classes.
 *
 * @param clazz The model class to retrieve index metadata for.
 */
export function getIndexMetadata(clazz: any): IndexInfo[] {
    const merged: Map<string, IndexInfo> = new Map();
    const identity = (idx: IndexInfo): string => idx.name ?? `cols:${idx.columns.join(",")}`;
    // Most-derived first; first occurrence of an identity wins
    const lists: any[][] = [
        ...collectOwnMetadata(INDEXES_KEY, clazz.prototype ?? clazz),
        ...collectOwnMetadata(CLASS_INDEXES_KEY, clazz),
    ];
    for (const list of lists) {
        for (const index of list as IndexInfo[]) {
            const key: string = identity(index);
            if (!merged.has(key)) {
                merged.set(key, index);
            }
        }
    }
    return Array.from(merged.values());
}

/**
 * Returns the explicit entity name declared via `@Entity(name)` on the given class or the nearest ancestor that
 * declares one, otherwise `undefined`.
 *
 * @param clazz The model class to retrieve the entity name for.
 */
export function getEntityName(clazz: any): string | undefined {
    for (let c = clazz; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
        const entityName: string | undefined = Reflect.getOwnMetadata(ENTITY_NAME_KEY, c);
        if (entityName) {
            return entityName;
        }
    }
    return undefined;
}
