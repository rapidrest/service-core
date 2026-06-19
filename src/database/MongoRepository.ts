///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type {
    AggregationCursor,
    Collection,
    CountDocumentsOptions,
    Db,
    DeleteOptions,
    DeleteResult,
    Document,
    Filter,
    FindCursor,
    FindOptions,
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
    public aggregate(pipeline: Document[]): AggregationCursor<any> {
        return this.collection.aggregate(pipeline);
    }

    /**
     * Drops the entire collection from the database, removing all documents and indexes. Does nothing if the
     * collection does not exist.
     */
    public async clear(): Promise<void> {
        await this.collection.deleteMany({});
    }

    /**
     * Returns the number of documents matching the given filter.
     *
     * @param filter - The filter for the count
     * @param options - Optional settings for the command
     */
    public count(filter?: Filter<T>, options?: CountDocumentsOptions): Promise<number> {
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
     * Returns the list of distinct values of the given field for all documents matching the given filter.
     *
     * @param field The name of the document field to return distinct values of.
     * @param filter The query filter to match documents against.
     */
    public distinct(field: string, filter?: Filter<T>): Promise<any[]> {
        return this.collection.distinct(field, filter ?? {});
    }

    /**
     * Returns all documents matching the given filter.
     *
     * @param filter The query filter to match documents against.
     * @param options - Optional settings for the command
     */
    public find(filter?: Filter<T>, options?: FindOptions): FindCursor<T> {
        return this.collection.find(filter ?? {}, options) as FindCursor<T>;
    }

    /**
     * Returns the first document matching the given filter.
     *
     * @param filter The query filter to match documents against.
     */
    public findOne(filter: any): Promise<T | null> {
        return this.collection.findOne(filter) as Promise<T | null>;
    }

    /**
     * Saves the given document to the collection. If the document has an existing `_id` the stored document is
     * replaced (inserting if missing), otherwise the document is inserted and its newly assigned `_id` is set on
     * the returned object.
     *
     * @param doc The document to save.
     * @returns The saved document.
     */
    public async save(doc: any): Promise<T> {
        const copy: any = { ...doc };
        // Strip any undefined properties so they are omitted from the stored document
        for (const key of Object.keys(copy)) {
            if (copy[key] === undefined) {
                delete copy[key];
            }
        }

        if (doc._id !== undefined && doc._id !== null) {
            await this.collection.replaceOne({ _id: doc._id }, copy, { upsert: true });
        } else {
            const result = await this.collection.insertOne(copy);
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
