///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Covers RepoUtils' SQL/TypeORM write paths that ModelRoute.SQL.test.ts's plain (non-trackChanges) Item
// fixture never exercises: create()/update() against a @TrackChanges()-enabled SQL entity, which takes a
// structurally different code path (this.repo.insert() with a composite (uid, version) primary key,
// instead of this.repo.update() against a single uid-keyed row).
import { default as config } from "./config";
import { Server, ObjectFactory } from "../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Logger } from "@rapidrest/core";
import * as uuid from "uuid";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});

vi.setConfig({ testTimeout: 60000 });
describe("RepoUtils Tests [SQL, trackChanges]", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", objectFactory });
    let repoUtils: any;

    beforeAll(async () => {
        await mongod.start();
        await server.start();
        const route: any = objectFactory.getInstance("routes.VersionedItemRoute");
        repoUtils = route.repoUtils;
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    it("inserts a new row per version instead of updating in place, via the SQL trackChanges path", async () => {
        const created = await repoUtils.create({ name: "sword-" + uuid.v4(), cost: 10 }, { ignoreACL: true });
        expect(created.version).toBe(0);

        const updated = await repoUtils.update({ ...created, cost: 20, version: created.version }, created, {
            ignoreACL: true,
        });
        expect(updated.version).toBe(created.version + 1);
        expect(updated.cost).toBe(20);

        const rows = await repoUtils.repo.find({ where: { uid: created.uid } });
        expect(rows.length).toBe(2);
        const oldRow = rows.find((r: any) => r.version === created.version);
        const newRow = rows.find((r: any) => r.version === updated.version);
        expect(oldRow?.cost).toBe(10); // old version preserved unchanged, not overwritten
        expect(newRow?.cost).toBe(20);
    });

    it("rejects an update whose supplied version does not match the existing row (optimistic locking still applies)", async () => {
        const created = await repoUtils.create({ name: "shield-" + uuid.v4(), cost: 5 }, { ignoreACL: true });
        await expect(
            repoUtils.update({ ...created, cost: 99, version: created.version + 1 }, created, { ignoreACL: true }),
        ).rejects.toThrow();
    });
});
