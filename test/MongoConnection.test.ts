///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { MongoConnection } from "../src/database/MongoConnection";
import { MongoRepository } from "../src/database/MongoRepository";
import { MongoSchemaSync } from "../src/database/MongoSchemaSync";
import { isSqlDataSource } from "../src/database/ConnectionKinds";
import { Column, Index, PrimaryColumn, Unique } from "../src/decorators/PersistenceDecorators";
import { ChildEntity, DataStore } from "../src/decorators/ModelDecorators";

@DataStore("testdb")
class Widget {
    @Index("uid", { unique: true })
    @PrimaryColumn()
    public uid: string = "";

    @Index()
    @Column()
    public name: string = "";

    @Column()
    public size: number = 0;

    constructor(other?: Partial<Widget>) {
        if (other) {
            this.uid = other.uid ?? this.uid;
            this.name = other.name ?? this.name;
            this.size = other.size ?? this.size;
        }
    }
}

@ChildEntity()
class SuperWidget extends Widget {
    @Column()
    public power: number = 9000;
}

@DataStore("testdb")
@Index(["category", "rank"], { unique: true })
class Gadget {
    @Unique("serial")
    @Column()
    public serial: string = "";

    @Column()
    public category: string = "";

    @Column()
    public rank: number = 0;
}

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9998,
    },
});

vi.setConfig({ testTimeout: 60000 });
describe("MongoConnection Tests", () => {
    let client: MongoClient;
    let conn: MongoConnection;

    beforeAll(async () => {
        await mongod.start();
        client = new MongoClient("mongodb://localhost:9998/native_test");
        await client.connect();
        conn = new MongoConnection("testdb", client, client.db("native_test"), [Widget, SuperWidget, Gadget]);
    });

    afterAll(async () => {
        await conn.close();
        await mongod.stop();
    });

    describe("MongoConnection", () => {
        it("resolves repositories by class and by name", () => {
            const byClass = conn.getRepository(Widget);
            const byName = conn.getRepository("Widget");
            expect(byClass).toBeInstanceOf(MongoRepository);
            expect(byClass).toBe(byName);
            expect(byClass.collectionName).toBe("widget");
        });

        it("resolves child entities to the parent collection", () => {
            const repo = conn.getRepository(SuperWidget);
            expect(repo.collectionName).toBe("widget");
        });

        it("throws for unregistered entity names", () => {
            expect(() => conn.getRepository("Nope")).toThrow(/No entity named 'Nope'/);
        });

        it("provides getMongoRepository as an alias", () => {
            expect(conn.getMongoRepository(Widget)).toBe(conn.getRepository(Widget));
        });

        it("is not detected as a SQL DataSource", () => {
            expect(isSqlDataSource(conn)).toBe(false);
            expect(isSqlDataSource({ getRepository: () => undefined })).toBe(true);
            expect(isSqlDataSource(undefined)).toBe(false);
        });
    });

    describe("MongoRepository", () => {
        let repo: MongoRepository<Widget>;

        beforeAll(() => {
            repo = conn.getRepository(Widget);
        });

        beforeEach(async () => {
            await repo.clear();
        });

        it("saves new documents and assigns _id", async () => {
            const widget: any = new Widget({ uid: "w1", name: "first", size: 10 });
            const saved: any = await repo.save(widget);
            expect(saved._id).toBeDefined();
            expect(saved.uid).toBe("w1");
            expect(await repo.count()).toBe(1);
        });

        it("replaces documents with an existing _id", async () => {
            const widget: any = await repo.save(new Widget({ uid: "w1", name: "first", size: 10 }));
            widget.name = "updated";
            await repo.save(widget);
            expect(await repo.count()).toBe(1);
            const found: any = await repo.findOne({ uid: "w1" });
            expect(found.name).toBe("updated");
        });

        it("omits undefined properties from saved documents", async () => {
            const widget: any = new Widget({ uid: "w1", name: "first", size: 10 });
            widget.extra = undefined;
            await repo.save(widget);
            const found: any = await repo.findOne({ uid: "w1" });
            expect("extra" in found).toBe(false);
        });

        it("persists child entity instances with their _type", async () => {
            const sw: any = await repo.save(new SuperWidget({ uid: "sw1", name: "super" }));
            expect(sw._id).toBeDefined();
            const found: any = await repo.findOne({ uid: "sw1" });
            expect(found._type).toBe("SuperWidget");
            expect(found.power).toBe(9000);
        });

        it("supports find, findOne, count and distinct", async () => {
            await repo.save(new Widget({ uid: "w1", name: "a", size: 1 }));
            await repo.save(new Widget({ uid: "w2", name: "b", size: 2 }));
            await repo.save(new Widget({ uid: "w3", name: "b", size: 3 }));

            expect((await repo.find().toArray()).length).toBe(3);
            expect((await repo.find({ name: "b" }).toArray()).length).toBe(2);
            expect((await repo.findOne({ uid: "w2" }))?.size).toBe(2);
            expect(await repo.count({ name: "b" })).toBe(2);
            expect((await repo.distinct("name")).sort()).toEqual(["a", "b"]);
            expect(await repo.distinct("uid", { name: "b" })).toEqual(["w2", "w3"]);
        });

        it("supports aggregation with cursor skip/limit/next/toArray", async () => {
            for (let i = 1; i <= 5; i++) {
                await repo.save(new Widget({ uid: `w${i}`, name: `widget-${i}`, size: i }));
            }

            const results: any[] = await repo
                .aggregate([{ $match: {} }, { $sort: { size: 1 } }])
                .skip(1)
                .limit(2)
                .toArray();
            expect(results.length).toBe(2);
            expect(results[0].size).toBe(2);

            const single: any = await repo.aggregate([{ $match: { uid: "w4" } }]).next();
            expect(single?.size).toBe(4);

            const counted: any = await repo.aggregate([{ $match: {} }, { $count: "count" }]).next();
            expect(counted.count).toBe(5);
        });

        it("supports updateOne, updateMany, deleteOne and deleteMany", async () => {
            await repo.save(new Widget({ uid: "w1", name: "a", size: 1 }));
            await repo.save(new Widget({ uid: "w2", name: "a", size: 2 }));
            await repo.save(new Widget({ uid: "w3", name: "b", size: 3 }));

            await repo.updateOne({ uid: "w1" }, { $set: { size: 100 } });
            expect((await repo.findOne({ uid: "w1" }))?.size).toBe(100);

            await repo.updateMany({ name: "a" }, { $set: { size: 0 } });
            expect(await repo.count({ size: 0 })).toBe(2);

            await repo.deleteOne({ uid: "w1" });
            expect(await repo.count()).toBe(2);

            await repo.deleteMany({ name: { $in: ["a", "b"] } });
            expect(await repo.count()).toBe(0);
        });

        it("clear() tolerates missing collections", async () => {
            await repo.clear();
            await expect(repo.clear()).resolves.toBeUndefined();
        });
    });

    describe("MongoSchemaSync", () => {
        const dropAll = async (name: string) => {
            try {
                await conn.db.collection(name).drop();
            } catch (err) {
                // ignore
            }
        };

        beforeEach(async () => {
            await dropAll("widget");
            await dropAll("gadget");
        });

        it("creates collections and declared indexes", async () => {
            const sync = new MongoSchemaSync(conn.db);
            await sync.synchronize([Widget, SuperWidget, Gadget]);

            const collections = (await conn.db.listCollections().toArray()).map((c) => c.name);
            expect(collections).toContain("widget");
            expect(collections).toContain("gadget");
            // SuperWidget shares the widget collection
            expect(collections).not.toContain("super_widget");

            const widgetIndexes = await conn.db.collection("widget").listIndexes().toArray();
            const uid = widgetIndexes.find((i) => i.name === "uid");
            expect(uid).toBeDefined();
            expect(uid?.unique).toBe(true);
            expect(widgetIndexes.find((i) => JSON.stringify(i.key) === JSON.stringify({ name: 1 }))).toBeDefined();

            const gadgetIndexes = await conn.db.collection("gadget").listIndexes().toArray();
            const serial = gadgetIndexes.find((i) => i.name === "serial");
            expect(serial?.unique).toBe(true);
            const compound = gadgetIndexes.find((i) => JSON.stringify(i.key) === JSON.stringify({ category: 1, rank: 1 }));
            expect(compound).toBeDefined();
            expect(compound?.unique).toBe(true);
        });

        it("is idempotent", async () => {
            const sync = new MongoSchemaSync(conn.db);
            await sync.synchronize([Widget, Gadget]);
            const before = await conn.db.collection("widget").listIndexes().toArray();
            await sync.synchronize([Widget, Gadget]);
            const after = await conn.db.collection("widget").listIndexes().toArray();
            expect(after).toEqual(before);
        });

        it("re-creates indexes whose definition changed", async () => {
            // Simulate a pre-existing non-unique index where a unique one is now declared
            await conn.db.createCollection("widget");
            await conn.db.collection("widget").createIndex({ uid: 1 }, { name: "uid" });

            const sync = new MongoSchemaSync(conn.db);
            await sync.synchronize([Widget]);

            const indexes = await conn.db.collection("widget").listIndexes().toArray();
            const uid = indexes.find((i) => i.name === "uid");
            expect(uid?.unique).toBe(true);
        });

        it("keeps matching indexes with legacy names", async () => {
            // Simulate a TypeORM-created index with a hashed name but identical definition
            await conn.db.createCollection("widget");
            await conn.db.collection("widget").createIndex({ name: 1 }, { name: "IDX_legacy123" });

            const sync = new MongoSchemaSync(conn.db);
            await sync.synchronize([Widget]);

            const indexes = await conn.db.collection("widget").listIndexes().toArray();
            const named = indexes.filter((i) => JSON.stringify(i.key) === JSON.stringify({ name: 1 }));
            expect(named.length).toBe(1);
            expect(named[0].name).toBe("IDX_legacy123");
        });

        it("never drops undeclared indexes or _id_", async () => {
            await conn.db.createCollection("widget");
            await conn.db.collection("widget").createIndex({ somethingElse: 1 }, { name: "manual" });

            const sync = new MongoSchemaSync(conn.db);
            await sync.synchronize([Widget]);

            const indexes = await conn.db.collection("widget").listIndexes().toArray();
            expect(indexes.find((i) => i.name === "manual")).toBeDefined();
            expect(indexes.find((i) => i.name === "_id_")).toBeDefined();
        });
    });
});
