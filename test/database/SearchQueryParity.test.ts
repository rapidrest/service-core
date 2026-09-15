///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Runs the same search queries through `ModelUtils.buildSearchQuery()` against a real MongoDB and a real SQLite
// database holding identical rows, and requires both backends to return the same records. Covers `$or`/`$and`
// AND semantics (a forced scope key must survive a `$or` branch using the same key), verbatim `eq()`/`ne()`
// operands, `in()` comma escaping and `ModelUtils.literal()`.
import "reflect-metadata";
import * as typeorm from "typeorm";
import { MongoClient, type Db } from "mongodb";
import { MongoMemoryServer } from "mongodb-memory-server";
import { connect } from "../../src/database/TypeOrmSupport";
import { MongoRepository } from "../../src/database/MongoRepository";
import { Column, Entity } from "../../src/decorators/PersistenceDecorators";
import { ModelUtils } from "../../src/models/ModelUtils";

@Entity({ name: "parity_item" })
class ParityItem {
    @Column({ primary: true })
    public uid: string = "";

    @Column()
    public scope: string = "";

    @Column()
    public name: string = "";

    @Column({ type: "text", nullable: true })
    public tag: string | null = null;

    @Column()
    public n: number = 0;
}

const ROWS: Partial<ParityItem>[] = [
    { uid: "u1", scope: "mine", name: "Support(EU)", tag: "a,b", n: 1 },
    { uid: "u2", scope: "mine", name: "ne(x)", tag: "c", n: 5 },
    { uid: "u3", scope: "other", name: "Support(EU)", tag: "a,b", n: 1 },
    { uid: "u4", scope: "other", name: "plain", tag: "c", n: 10 },
    { uid: "u5", scope: "mine", name: " padded ", tag: "x\\y", n: 7 },
    { uid: "u6", scope: "mine", name: "line1\nline2", tag: null, n: 3 },
];

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: { port: 9999, dbName: "mongomemory-rrst-parity" },
});

vi.setConfig({ testTimeout: 60000 });
describe("Search query parity Tests [MongoDB vs SQL]", () => {
    let client: MongoClient;
    let db: Db;
    let mongoRepo: MongoRepository<any>;
    let dataSource: typeorm.DataSource;
    let sqlRepo: typeorm.Repository<ParityItem>;

    beforeAll(async () => {
        await mongod.start();
        client = new MongoClient(mongod.getUri());
        await client.connect();
        db = client.db("rrst-parity");
        const collection = db.collection("parity_item");
        await collection.deleteMany({});
        await collection.insertMany(ROWS.map((r) => ({ ...r })));
        mongoRepo = new MongoRepository(db, collection, ParityItem);

        dataSource = await connect(
            "search-query-parity",
            { type: "better-sqlite3", database: ":memory:", synchronize: true },
            [ParityItem],
            undefined as any,
        );
        sqlRepo = dataSource.getRepository(ParityItem);
        await sqlRepo.insert(ROWS);
    });

    afterAll(async () => {
        await dataSource?.destroy();
        await client?.close();
        await mongod.stop();
    });

    async function runMongo(query: any): Promise<string[]> {
        const built: any = ModelUtils.buildSearchQuery(ParityItem, mongoRepo, query, true);
        const docs: any[] = await mongoRepo.collection.find(built.$match).toArray();
        return docs.map((d) => d.uid).sort();
    }

    async function runSql(query: any): Promise<string[]> {
        const built: any = ModelUtils.buildSearchQuery(ParityItem, sqlRepo, query, true);
        const rows: ParityItem[] = await sqlRepo.find({ where: built.where });
        return rows.map((r) => r.uid).sort();
    }

    async function expectBoth(query: any, expected: string[]): Promise<void> {
        expect(await runMongo(query)).toEqual(expected);
        expect(await runSql(query)).toEqual(expected);
    }

    it("Keeps a forced scope key when a $or branch names the same key (no cross-scope leak).", async () => {
        await expectBoth({ scope: "mine", $or: [{ scope: "other" }] }, []);
        await expectBoth({ scope: "mine", $or: [{ scope: "other" }, { name: "eq(Support(EU))" }] }, ["u1"]);
    });

    it("Applies the same AND semantics to count and to the uid-only query truncate uses.", async () => {
        const query: any = { scope: "mine", $or: [{ scope: "other" }, { n: "gt(4)" }] };
        const mongoBuilt: any = ModelUtils.buildSearchQuery(ParityItem, mongoRepo, query, true);
        const sqlBuilt: any = ModelUtils.buildSearchQuery(ParityItem, sqlRepo, query, true);
        expect(await mongoRepo.count(mongoBuilt.$match)).toBe(2);
        expect(await sqlRepo.count(sqlBuilt)).toBe(2);
        const uidQuery: any = { ...sqlBuilt, select: { uid: true } };
        delete uidQuery.take;
        delete uidQuery.page;
        expect((await sqlRepo.find(uidQuery)).map((r) => r.uid).sort()).toEqual(["u2", "u5"]);
        expect((await mongoRepo.distinct("uid", mongoBuilt.$match)).sort()).toEqual(["u2", "u5"]);
    });

    it("Handles nested $or inside $and and colliding keys with different operators.", async () => {
        await expectBoth({ scope: "mine", $and: [{ $or: [{ n: "gt(4)" }, { tag: "c" }] }] }, ["u2", "u5"]);
        await expectBoth({ n: "gt(1)", $or: [{ n: "lt(6)" }] }, ["u2", "u6"]);
        await expectBoth({ n: "gte(1)", $and: [{ n: "lte(5)" }, { n: "ne(3)" }] }, ["u1", "u2", "u3"]);
    });

    it("Matches eq() operands verbatim, whatever characters they contain.", async () => {
        await expectBoth({ name: "eq(Support(EU))" }, ["u1", "u3"]);
        await expectBoth({ name: "eq(ne(x))" }, ["u2"]);
        await expectBoth({ name: "eq( padded )" }, ["u5"]);
        await expectBoth({ name: "eq(line1\nline2)" }, ["u6"]);
        await expectBoth({ tag: "eq(a,b)" }, ["u1", "u3"]);
        await expectBoth({ tag: "eq(x\\y)" }, ["u5"]);
        await expectBoth({ scope: "mine", name: "ne(Support(EU))" }, ["u2", "u5", "u6"]);
    });

    it("Splits in()/nin() on unescaped commas only.", async () => {
        await expectBoth({ tag: "in(a\\,b,c)" }, ["u1", "u2", "u3", "u4"]);
        await expectBoth({ tag: "in(x\\\\y)" }, ["u5"]);
        await expectBoth({ scope: "mine", name: "nin(Support(EU),ne(x))" }, ["u5", "u6"]);
    });

    it("Matches ModelUtils.literal() values exactly, with no operator parsing.", async () => {
        await expectBoth({ name: ModelUtils.literal("ne(x)") }, ["u2"]);
        await expectBoth({ scope: "mine", name: ModelUtils.literal("Support(EU)") }, ["u1"]);
        await expectBoth({ tag: ModelUtils.literal(["a,b", "x\\y"], "in") }, ["u1", "u3", "u5"]);
        await expectBoth({ scope: "mine", name: ModelUtils.literal("ne(x)", "ne") }, ["u1", "u5", "u6"]);
        await expectBoth({ tag: ModelUtils.literal(null) }, ["u6"]);
        await expectBoth({ n: ModelUtils.literal([3, 7], "range") }, ["u2", "u5", "u6"]);
    });

    it("Rejects the same malformed queries with a 400 on both backends.", async () => {
        for (const query of [{ name: "Support(EU)" }, { scope: "mine", $or: [] }, { $or: ["x"] }, { $where: "1" }]) {
            await expect(runMongo(query)).rejects.toMatchObject({ status: 400 });
            await expect(runSql(query)).rejects.toMatchObject({ status: 400 });
        }
    });
});
