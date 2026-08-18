///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { request } from "../../src/test/request.js";
import { Server, ConnectionManager, ObjectFactory } from "../../src";
import Item from "../server/models/Item";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as sqlite3 from "sqlite3";
import { Repository, DataSource } from "typeorm";
import { Logger } from "@rapidrest/core";
import * as uuid from "uuid";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
let repo: Repository<Item>;
const sqlite: sqlite3.Database = new sqlite3.Database(":memory:");

const createItem = async (name: string, quantity: number = 1, cost: number = 100): Promise<Item> => {
    const item: Item = new Item({
        name,
        quantity,
        cost,
    });

    return await repo.save(item);
};

const createItems = async (num: number): Promise<Item[]> => {
    const results: Item[] = [];

    for (let i = 1; i <= num; i++) {
        results.push(await createItem("Item" + i, 1, 10 * i));
    }

    return results;
};

vi.setConfig({ testTimeout: 120000 });
describe("ModelRoute Tests [SQL]", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", objectFactory });

    beforeAll(async () => {
        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("sqlite");
        if (conn instanceof DataSource) {
            repo = conn.getRepository(Item.name);
        }
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        await objectFactory.destroy();
        return await new Promise<void>((resolve) => {
            sqlite.close((err) => {
                if (err) {
                    console.log(err);
                }
                resolve();
            });
        });
    });

    beforeEach(async () => {
        await repo.clear();
    });

    describe("Single Document Tests [SQL]", () => {
        it("Can create document.", async () => {
            const item: Item = new Item({
                name: "BFG",
                quantity: 1,
                cost: 10000,
            });
            const result = await request(server).post("/items").send(item);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(item.uid);
            expect(result.body.version).toEqual(item.version);
            expect(result.body.name).toEqual(item.name);
            expect(result.body.quantity).toEqual(item.quantity);
            expect(result.body.cost).toEqual(item.cost);

            const stored: Item | null = await repo.findOne({ where: { uid: result.body.uid } });
            expect(stored).toBeDefined();
            if (stored) {
                expect(stored.uid).toEqual(item.uid);
                expect(stored.version).toEqual(item.version);
                expect(stored.name).toEqual(item.name);
                expect(stored.quantity).toEqual(item.quantity);
                expect(stored.cost).toEqual(item.cost);
            }
        });

        it("Can delete document. [SQL]", async () => {
            const item: Item = await createItem("BFG", 1, 10000);
            const result = await request(server).delete("/items/" + item.uid);
            expect(result.status).toBe(204);

            const existing: Item | null = await repo.findOne({ where: { uid: item.uid } });
            expect(existing).toBeNull();
        });

        it("Can find document by id. [SQL]", async () => {
            const item: Item = await createItem("BFG", 1, 100000);
            const result = await request(server)
                .get("/items/" + item.uid)
                .send();
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(item.uid);
            expect(result.body.version).toEqual(item.version);
            expect(result.body.name).toEqual(item.name);
            expect(result.body.quantity).toEqual(item.quantity);
            expect(result.body.cost).toEqual(item.cost);
        });

        it("Can update document. [SQL]", async () => {
            const item: Item = await createItem("BFG", 1, 100000);
            item.name = "B-Bomb";
            item.quantity = 5;
            item.cost = 50;
            const result = await request(server)
                .put("/items/" + item.uid)
                .send(item);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(item.uid);
            expect(result.body.version).toBeGreaterThan(item.version);
            expect(result.body.name).toBe(item.name);
            expect(result.body.quantity).toBe(item.quantity);
            expect(result.body.cost).toBe(item.cost);

            const existing: Item | null = await repo.findOne({ where: { uid: item.uid } });
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(result.body.uid);
                expect(existing.version).toBe(result.body.version);
                expect(existing.name).toBe(result.body.name);
                expect(existing.quantity).toBe(result.body.quantity);
                expect(existing.cost).toBe(result.body.cost);
            }
        });

        it("Can update document property. [SQL]", async () => {
            const item: Item = await createItem("BFG", 1, 10000);
            const result = await request(server).put(`/items/${item.uid}/cost`).send(50000);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toBe(item.uid);
            expect(result.body.cost).toBe(50000);
            expect(result.body.name).toBe(item.name);
            expect(result.body.quantity).toBe(item.quantity);

            const existing: Item | null = await repo.findOne({ where: { uid: item.uid } });
            expect(existing).toBeDefined();
            expect(existing?.cost).toBe(50000);
        });

        it("Can test if document exists. [SQL]", async () => {
            const item: Item = await createItem("BFG", 1, 10000);
            const result = await request(server)
                .head("/items/" + item.uid)
                .send();
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can test if document exists by alternate identifier. [SQL]", async () => {
            const item: Item = await createItem("BFG", 1, 10000);
            const result = await request(server)
                .head("/items/" + item.name)
                .send();
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can test if document doesn't exist. [SQL]", async () => {
            const result = await request(server)
                .head("/items/" + uuid.v4())
                .send();
            expect(result.status).toBe(404);
        });
    });

    describe("Multiple Document Tests [SQL]", () => {
        it("Can count documents. [SQL]", async () => {
            const items: Item[] = await createItems(20);
            const result = await request(server).head("/items");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(items.length.toString());
        });

        it("Can count documents with criteria (eq). [SQL]", async () => {
            const items: Item[] = await createItems(15);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?name=B-Bomb");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can count documents with criteria (like). [SQL]", async () => {
            const items: Item[] = await createItems(15);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?name=like(Item%)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(items.length.toString());
        });

        it("Can count documents with criteria (ne). [SQL]", async () => {
            const items: Item[] = await createItems(13);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?quantity=ne(1)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can count documents with criteria (in). [SQL]", async () => {
            const items: Item[] = await createItems(13);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?quantity=in(1,5)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((items.length + 3).toString());
        });

        it("Can count documents with criteria (nin). [SQL]", async () => {
            const items: Item[] = await createItems(13);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?quantity=nin(1,5)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((0).toString());
        });

        it("Can count documents with criteria (gt). [SQL]", async () => {
            await createItems(13); // costs 10, 20, ..., 130
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?cost=gt(100)");
            expect(result.headers).toHaveProperty("content-length");
            // Item11, Item12, Item13 (110, 120, 130) + BFG (10000)
            expect(result.headers["content-length"]).toBe((4).toString());
        });

        it("Can count documents with criteria (gte). [SQL]", async () => {
            await createItems(13); // costs 10, 20, ..., 130
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?cost=gte(100)");
            expect(result.headers).toHaveProperty("content-length");
            // Item10, Item11, Item12, Item13 (100, 110, 120, 130) + BFG (10000) + Boomerang (100)
            expect(result.headers["content-length"]).toBe((6).toString());
        });

        it("Can count documents with criteria (lt). [SQL]", async () => {
            await createItems(13); // costs 10, 20, ..., 130
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?cost=lt(100)");
            expect(result.headers).toHaveProperty("content-length");
            // Item1 .. Item9 (10..90) + B-Bomb (50)
            expect(result.headers["content-length"]).toBe((10).toString());
        });

        it("Can count documents with criteria (lte). [SQL]", async () => {
            await createItems(13); // costs 10, 20, ..., 130
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?cost=lte(100)");
            expect(result.headers).toHaveProperty("content-length");
            // Item1 .. Item10 (10..100) + B-Bomb (50) + Boomerang (100)
            expect(result.headers["content-length"]).toBe((12).toString());
        });

        it("Can count documents with criteria (range). [SQL]", async () => {
            await createItems(13); // costs 10, 20, ..., 130
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).head("/items?cost=range(50,120)");
            expect(result.headers).toHaveProperty("content-length");
            // Item5 .. Item12 (50..120) + B-Bomb (50) + Boomerang (100)
            expect(result.headers["content-length"]).toBe((10).toString());
        });

        it("Can find all documents. [SQL]", async () => {
            const items: Item[] = await createItems(25);
            const result = await request(server).get("/items");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(items.length);
        });

        it("Can find all documents with pagination. [SQL]", async () => {
            const items: Item[] = await createItems(25);
            let result = await request(server).get("/items?limit=5&page=0");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(5);
            for (let i = 0; i < result.body.length; i++) {
                expect(result.body[i].uid).toEqual(items[i].uid);
            }

            result = await request(server).get("/items?limit=5&page=1");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(5);
            for (let i = 0; i < result.body.length; i++) {
                expect(result.body[i].uid).toEqual(items[i + 5].uid);
            }

            result = await request(server).get("/items?limit=10&page=1");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(10);
            for (let i = 0; i < result.body.length; i++) {
                expect(result.body[i].uid).toEqual(items[i + 10].uid);
            }
        });

        it("Can find documents with criteria (eq) [SQL].", async () => {
            const items: Item[] = await createItems(13);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).get("/items?name=BFG");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(1);
            for (const item of result.body) {
                expect(item.name).toContain("BFG");
            }
        });

        it("Can find documents with criteria (like) [SQL].", async () => {
            const items: Item[] = await createItems(13);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).get("/items?name=like(Item%)");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(items.length);
            for (const item of result.body) {
                expect(item.name).toContain("Item");
            }
        });

        it("Can truncate datasource [SQL].", async () => {
            const items: Item[] = await createItems(25);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).delete("/items");
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(0);
        });

        it("Can truncate datasource with criteria (in) [SQL].", async () => {
            const items: Item[] = await createItems(13);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server).delete("/items?name=in(BFG,B-Bomb,Boomerang)");
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(items.length);
        });

        it("Can create documents in bulk. [SQL]", async () => {
            const items: Item[] = [
                new Item({ name: "BFG", quantity: 1, cost: 10000 }),
                new Item({ name: "B-Bomb", quantity: 5, cost: 50 }),
                new Item({ name: "Boomerang", quantity: 1, cost: 100 }),
            ];
            const result = await request(server).post("/items").send(items);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(items.length);

            const count: number = await repo.count();
            expect(count).toBe(items.length);
        });

        it("Cannot create documents in bulk with same name. [SQL]", async () => {
            const items: Item[] = [
                new Item({ name: "BFG", quantity: 1, cost: 10000 }),
                new Item({ name: "BFG", quantity: 2, cost: 20000 }),
                new Item({ name: "BFG", quantity: 3, cost: 30000 }),
            ];
            const result = await request(server).post("/items").send(items);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(items.length);
            expect(result.body[0]).toBeNull();
            for (let i = 1; i < result.body.length; i++) {
                expect(result.body[i].status).toBe(400);
            }

            const count: number = await repo.count();
            expect(count).toBe(1);
        });

        it("Can update documents in bulk. [SQL].", async () => {
            const items: Item[] = await createItems(3);
            const updates: any[] = items.map((item) => ({
                uid: item.uid,
                version: item.version,
                cost: item.cost + 1000,
            }));

            const result = await request(server).put("/items").send(updates);
            expect(result.status).toBe(200);

            for (const item of items) {
                const existing: Item | null = await repo.findOne({
                    where: { uid: item.uid },
                    order: { version: "DESC" },
                });
                expect(existing).toBeDefined();
                expect(existing?.cost).toBe(item.cost + 1000);
                expect(existing?.name).toBe(item.name);
                expect(existing?.version).toBeGreaterThan(item.version);
            }
        });
    });
});
