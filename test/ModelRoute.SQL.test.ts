///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { default as config } from "./config.js";
import * as request from "supertest";
import { Server, ConnectionManager, ObjectFactory } from "../src/index.js";
import Item from "./server/models/Item.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as sqlite3 from "sqlite3";
import { Repository, DataSource } from "typeorm";
import { Logger } from "@rapidrest/core";

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

describe("ModelRoute Tests [SQL]", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server(config, "./test/server", Logger(), objectFactory);

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
            const result = await request(server.getApplication()).post("/items").send(item);
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
            const result = await request(server.getApplication()).delete("/items/" + item.uid);
            expect(result.status).toBe(204);

            const existing: Item | null = await repo.findOne({ where: { uid: item.uid } });
            expect(existing).toBeNull();
        });

        it("Can find document by id. [SQL]", async () => {
            const item: Item = await createItem("BFG", 1, 100000);
            const result = await request(server.getApplication())
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
            const result = await request(server.getApplication())
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
    });

    describe("Multiple Document Tests [SQL]", () => {
        it("Can count documents. [SQL]", async () => {
            const items: Item[] = await createItems(20);
            const result = await request(server.getApplication()).head("/items");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(items.length.toString());
        });

        it("Can count documents with criteria (eq). [SQL]", async () => {
            const items: Item[] = await createItems(15);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server.getApplication()).head("/items?name=B-Bomb");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can count documents with criteria (like). [SQL]", async () => {
            const items: Item[] = await createItems(15);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server.getApplication()).head("/items?name=like(Item%)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(items.length.toString());
        });

        it("Can find all documents. [SQL]", async () => {
            const items: Item[] = await createItems(25);
            const result = await request(server.getApplication()).get("/items");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(items.length);
        });

        it("Can find documents with criteria (eq) [SQL].", async () => {
            const items: Item[] = await createItems(13);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server.getApplication()).get("/items?name=BFG");
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
            const result = await request(server.getApplication()).get("/items?name=like(Item%)");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(items.length);
            for (const item of result.body) {
                expect(item.name).toContain("Item");
            }
        });

        it("Can truncate datastore [SQL].", async () => {
            const items: Item[] = await createItems(25);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server.getApplication()).delete("/items");
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(0);
        });

        it("Can truncate datastore with criteria (in) [SQL].", async () => {
            const items: Item[] = await createItems(13);
            await createItem("BFG", 1, 10000);
            await createItem("B-Bomb", 5, 50);
            await createItem("Boomerang", 1, 100);
            const result = await request(server.getApplication()).delete("/items?name=in(BFG,B-Bomb,Boomerang)");
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(items.length);
        });
    });
});
