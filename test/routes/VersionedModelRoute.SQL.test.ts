///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { request } from "../../src/test/request.js";
import { Server, ConnectionManager, ObjectFactory } from "../../src";
import VersionedItem from "../server/models/VersionedItem";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Repository, DataSource } from "typeorm";
import { Logger } from "@rapidrest/core";
import * as uuid from "uuid";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
let repo: Repository<VersionedItem>;

// VersionedItem has @TrackChanges() enabled, so each version is a distinct row sharing the same `uid` (version
// is promoted to part of the composite primary key for SQL - see TypeOrmSupport.ts). Rows are inserted directly
// here, one per version, rather than going through repoUtils.create()/update(), to mirror how
// VersionedModelRoute.Mongo.test.ts seeds its multi-version fixtures.
const createItem = async (name: string, cost: number = 100, versions: number = 1): Promise<VersionedItem[]> => {
    const results: VersionedItem[] = [];

    const uid: string = uuid.v4();
    for (let version = 0; version < versions; version++) {
        const item: VersionedItem = new VersionedItem({
            uid,
            name,
            cost: cost + version,
            version,
        });

        results.push(await repo.save(item));
    }

    return results;
};

vi.setConfig({ testTimeout: 120000 });
describe("VersionedModelRoute Tests [SQL]", () => {
    const baseUrl: string = "/versioneditems";
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", objectFactory });

    beforeAll(async () => {
        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("sqlite");
        if (conn instanceof DataSource) {
            repo = conn.getRepository(VersionedItem.name);
        }
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        await repo.clear();
    });

    describe("Single Document Tests [SQL]", () => {
        it("Can create additional version of same document. [SQL]", async () => {
            const [item]: VersionedItem[] = await createItem("Sword", 100);
            const itemV2: VersionedItem = new VersionedItem({
                uid: item.uid,
                name: "Sword",
                cost: 150,
            });

            const result = await request(server).post(baseUrl).send(itemV2);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(item.uid);
            expect(result.body.version).toEqual(item.version + 1);
            expect(result.body.cost).toEqual(itemV2.cost);

            const rows: VersionedItem[] = await repo.find({ where: { uid: item.uid } });
            expect(rows).toHaveLength(2);
        });

        it("Can delete document with a single version. [SQL]", async () => {
            const [item]: VersionedItem[] = await createItem("Sword", 100);
            const result = await request(server).delete(`${baseUrl}/${item.uid}`);
            expect(result.status).toBe(204);

            const count: number = await repo.count({ where: { uid: item.uid } });
            expect(count).toBe(0);
        });

        it("Can delete document with multiple versions (all versions removed). [SQL]", async () => {
            const items: VersionedItem[] = await createItem("Sword", 100, 4);
            const result = await request(server).delete(`${baseUrl}/${items[0].uid}`);
            expect(result.status).toBe(204);

            const count: number = await repo.count({ where: { uid: items[0].uid } });
            expect(count).toBe(0);
        });

        it("Can delete document with specific version (only that version removed). [SQL]", async () => {
            const items: VersionedItem[] = await createItem("Sword", 100, 4);
            const result = await request(server).delete(`${baseUrl}/${items[0].uid}?version=2`);
            expect(result.status).toBe(204);

            const count: number = await repo.count({ where: { uid: items[0].uid } });
            expect(count).toBe(3);

            const deletedVersion: VersionedItem | null = await repo.findOne({
                where: { uid: items[0].uid, version: 2 },
            });
            expect(deletedVersion).toBeNull();
        });

        it("Can find document by id (latest version). [SQL]", async () => {
            const items: VersionedItem[] = await createItem("Sword", 100, 3);
            const result = await request(server).get(`${baseUrl}/${items[0].uid}`).send();
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(items[0].uid);
            expect(result.body.version).toEqual(items[2].version);
            expect(result.body.cost).toEqual(items[2].cost);
        });

        it("Can find document by id and version. [SQL]", async () => {
            const items: VersionedItem[] = await createItem("Sword", 100, 5);
            const result = await request(server).get(`${baseUrl}/${items[2].uid}?version=${items[2].version}`).send();
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(items[2].uid);
            expect(result.body.version).toEqual(items[2].version);
            expect(result.body.cost).toEqual(items[2].cost);
        });

        it("Can test if document exists (latest version). [SQL]", async () => {
            const items: VersionedItem[] = await createItem("Sword", 100, 3);
            const result = await request(server).head(`${baseUrl}/${items[0].uid}`).send();
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can test if a specific existing version exists. [SQL]", async () => {
            const items: VersionedItem[] = await createItem("Sword", 100, 5);
            const result = await request(server).head(`${baseUrl}/${items[2].uid}?version=${items[2].version}`).send();
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Cannot test if a non-existent version exists, even though the id itself exists. [SQL]", async () => {
            // Regression test: exists() must scope its match by version, not just by id - otherwise a
            // request for a version that was never created (or already deleted) would incorrectly report
            // the record as existing just because *some* version of that uid is present.
            const items: VersionedItem[] = await createItem("Sword", 100, 3);
            const result = await request(server).head(`${baseUrl}/${items[0].uid}?version=999`).send();
            expect(result.status).toBe(404);
        });

        it("Can test if document doesn't exist. [SQL]", async () => {
            const result = await request(server).head(`${baseUrl}/${uuid.v4()}`).send();
            expect(result.status).toBe(404);
        });
    });

    describe("Multiple Document Tests [SQL]", () => {
        it("Can count documents. [SQL]", async () => {
            await createItem("Sword", 100);
            await createItem("Shield", 50);
            const result = await request(server).head(baseUrl);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((2).toString());
        });

        // NOTE: `buildSearchQueryMongo()` collapses a trackChanges entity's rows down to the latest version per
        // uid via an aggregation pipeline (`$sort` + `$group` + `$replaceRoot` - see ModelUtils.ts), so
        // `VersionedModelRoute.Mongo.test.ts`'s equivalent "with multiple versions" count/find tests only ever
        // see one row per uid. `buildSearchQuerySQL()` has no equivalent dedup step, so count()/find() over SQL
        // currently return every historical version row rather than just the latest - a known SQL/Mongo parity
        // gap, distinct from the doExists()/findOne() version-scoping this file otherwise covers. These tests
        // document that actual (not ideal) behavior rather than asserting the Mongo-equivalent result.
        it("Counts every version row for a trackChanges entity, not just the latest (known SQL/Mongo gap). [SQL]", async () => {
            await createItem("Sword", 100, 3);
            await createItem("Shield", 50, 2);
            const result = await request(server).head(baseUrl);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((5).toString());
        });

        it("Finds every version row for a trackChanges entity, not just the latest (known SQL/Mongo gap). [SQL]", async () => {
            await createItem("Sword", 100, 3);
            await createItem("Shield", 50, 2);
            const result = await request(server).get(baseUrl);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(5);
        });
    });
});
