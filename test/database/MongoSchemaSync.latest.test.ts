///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient, Db } from "mongodb";
import { MongoSchemaSync } from "../../src/database/MongoSchemaSync";
import { Column, Entity } from "../../src/decorators/PersistenceDecorators";
import { TrackChanges } from "../../src/decorators/ModelDecorators";
import { BaseMongoEntity } from "../../src/models/BaseMongoEntity";

@Entity({ name: "latest_tracked" })
@TrackChanges()
class Tracked extends BaseMongoEntity {
    @Column()
    public status: string = "";
}

@Entity({ name: "latest_limited" })
@TrackChanges(3)
class Limited extends BaseMongoEntity {
    @Column()
    public status: string = "";
}

@Entity({ name: "latest_zero" })
@TrackChanges(0)
class Zero extends BaseMongoEntity {
    @Column()
    public status: string = "";
}

@Entity({ name: "latest_plain" })
class Plain extends BaseMongoEntity {
    @Column()
    public status: string = "";
}

const mongod: MongoMemoryServer = new MongoMemoryServer({ instance: { port: 9999 } });

describe("MongoSchemaSync latest marker Tests", () => {
    let client: MongoClient;
    let db: Db;
    let sync: MongoSchemaSync;

    beforeAll(async () => {
        await mongod.start();
        client = new MongoClient(mongod.getUri());
        await client.connect();
        db = client.db("latest-marker");
        sync = new MongoSchemaSync(db, { debug: vi.fn(), info: vi.fn(), error: vi.fn() });
    });

    afterAll(async () => {
        await client.close();
        await mongod.stop();
    });

    const indexNames = async (collection: string): Promise<string[]> =>
        (await db.collection(collection).listIndexes().toArray()).map((index) => index.name as string);

    it("creates a { uid, latest } index for a tracked model, with or without a version limit, and only then", async () => {
        await sync.synchronize([Tracked, Limited, Zero, Plain]);

        expect(await indexNames("latest_tracked")).toContain("uid_latest");
        expect(await indexNames("latest_limited")).toContain("uid_latest");
        // @TrackChanges(0) is untracked, like a model without the decorator.
        expect(await indexNames("latest_zero")).not.toContain("uid_latest");
        expect(await indexNames("latest_plain")).not.toContain("uid_latest");
    });

    it("backfills documents that have no marker, newest version of each uid current, and only once", async () => {
        const collection = db.collection("latest_tracked");
        await collection.deleteMany({});
        const docs: any[] = [];
        // Three versions of "a" (inserted out of order), two of "b", one of "c": none has a marker.
        for (const [uid, version] of [
            ["a", 1],
            ["a", 2],
            ["a", 0],
            ["b", 0],
            ["b", 1],
            ["c", 0],
        ] as [string, number][]) {
            docs.push({ uid, version, status: `${uid}${version}` });
        }
        await collection.insertMany(docs);

        await sync.synchronize([Tracked]);

        const current = (await collection.find({ latest: true }).toArray()).map((doc) => `${doc.uid}${doc.version}`);
        expect(current.sort()).toEqual(["a2", "b1", "c0"]);
        expect(await collection.countDocuments({ latest: false })).toBe(3);
        expect(await collection.countDocuments({ latest: { $exists: false } })).toBe(0);

        // Idempotent: nothing is rewritten the second time.
        expect(await sync.backfillLatest(collection)).toBe(0);
        await sync.synchronize([Tracked]);
        expect(await collection.countDocuments({ latest: true })).toBe(3);
    });

    it("repairs a collection an older instance wrote to: a new version without a marker, two current versions", async () => {
        const collection = db.collection("latest_tracked");
        await collection.deleteMany({});
        await collection.insertMany([
            { uid: "r", version: 0, status: "v0", latest: true },
            { uid: "r", version: 1, status: "v1", latest: true },
            { uid: "r", version: 2, status: "v2" },
            { uid: "s", version: 0, status: "v0", latest: true },
        ] as any[]);

        expect(await sync.backfillLatest(collection)).toBe(3);

        const current = (await collection.find({ latest: true }).toArray()).map((doc) => `${doc.uid}${doc.version}`);
        expect(current.sort()).toEqual(["r2", "s0"]);
    });

    it("writes the backfill in batches", async () => {
        const collection = db.collection("latest_tracked");
        await collection.deleteMany({});
        await collection.insertMany(
            Array.from({ length: 2300 }, (_value, i) => ({ uid: `u${i}`, version: 0, status: "x" })),
        );

        expect(await sync.backfillLatest(collection)).toBe(2300);
        expect(await collection.countDocuments({ latest: true })).toBe(2300);
    });

    it("does nothing for an empty collection", async () => {
        const collection = db.collection("latest_tracked");
        await collection.deleteMany({});
        expect(await sync.backfillLatest(collection)).toBe(0);
    });

    it("leaves the documents of an untracked model alone", async () => {
        const collection = db.collection("latest_plain");
        await collection.insertOne({ uid: "p", version: 0, status: "x" });
        await sync.synchronize([Plain, Zero]);
        expect(await collection.countDocuments({ latest: { $exists: true } })).toBe(0);
    });
});
