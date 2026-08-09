///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { MongoSchemaSync } from "../../src/database/MongoSchemaSync";
import { Index } from "../../src/decorators/PersistenceDecorators";

/** Builds a fake `collection(...)` result with configurable index listing/mutation behavior. */
function makeCollection(opts: {
    indexes?: any[];
    listIndexesError?: any;
    dropIndex?: ReturnType<typeof vi.fn>;
    createIndex?: ReturnType<typeof vi.fn>;
}) {
    return {
        listIndexes: vi.fn(() => ({
            toArray: () =>
                opts.listIndexesError ? Promise.reject(opts.listIndexesError) : Promise.resolve(opts.indexes ?? []),
        })),
        dropIndex: opts.dropIndex ?? vi.fn().mockResolvedValue(undefined),
        createIndex: opts.createIndex ?? vi.fn().mockResolvedValue(undefined),
    };
}

/** Builds a fake `Db` with configurable collection-listing/creation behavior. */
function makeDb(opts: { existing?: any[]; createCollectionError?: any; collection: any }) {
    return {
        listCollections: vi.fn(() => ({ toArray: () => Promise.resolve(opts.existing ?? []) })),
        createCollection: vi.fn(() =>
            opts.createCollectionError ? Promise.reject(opts.createCollectionError) : Promise.resolve(undefined),
        ),
        collection: vi.fn(() => opts.collection),
    };
}

describe("MongoSchemaSync Tests", () => {
    describe("resolveCollectionInfo", () => {
        it("falls back to the snake_case class name when no @DataStore or @Entity is declared anywhere in the chain", () => {
            class PlainNoDecorators {}
            const sync = new MongoSchemaSync({} as any);
            const info = sync.resolveCollectionInfo(PlainNoDecorators);
            expect(info.name).toBe("plain_no_decorators");
            expect(info.classes).toEqual([]);
        });
    });

    describe("syncCollection - collection creation races", () => {
        it("tolerates a NamespaceExists error raised by a concurrent collection creation", async () => {
            class ToleratedModel {}
            const collection = makeCollection({ indexes: [] });
            const db = makeDb({
                existing: [],
                createCollectionError: Object.assign(new Error("already exists"), { codeName: "NamespaceExists" }),
                collection,
            });

            const sync = new MongoSchemaSync(db as any);
            await expect(sync.synchronize([ToleratedModel])).resolves.toBeUndefined();
            expect(db.createCollection).toHaveBeenCalledTimes(1);
        });

        it("rethrows collection creation errors that are not a NamespaceExists race", async () => {
            class FailingModel {}
            const collection = makeCollection({ indexes: [] });
            const db = makeDb({
                existing: [],
                createCollectionError: Object.assign(new Error("permission denied"), { codeName: "Unauthorized" }),
                collection,
            });

            const sync = new MongoSchemaSync(db as any);
            await expect(sync.synchronize([FailingModel])).rejects.toThrow("permission denied");
        });
    });

    describe("syncCollection - listing existing indexes", () => {
        it("tolerates a NamespaceNotFound error when listing indexes of a brand-new collection", async () => {
            class NoIndexModel {}
            const collection = makeCollection({
                listIndexesError: Object.assign(new Error("ns not found"), { codeName: "NamespaceNotFound" }),
            });
            const db = makeDb({ existing: [{ name: "no_index_model" }], collection });

            const sync = new MongoSchemaSync(db as any);
            await expect(sync.synchronize([NoIndexModel])).resolves.toBeUndefined();
            expect(collection.listIndexes).toHaveBeenCalledTimes(1);
        });

        it("rethrows index listing errors that are not a NamespaceNotFound race", async () => {
            class NoIndexModel2 {}
            const collection = makeCollection({
                listIndexesError: Object.assign(new Error("auth failed"), { codeName: "AuthenticationFailed" }),
            });
            const db = makeDb({ existing: [{ name: "no_index_model2" }], collection });

            const sync = new MongoSchemaSync(db as any);
            await expect(sync.synchronize([NoIndexModel2])).rejects.toThrow("auth failed");
        });
    });

    describe("syncCollection - index reconciliation", () => {
        it("drops a conflicting index that already owns the desired name under a different key", async () => {
            class ConflictModel {
                @Index("myidx")
                foo: string = "";
            }
            const collection = makeCollection({ indexes: [{ name: "myidx", key: { bar: 1 } }] });
            const db = makeDb({ existing: [{ name: "conflict_model" }], collection });

            const sync = new MongoSchemaSync(db as any);
            await sync.synchronize([ConflictModel]);

            expect(collection.dropIndex).toHaveBeenCalledWith("myidx");
            expect(collection.createIndex).toHaveBeenCalledWith({ foo: 1 }, expect.objectContaining({ name: "myidx" }));
        });

        it("passes through background and expireAfterSeconds options when creating a new index", async () => {
            class TtlModel {
                @Index("ttlidx", { background: true, expireAfterSeconds: 3600 })
                foo: string = "";
            }
            const collection = makeCollection({ indexes: [] });
            const db = makeDb({ existing: [{ name: "ttl_model" }], collection });

            const sync = new MongoSchemaSync(db as any);
            await sync.synchronize([TtlModel]);

            expect(collection.createIndex).toHaveBeenCalledWith(
                { foo: 1 },
                expect.objectContaining({ name: "ttlidx", background: true, expireAfterSeconds: 3600 }),
            );
        });

        it("treats a matching collation as equal when neither side declares an explicit strength", async () => {
            class CollationModel {
                @Index("collidx", { collation: { locale: "en" } })
                foo: string = "";
            }
            const collection = makeCollection({
                indexes: [{ name: "collidx", key: { foo: 1 }, collation: { locale: "en" } }],
            });
            const db = makeDb({ existing: [{ name: "collation_model" }], collection });

            const sync = new MongoSchemaSync(db as any);
            await sync.synchronize([CollationModel]);

            // The existing index already matches (default strength 3 assumed on both sides), so it must be left alone.
            expect(collection.dropIndex).not.toHaveBeenCalled();
            expect(collection.createIndex).not.toHaveBeenCalled();
        });
    });
});
