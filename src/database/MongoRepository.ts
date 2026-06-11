///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type {
    AggregationCursor,
    Collection,
    Db,
    DeleteResult,
    Document,
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
        try {
            await this.collection.drop();
        } catch (err: any) {
            // Ignore "ns not found" errors for collections that don't exist yet
            if (err.codeName !== "NamespaceNotFound" && !String(err.message).includes("ns not found")) {
                throw err;
            }
        }
    }

    /**
     * Returns the number of documents matching the given filter.
     *
     * @param filter The query filter to match documents against.
     */
    public async count(filter?: any): Promise<number> {
        return this.collection.countDocuments(filter ?? {});
    }

    /**
     * Deletes all documents matching the given filter.
     *
     * @param filter The query filter to match documents against.
     */
    public async deleteMany(filter: any): Promise<DeleteResult> {
        return this.collection.deleteMany(filter);
    }

    /**
     * Deletes the first document matching the given filter.
     *
     * @param filter The query filter to match documents against.
     */
    public async deleteOne(filter: any): Promise<DeleteResult> {
        return this.collection.deleteOne(filter);
    }

    /**
     * Returns the list of distinct values of the given field for all documents matching the given filter.
     *
     * @param field The name of the document field to return distinct values of.
     * @param filter The query filter to match documents against.
     */
    public async distinct(field: string, filter?: any): Promise<any[]> {
        return this.collection.distinct(field, filter ?? {});
    }

    /**
     * Returns all documents matching the given filter.
     *
     * @param filter The query filter to match documents against.
     */
    public async find(filter?: any): Promise<any[]> {
        return this.collection.find(filter ?? {}).toArray();
    }

    /**
     * Returns the first document matching the given filter.
     *
     * @param filter The query filter to match documents against.
     */
    public async findOne(filter: any): Promise<any | null> {
        return this.collection.findOne(filter);
    }

    /**
     * Saves the given document to the collection. If the document has an existing `_id` the stored document is
     * replaced (inserting if missing), otherwise the document is inserted and its newly assigned `_id` is set on
     * the returned object.
     *
     * @param doc The document to save.
     * @returns The saved document.
     */
    public async save(doc: any): Promise<any> {
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
     */
    public async updateMany(filter: any, update: any): Promise<UpdateResult> {
        return this.collection.updateMany(filter, update);
    }

    /**
     * Updates the first document matching the given filter with the provided update operations.
     *
     * @param filter The query filter to match documents against.
     * @param update The update operations (e.g. `$set`) to apply.
     */
    public async updateOne(filter: any, update: any): Promise<UpdateResult> {
        return this.collection.updateOne(filter, update);
    }
}
