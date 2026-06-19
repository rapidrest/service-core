///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { CreateCollectionOptions, Db, Document } from "mongodb";
import { CollationOptions, EntityOptions, getIndexMetadata, IndexInfo } from "../decorators/PersistenceDecorators.js";
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
}

/**
 * Performs structure synchronization of MongoDB collections based on the persistence metadata of model classes.
 *
 * For each collection associated with a model class the following operations are performed:
 * - The collection is created if it does not already exist.
 * - Indexes declared via the `@Index` and `@Unique` decorators are created if missing.
 * - Existing declared indexes whose definition has changed are dropped and re-created.
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

        // Rule 2: most ancestral class owning a datastore binding
        let owner: any = undefined;
        for (let c = clazz; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
            if (Reflect.getOwnMetadata("rrst:datastore", c)) {
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
            const info: CollectionInfo = this.resolveCollectionInfo(clazz);
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
        const desired: Map<string, DesiredIndex> = new Map();
        for (const clazz of info.classes) {
            for (const index of getIndexMetadata(clazz)) {
                const spec: DesiredIndex = this.toDesiredIndex(index);
                desired.set(JSON.stringify(spec.key), spec);
            }
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
            await collection.createIndex(spec.key, options);
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
     */
    private optionsMatch(spec: DesiredIndex, current: Document): boolean {
        return (
            spec.unique === (current.unique ?? false) &&
            spec.sparse === (current.sparse ?? false) &&
            spec.expireAfterSeconds === (current.expireAfterSeconds ?? undefined)
        );
    }
}
