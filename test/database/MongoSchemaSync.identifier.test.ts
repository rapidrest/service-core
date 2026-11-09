///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { MongoSchemaSync } from "../../src/database/MongoSchemaSync";
import { Column, Entity, Index } from "../../src/decorators/PersistenceDecorators";
import { Identifier, TrackChanges } from "../../src/decorators/ModelDecorators";
import { BaseMongoEntity } from "../../src/models/BaseMongoEntity";

const CI = { locale: "en", strength: 2 };

@Entity({ name: "id_single", collation: CI })
class SingleId {
    @Identifier
    @Column()
    public name: string = "";
}

@Entity({ name: "id_multi" })
class MultiId {
    @Identifier
    @Column()
    public name: string = "";

    @Identifier
    @Column()
    public email: string = "";

    @Identifier
    @Column()
    public serial: number = 0;
}

@Entity({ name: "id_tracked" })
@TrackChanges()
class TrackedId {
    @Identifier
    @Index()
    @Column()
    public name: string = "";
}

@Entity({ name: "id_declared" })
class DeclaredId {
    @Identifier
    @Index("my_name_index")
    @Column()
    public name: string = "";

    @Identifier
    @Index({ unique: true })
    @Column()
    public code: string = "";

    @Identifier
    @Index("my_sparse_index", { sparse: true })
    @Column()
    public alias: string = "";
}

@Entity({ name: "id_base" })
class BaseId extends BaseMongoEntity {
    @Identifier
    @Column()
    public name: string = "";
}

@Entity({ name: "id_dupes" })
class DupeId {
    @Identifier
    @Index("name_dupes")
    @Column()
    public name: string = "";
}

describe("MongoSchemaSync identifier index Tests", () => {
    let mongod: MongoMemoryServer;
    let client: MongoClient;
    let db: Db;

    const indexesOf = async (collection: string): Promise<Record<string, any>> => {
        const result: Record<string, any> = {};
        for (const idx of await db.collection(collection).listIndexes().toArray()) {
            result[idx.name] = idx;
        }
        return result;
    };

    beforeAll(async () => {
        mongod = await MongoMemoryServer.create();
        client = new MongoClient(mongod.getUri());
        await client.connect();
        db = client.db("identifier-indexes");
    }, 60000);

    afterAll(async () => {
        await client?.close();
        await mongod?.stop();
    });

    it("creates a partial unique index on a single identifier using the entity's collation", async () => {
        await new MongoSchemaSync(db).synchronize([SingleId]);

        const idx = (await indexesOf("id_single")).name_identifier;
        expect(idx.key).toEqual({ name: 1 });
        expect(idx.unique).toBe(true);
        expect(idx.partialFilterExpression).toEqual({ name: { $gt: "" } });
        expect(idx.collation.locale).toBe("en");
        expect(idx.collation.strength).toBe(2);

        // The database enforces it, case-insensitively, but still allows any number of absent or empty identifiers.
        const col = db.collection("id_single");
        await col.insertOne({ name: "Alice" });
        await expect(col.insertOne({ name: "ALICE" })).rejects.toMatchObject({ code: 11000 });
        await col.insertMany([{ name: "" }, { name: "" }, {}, {}, { name: null }, { name: null }]);
    });

    it("creates one unique index per identifier property, typed by the property", async () => {
        await new MongoSchemaSync(db).synchronize([MultiId]);

        const indexes = await indexesOf("id_multi");
        expect(indexes.name_identifier.key).toEqual({ name: 1 });
        expect(indexes.name_identifier.collation).toBeUndefined();
        expect(indexes.email_identifier.key).toEqual({ email: 1 });
        expect(indexes.email_identifier.partialFilterExpression).toEqual({ email: { $gt: "" } });
        expect(indexes.serial_identifier.key).toEqual({ serial: 1 });
        expect(indexes.serial_identifier.partialFilterExpression).toEqual({
            serial: { $type: ["double", "int", "long", "decimal"] },
        });
        expect(Object.values(indexes).filter((i: any) => i.unique)).toHaveLength(3);

        // Any one identifier colliding is a duplicate, no matter what the others are.
        const col = db.collection("id_multi");
        await col.insertOne({ name: "a", email: "a@x", serial: 1 });
        await expect(col.insertOne({ name: "b", email: "a@x", serial: 2 })).rejects.toMatchObject({ code: 11000 });
        await expect(col.insertOne({ name: "c", email: "c@x", serial: 1 })).rejects.toMatchObject({ code: 11000 });
        await col.insertOne({ name: "d", email: "d@x", serial: 3 });
    });

    it("makes the index unique per version for a model that tracks changes, keeping the declared index", async () => {
        await new MongoSchemaSync(db).synchronize([TrackedId]);

        const indexes = await indexesOf("id_tracked");
        expect(indexes.name_version_identifier.key).toEqual({ name: 1, version: 1 });
        expect(indexes.name_version_identifier.unique).toBe(true);
        // The declared (non-unique) lookup index is left alone
        expect(indexes.name_1.key).toEqual({ name: 1 });
        expect(indexes.name_1.unique).toBeUndefined();

        const col = db.collection("id_tracked");
        await col.insertMany([
            { name: "x", version: 0 },
            { name: "x", version: 1 },
        ]);
        await expect(col.insertOne({ name: "x", version: 1 })).rejects.toMatchObject({ code: 11000 });
    });

    it("upgrades a declared non-unique index in place, and leaves declared unique and sparse ones alone", async () => {
        await new MongoSchemaSync(db).synchronize([DeclaredId]);

        const indexes = await indexesOf("id_declared");
        // Non-unique: same name, now unique and partial. No second index for the key.
        expect(indexes.my_name_index.unique).toBe(true);
        expect(indexes.my_name_index.partialFilterExpression).toEqual({ name: { $gt: "" } });
        expect(indexes.name_identifier).toBeUndefined();
        // Already unique: untouched, so not partial
        expect(indexes.code_1.unique).toBe(true);
        expect(indexes.code_1.partialFilterExpression).toBeUndefined();
        expect(indexes.code_identifier).toBeUndefined();
        // Sparse: unique, but MongoDB doesn't allow a sparse index to also be partial
        expect(indexes.my_sparse_index.unique).toBe(true);
        expect(indexes.my_sparse_index.sparse).toBe(true);
        expect(indexes.my_sparse_index.partialFilterExpression).toBeUndefined();
        expect(Object.keys(indexes).filter((n) => n !== "_id_")).toHaveLength(3);
    });

    it("skips an identifier already covered by the unique (uid, version) index of the base entity", async () => {
        await new MongoSchemaSync(db).synchronize([BaseId]);

        const indexes = await indexesOf("id_base");
        expect(indexes.uid_version.unique).toBe(true);
        expect(indexes.uid_identifier).toBeUndefined();
        expect(indexes.uid_version_identifier).toBeUndefined();
        expect(indexes.name_identifier.unique).toBe(true);
    });

    it("leaves the indexes untouched when synchronized again", async () => {
        await new MongoSchemaSync(db).synchronize([SingleId, MultiId, TrackedId, DeclaredId, BaseId]);
        const before = await indexesOf("id_multi");

        const dropped = vi.spyOn(db.collection("id_multi"), "dropIndex");
        await new MongoSchemaSync(db).synchronize([SingleId, MultiId, TrackedId, DeclaredId, BaseId]);
        expect(await indexesOf("id_multi")).toEqual(before);
        expect(dropped).not.toHaveBeenCalled();
    });

    it("fails with a clear logged error naming the collection and index when existing records share an identifier", async () => {
        // Simulates a deployment from before the index existed: a plain index, and duplicate data.
        const col = db.collection("id_dupes");
        await col.createIndex({ name: 1 }, { name: "name_dupes" });
        await col.insertMany([{ name: "twin" }, { name: "twin" }]);

        const logger = { error: vi.fn(), debug: vi.fn() };
        const err: any = await new MongoSchemaSync(db, logger).synchronize([DupeId]).then(
            () => undefined,
            (e) => e,
        );

        expect(err).toBeInstanceOf(Error);
        expect(err.message).toContain('"name_dupes"');
        expect(err.message).toContain('collection "id_dupes"');
        expect(err.message).toContain("duplicate key");
        expect(err.cause?.code).toBe(11000);
        expect(logger.error).toHaveBeenCalledWith(err.message);

        // The index that was dropped to be replaced is put back, not lost
        const indexes = await indexesOf("id_dupes");
        expect(indexes.name_dupes.key).toEqual({ name: 1 });
        expect(indexes.name_dupes.unique).toBeUndefined();

        // Once the duplicates are resolved the next startup succeeds
        await col.deleteOne({ name: "twin" });
        await new MongoSchemaSync(db, logger).synchronize([DupeId]);
        expect((await indexesOf("id_dupes")).name_dupes.unique).toBe(true);
    });

    it("tolerates a failed restore and a missing logger when reporting a duplicate-data failure", async () => {
        const createIndex = vi
            .fn()
            .mockRejectedValueOnce(new Error("E11000 duplicate key"))
            .mockRejectedValueOnce(new Error("restore failed"));
        const collection = {
            listIndexes: () => ({
                toArray: async () => [{ v: 2, key: { name: 1 }, name: "name_dupes", ns: "x.y" }],
            }),
            dropIndex: vi.fn(),
            createIndex,
        };
        const fakeDb: any = {
            listCollections: () => ({ toArray: async () => [{ name: "id_dupes" }] }),
            collection: () => collection,
        };

        await expect(new MongoSchemaSync(fakeDb).synchronize([DupeId])).rejects.toThrow(/E11000 duplicate key/);
        expect(createIndex).toHaveBeenLastCalledWith({ name: 1 }, { name: "name_dupes" });

        const logger = { error: vi.fn(), debug: vi.fn() };
        createIndex.mockRejectedValueOnce(new Error("E11000 duplicate key")).mockRejectedValueOnce(new Error("restore failed"));
        await expect(new MongoSchemaSync(fakeDb, logger).synchronize([DupeId])).rejects.toThrow(/duplicate key/);
        expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Unable to restore index name_dupes"));
    });

    it("rethrows the original error when a declared (non-identifier) index cannot be created", async () => {
        class Plain {
            @Index("plain_idx")
            public field: string = "";
        }
        const boom = new Error("boom");
        const fakeDb: any = {
            listCollections: () => ({ toArray: async () => [{ name: "plain" }] }),
            collection: () => ({
                listIndexes: () => ({ toArray: async () => [] }),
                createIndex: vi.fn().mockRejectedValue(boom),
            }),
        };
        await expect(new MongoSchemaSync(fakeDb).synchronize([Plain])).rejects.toBe(boom);
    });

    it("skips a class that cannot be instantiated to inspect its identifiers", async () => {
        class NeedsArgs {
            constructor(arg: { x: number }) {
                if (!arg.x) {
                    throw new Error("arg required");
                }
            }
        }
        const created = vi.fn();
        const fakeDb: any = {
            listCollections: () => ({ toArray: async () => [{ name: "needs_args" }] }),
            collection: () => ({ listIndexes: () => ({ toArray: async () => [] }), createIndex: created }),
        };
        await new MongoSchemaSync(fakeDb).synchronize([NeedsArgs]);
        expect(created).not.toHaveBeenCalled();
    });
});
