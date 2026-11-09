///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { CreateCollectionOptions, Db, Document } from "mongodb";
import {
    getIndexMetadata,
    type CollationOptions,
    type EntityOptions,
    type IndexInfo,
} from "../decorators/PersistenceDecorators.js";
import { ModelUtils } from "../models/ModelUtils.js";
import { snakeCase } from "./NamingUtils.js";

interface CollectionInfo {
    name: string;
    classes: any[];
    options?: CreateCollectionOptions;
}

/**
 * Describes a single index that should exist on a MongoDB collection.
 */
interface DesiredIndex {
    name: string;
    key: Record<string, number>;
    unique: boolean;
    sparse: boolean;
    background?: boolean;
    expireAfterSeconds?: number;
    collation?: CollationOptions;
    partialFilterExpression?: Document;
    /** Set for an index that enforces a model's `@Identifier` uniqueness (see `applyIdentifierIndexes`). */
    identifier?: boolean;
}

/** The BSON types that a numeric identifier value can be stored as. */
const NUMERIC_BSON_TYPES: string[] = ["double", "int", "long", "decimal"];

/**
 * Performs structure synchronization of MongoDB collections based on the persistence metadata of model classes.
 *
 * For each collection associated with a model class the following operations are performed:
 * - The collection is created if it does not already exist.
 * - Indexes declared via the `@Index` and `@Unique` decorators are created if missing.
 * - Existing declared indexes whose definition has changed are dropped and re-created.
 * - A unique index is created for every `@Identifier` property of a model so that the database enforces what
 * `RepoUtils.create()` assumes, see `applyIdentifierIndexes()`.
 *
 * The synchronization process never drops collections or data, never modifies the built-in `_id_` index, and never
 * drops indexes that are not declared by the model class (e.g. shard keys or manually created indexes).
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class MongoSchemaSync {
    private db: Db;
    private logger: any;

    constructor(db: Db, logger?: any) {
        this.db = db;
        this.logger = logger;
    }

    /**
     * Resolves the entity info of the database collection (or table) that records of the given model class are stored in.
     *
     * The entity info is resolved using the following rules:
     * 1. The nearest class in the inheritance chain (starting with `clazz` itself) that specifies an explicit
     * entity info via the `@Entity(info)` decorator.
     * 2. Otherwise, the most ancestral class in the inheritance chain that declares its own `@DataStore` binding.
     * This ensures that `@ChildEntity` subclasses are stored in the same collection as their parent entity
     * (single collection inheritance).
     * 3. Otherwise, a new info object containing the snake_case form of the class name.
     *
     * @param clazz The model class to resolve the collection name for.
     */
    public resolveCollectionInfo(clazz: any): CollectionInfo {
        // Rule 1: nearest explicit entity options
        for (let c = clazz; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
            const entityOptions: EntityOptions | undefined = Reflect.getOwnMetadata("rrst:entityOptions", c);
            if (entityOptions) {
                const info: CollectionInfo = {
                    name: entityOptions.name!,
                    classes: [],
                };
                if (entityOptions.collation) {
                    info.options = { collation: entityOptions.collation };
                }
                return info;
            }
        }

        // Rule 2: most ancestral class owning a datasource binding
        let owner: any = undefined;
        for (let c = clazz; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
            if (Reflect.getOwnMetadata("rrst:datasource", c)) {
                owner = c;
            }
        }

        // Rule 3: fall back to the class itself
        return {
            name: snakeCase((owner ?? clazz).name),
            classes: [],
        };
    }

    /**
     * Synchronizes the structure of all collections associated with the given model classes.
     *
     * @param entities The list of model classes to synchronize collections for.
     */
    public async synchronize(entities: Iterable<any>): Promise<void> {
        // Group the model classes by their resolved collection name so that all classes stored in the same
        // collection (e.g. @ChildEntity subclasses) contribute their indexes to a single specification.
        const collections: Map<string, CollectionInfo> = new Map();
        for (const clazz of entities) {
            const resolved: CollectionInfo = this.resolveCollectionInfo(clazz);
            // Merge into any info already built for this collection by an earlier class. Replacing it would drop the
            // earlier classes, so only the last class's indexes would be created.
            const info: CollectionInfo = collections.get(resolved.name) ?? resolved;
            if (!info.options && resolved.options) {
                info.options = resolved.options;
            }
            info.classes.push(clazz);
            collections.set(info.name, info);
        }

        for (const [name, info] of collections.entries()) {
            await this.syncCollection(info);
        }
    }

    /**
     * Synchronizes the structure of a single collection.
     *
     * @param info The information about the collection to synchronize.
     */
    private async syncCollection(info: CollectionInfo): Promise<void> {
        // Create the collection if it doesn't already exist
        const existing: Document[] = await this.db.listCollections({ name: info.name }, { nameOnly: true }).toArray();
        if (existing.length === 0) {
            try {
                await this.db.createCollection(info.name, info.options);
                this.logger?.debug(`Created collection: ${info.name}`);
            } catch (err: any) {
                // Tolerate concurrent creation races
                if (err.codeName !== "NamespaceExists") {
                    throw err;
                }
            }
        }

        // Build the merged set of desired indexes from all classes stored in this collection
        const entityCollation = info.options?.collation;
        const desired: Map<string, DesiredIndex> = new Map();
        for (const clazz of info.classes) {
            for (const index of getIndexMetadata(clazz)) {
                const spec: DesiredIndex = this.toDesiredIndex(index);
                // Indexes inherit the collection's collation when none is declared on the index itself.
                // This means @Entity({ collation }) is the single source of truth for case-sensitivity.
                if (!spec.collation && entityCollation) {
                    spec.collation = entityCollation;
                }
                desired.set(JSON.stringify(spec.key), spec);
            }
        }

        // Add the unique indexes that enforce the models' identifiers
        for (const clazz of info.classes) {
            this.applyIdentifierIndexes(clazz, desired, entityCollation);
        }

        // Retrieve the collection's current indexes
        const collection = this.db.collection(info.name);
        let currentIndexes: Document[] = [];
        try {
            currentIndexes = await collection.listIndexes().toArray();
        } catch (err: any) {
            if (err.codeName !== "NamespaceNotFound") {
                throw err;
            }
        }

        // Reconcile the desired indexes against the current state
        for (const spec of desired.values()) {
            const current: Document | undefined = currentIndexes.find(
                (idx) => JSON.stringify(idx.key) === JSON.stringify(spec.key),
            );

            if (current) {
                if (this.optionsMatch(spec, current)) {
                    continue;
                }
                // The index definition has changed. Drop and re-create it.
                this.logger?.debug(
                    `Re-creating index ${current.name} on collection ${info.name} due to changed definition.`,
                );
                await collection.dropIndex(current.name as string);
            } else {
                // If an unrelated index already uses the desired name it must be dropped first to avoid a conflict
                const conflict: Document | undefined = currentIndexes.find((idx) => idx.name === spec.name);
                if (conflict) {
                    this.logger?.debug(`Dropping index ${spec.name} on collection ${info.name} due to changed key.`);
                    await collection.dropIndex(spec.name);
                }
                this.logger?.debug(`Creating index ${spec.name} on collection ${info.name}.`);
            }

            const options: any = {
                name: spec.name,
                unique: spec.unique,
                sparse: spec.sparse,
                ...(spec.background !== undefined ? { background: spec.background } : {}),
                ...(spec.expireAfterSeconds !== undefined ? { expireAfterSeconds: spec.expireAfterSeconds } : {}),
            };
            // HAX For some reason MongoDB chokes if you pass in `collation` with a value of `undefined`
            if (spec.collation) {
                options.collation = spec.collation;
            }
            if (spec.partialFilterExpression) {
                options.partialFilterExpression = spec.partialFilterExpression;
            }

            try {
                await collection.createIndex(spec.key, options);
            } catch (err: any) {
                if (!spec.identifier) {
                    throw err;
                }
                // Don't leave the collection without the index that was just dropped in order to replace it.
                if (current) {
                    await this.restoreIndex(collection, info.name, current);
                }
                const message: string =
                    `Unable to create the unique identifier index "${spec.name}" (${JSON.stringify(spec.key)}) on ` +
                    `collection "${info.name}": ${err?.message ?? err}. ` +
                    `If existing records share the same identifier, resolve the duplicates and restart.`;
                this.logger?.error(message);
                const wrapped: Error = new Error(message);
                (wrapped as any).cause = err;
                throw wrapped;
            }
        }
    }

    /**
     * Adds to `desired` the unique indexes that enforce the `@Identifier` properties of `clazz`.
     *
     * `RepoUtils.create()` rejects a record when any one of its identifiers matches an existing record, but checks
     * and inserts in separate steps. Without a unique index two concurrent creates both pass the check. The rules:
     * - One index per identifier property (not one compound index), because a match on any single identifier
     * counts as a duplicate.
     * - A model that does not `@TrackChanges` gets a unique index on the property alone. A tracked model stores every
     * version of a record under the same identifier, so its index is unique on the property and `version`.
     * - The index uses the entity's collation, like every other index, so that it agrees with the case-insensitive
     * lookups of `create()`.
     * - `create()` ignores an empty identifier, so the index is partial and leaves out absent, null and empty values:
     * `$gt: ""` for strings (the default), the numeric types for numbers and `date` for dates. A zero or `false` is
     * therefore indexed even though `create()` ignores it.
     * - An identifier that is already guaranteed unique is skipped: a unique index on exactly that key, or on the
     * property and `version` (as `BaseMongoEntity`'s `uid_version` index is for `uid`; `create()` always writes the
     * version of a non-tracked record as 0).
     * - An index that the model declared with exactly the required key and without `unique` is upgraded in place
     * rather than duplicated: it keeps its name and options and becomes unique and, unless it is `sparse` (MongoDB
     * doesn't allow both), partial. Equality and `$in` lookups still use it.
     */
    private applyIdentifierIndexes(clazz: any, desired: Map<string, DesiredIndex>, collation?: CollationOptions): void {
        let props: string[];
        try {
            props = ModelUtils.getIdPropertyNames(clazz);
        } catch {
            // A class that can't be instantiated without arguments can't be inspected, and isn't a model.
            return;
        }
        const tracked: boolean = !!clazz.trackChanges;

        for (const prop of props) {
            const columns: string[] = tracked ? [prop, "version"] : [prop];
            const key: Record<string, number> = {};
            for (const column of columns) {
                key[column] = 1;
            }

            const existing: DesiredIndex | undefined = desired.get(JSON.stringify(key));
            const versioned: DesiredIndex | undefined = desired.get(JSON.stringify({ [prop]: 1, version: 1 }));
            if (existing?.unique || versioned?.unique) {
                continue;
            }

            const partial: Document = this.identifierFilter(clazz, prop);
            if (existing) {
                existing.unique = true;
                existing.identifier = true;
                if (!existing.sparse) {
                    existing.partialFilterExpression = partial;
                }
                continue;
            }

            desired.set(JSON.stringify(key), {
                name: `${columns.join("_")}_identifier`,
                key,
                unique: true,
                sparse: false,
                collation,
                partialFilterExpression: partial,
                identifier: true,
            });
        }
    }

    /**
     * Builds the partial filter that limits an identifier index to the values `create()` treats as present.
     */
    private identifierFilter(clazz: any, prop: string): Document {
        const type: any = Reflect.getMetadata("design:type", clazz.prototype, prop);
        if (type === Number) {
            return { [prop]: { $type: NUMERIC_BSON_TYPES } };
        } else if (type === Date) {
            return { [prop]: { $type: "date" } };
        }
        return { [prop]: { $gt: "" } };
    }

    /**
     * Re-creates an index exactly as the database reported it. A failure is logged and swallowed since the caller is
     * already reporting the error that made the restore necessary.
     */
    private async restoreIndex(collection: any, collectionName: string, current: Document): Promise<void> {
        const { v, key, ns, ...options } = current;
        try {
            await collection.createIndex(key, options);
        } catch (err: any) {
            this.logger?.error(`Unable to restore index ${current.name} on collection ${collectionName}: ${err?.message}`);
        }
    }

    /**
     * Converts declared index metadata into a desired index specification.
     */
    private toDesiredIndex(index: IndexInfo): DesiredIndex {
        const key: Record<string, number> = {};
        for (const column of index.columns) {
            key[column] = 1;
        }
        return {
            name: index.name ?? index.columns.map((c) => `${c}_1`).join("_"),
            key,
            unique: index.options.unique ?? false,
            sparse: index.options.sparse ?? false,
            background: index.options.background,
            expireAfterSeconds: index.options.expireAfterSeconds,
            collation: index.options.collation,
        };
    }

    /**
     * Determines whether an existing index satisfies the desired index specification. The `background` option is
     * a build-time hint and is intentionally excluded from the comparison.
     *
     * Collation is compared by `locale` and `strength` only — MongoDB adds default values for all other fields
     * when storing the index, which would cause spurious mismatches if we compared the full object.
     */
    private optionsMatch(spec: DesiredIndex, current: Document): boolean {
        const collationMatches = spec.collation
            ? spec.collation.locale === current.collation?.locale &&
              (spec.collation.strength ?? 3) === (current.collation?.strength ?? 3)
            : !current.collation;
        return (
            spec.unique === (current.unique ?? false) &&
            spec.sparse === (current.sparse ?? false) &&
            spec.expireAfterSeconds === (current.expireAfterSeconds ?? undefined) &&
            JSON.stringify(spec.partialFilterExpression) === JSON.stringify(current.partialFilterExpression) &&
            collationMatches
        );
    }
}
