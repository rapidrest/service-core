///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type {
    Abortable,
    AggregateOptions,
    AggregationCursor,
    Collection,
    CountDocumentsOptions,
    Db,
    DeleteOptions,
    DeleteResult,
    DistinctOptions,
    Document,
    Filter,
    FindCursor,
    FindOneAndDeleteOptions,
    FindOneAndReplaceOptions,
    FindOptions,
    InsertOneOptions,
    ReplaceOptions,
    UpdateOptions,
    UpdateResult,
} from "mongodb";

/**
 * Provides a lightweight repository for performing common operations against a single MongoDB collection using the
 * native `mongodb` driver. Instances of this class are obtained via `MongoConnection.getRepository`.
 *
 * Note that this class only references the `mongodb` package via type-only imports and is therefore safe to load
 * when the optional `mongodb` peer dependency is not installed.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class MongoRepository<T extends Document = any> {
    /** The database that the underlying collection belongs to. */
    public readonly db: Db;
    /** The underlying MongoDB collection that operations are performed against. */
    public readonly collection: Collection<T>;
    /** The model class associated with this repository. */
    public readonly modelClass: any;

    constructor(db: Db, collection: Collection<T>, modelClass?: any) {
        this.db = db;
        this.collection = collection;
        this.modelClass = modelClass;
    }

    /** The name of the underlying MongoDB collection. */
    public get collectionName(): string {
        return this.collection.collectionName;
    }

    /**
     * Executes the given aggregation pipeline against the collection and returns the resulting cursor.
     *
     * @param pipeline The aggregation pipeline stages to execute.
     */
    public aggregate(pipeline: Document[], options?: AggregateOptions & Abortable): AggregationCursor<any> {
        return this.collection.aggregate(pipeline, options);
    }

    /**
     * Drops the entire collection from the database, removing all documents and indexes. Does nothing if the
     * collection does not exist.
     */
    public async clear(options?: DeleteOptions & Abortable): Promise<void> {
        await this.collection.deleteMany({}, options);
    }

    /**
     * Returns the number of documents matching the given filter.
     *
     * @param filter - The filter for the count
     * @param options - Optional settings for the command
     */
    public count(filter?: Filter<T>, options?: CountDocumentsOptions & Abortable): Promise<number> {
        return this.collection.countDocuments(filter ?? {}, options);
    }

    /**
     * Deletes all documents matching the given filter.
     *
     * @param filter The query filter to match documents against.
     * @param options - Optional settings for the command
     */
    public deleteMany(filter: Filter<T>, options?: DeleteOptions): Promise<DeleteResult> {
        return this.collection.deleteMany(filter, options);
    }

    /**
     * Deletes the first document matching the given filter.
     *
     * @param filter The query filter to match documents against.
     * @param options - Optional settings for the command
     */
    public deleteOne(filter?: Filter<T>, options?: DeleteOptions): Promise<DeleteResult> {
        return this.collection.deleteOne(filter, options);
    }

    /**
     * Atomically finds and deletes the first document matching the given filter, returning the document that
     * was deleted (or `null` if none matched). This is a single round trip rather than a separate `findOne()` +
     * `deleteOne()`, so a caller that needs to know exactly what it removed (e.g. to snapshot it for a
     * possible restore) isn't racing its own read against a concurrent write to the same document.
     *
     * @param filter The query filter to match documents against.
     * @param options - Optional settings for the command
     */
    public findOneAndDelete(filter: Filter<T>, options?: FindOneAndDeleteOptions): Promise<T | null> {
        return this.collection.findOneAndDelete(filter, options ?? {}) as Promise<T | null>;
    }

    /**
     * Returns the list of distinct values of the given field for all documents matching the given filter.
     *
     * @param field The name of the document field to return distinct values of.
     * @param filter The query filter to match documents against.
     */
    public distinct(field: string, filter?: Filter<T>, options?: DistinctOptions): Promise<any[]> {
        if (options) {
            return this.collection.distinct(field, filter ?? {}, options);
        } else {
            return this.collection.distinct(field, filter ?? {});
        }
    }

    /**
     * Returns all documents matching the given filter.
     *
     * @param filter The query filter to match documents against.
     * @param options - Optional settings for the command
     */
    public find(filter?: Filter<T>, options?: FindOptions & Abortable): FindCursor<T> {
        return this.collection.find(filter ?? {}, options) as FindCursor<T>;
    }

    /**
     * Returns the first document matching the given filter.
     *
     * @param filter The query filter to match documents against.
     */
    public findOne(filter: any, options?: FindOptions & Abortable): Promise<T | null> {
        return this.collection.findOne(filter, options);
    }

    /**
     * Saves the given document to the collection. By default, if the document has an existing `_id` the stored
     * document is replaced (inserting if missing), otherwise the document is inserted and its newly assigned
     * `_id` is set on the returned object. This is the behavior a trackChanges-style caller relies on to keep
     * multiple documents per `uid` (one per version): a document built for a fresh version deliberately carries
     * no `_id` yet, and must always become a genuinely new row, never merged into an existing one.
     *
     * Pass `mergeByUid: true` to instead match (and replace, or insert if missing) by the document's `uid`, the
     * framework's true logical primary key, regardless of whether `_id` was carried forward from a prior read.
     * Useful for a single-row-per-uid document that may have been built fresh (e.g. by spreading an update onto
     * a plain object) without preserving `_id`, where the default `_id`-only behavior would insert a *second*,
     * duplicate document instead of updating the existing one (see `ACLUtils.saveACL()`).
     *
     * @param doc The document to save.
     * @param options Driver options, plus optionally `mergeByUid` (see above).
     * @returns The saved document.
     */
    public async save(doc: any, options?: (InsertOneOptions | ReplaceOptions) & { mergeByUid?: boolean }): Promise<T> {
        const { mergeByUid, ...driverOptions } = options ?? {};
        const copy: any = { ...doc };
        // Strip any undefined properties so they are omitted from the stored document
        for (const key of Object.keys(copy)) {
            if (copy[key] === undefined) {
                delete copy[key];
            }
        }

        if (mergeByUid && doc.uid !== undefined && doc.uid !== null) {
            // MongoDB rejects a replacement document that tries to change an existing document's immutable
            // `_id` — when matching by `uid` instead, drop whatever `_id` `doc` happened to carry and let the
            // matched document keep its own (or let Mongo assign a fresh one on insert, captured below).
            delete copy._id;
            // `findOneAndReplace` (rather than `replaceOne`) so the resulting document's real `_id` is always
            // captured in one round trip, whether this matched an existing document or inserted a new one —
            // `replaceOne`'s result only ever reports an id for the insert case (`upsertedId`), silently
            // leaving `doc._id` unset after merging into an existing row.
            const saved = await this.collection.findOneAndReplace({ uid: doc.uid }, copy, {
                ...(driverOptions as FindOneAndReplaceOptions),
                upsert: true,
                returnDocument: "after",
                includeResultMetadata: false,
            });
            if (saved?._id !== undefined) {
                doc._id = saved._id;
            }
        } else if (doc._id !== undefined && doc._id !== null) {
            await this.collection.replaceOne({ _id: doc._id }, copy, { ...driverOptions, upsert: true });
        } else {
            const result = await this.collection.insertOne(copy, driverOptions);
            doc._id = result.insertedId;
        }

        return doc;
    }

    /**
     * Updates all documents matching the given filter with the provided update operations.
     *
     * @param filter The query filter to match documents against.
     * @param update The update operations (e.g. `$set`) to apply.
     * @param options - Optional settings for the command
     */
    public updateMany(filter: any, update: any, options?: UpdateOptions): Promise<UpdateResult<T>> {
        return this.collection.updateMany(filter, update, options);
    }

    /**
     * Updates the first document matching the given filter with the provided update operations.
     *
     * @param filter The query filter to match documents against.
     * @param update The update operations (e.g. `$set`) to apply.
     * @param options - Optional settings for the command
     */
    public updateOne(filter: any, update: any, options?: UpdateOptions): Promise<UpdateResult<T>> {
        return this.collection.updateOne(filter, update, options);
    }
}
