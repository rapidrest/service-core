///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// A @TrackChanges model stores one row/document per version. The write paths keep a `latest` marker on each record's
// current version, and every search, count, truncate and identifier lookup is restricted to those rows (unless the
// query filters on `version`). These tests run against real MongoDB and SQL (SQLite) datasources, through RepoUtils.
import "reflect-metadata";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Logger, type JWTUser } from "@rapidrest/core";
import config from "./config";
import { ObjectFactory } from "../src/ObjectFactory";
import { ConnectionManager } from "../src/database/ConnectionManager";
import { MongoConnection } from "../src/database/MongoConnection";
import { ModelUtils } from "../src/models/ModelUtils";
import { RepoUtils } from "../src/models/RepoUtils";
import { BaseEntity } from "../src/models/BaseEntity";
import { BaseMongoEntity } from "../src/models/BaseMongoEntity";
import { Column, Entity } from "../src/decorators/PersistenceDecorators";
import { DataStore, Identifier, Protect, TrackChanges } from "../src/decorators/ModelDecorators";
import { ACLUtils } from "../src/security/ACLUtils";
import { ACLAction } from "../src/security/AccessControlList";
import { DataSource } from "typeorm";

const CLASS_RECORDS = [
    { userOrRoleId: "anonymous", actions: [] },
    { userOrRoleId: ".*", actions: [ACLAction.CREATE, ACLAction.READ, ACLAction.LIST, ACLAction.COUNT] },
];

const fields = (other?: any) => ({
    slug: other && "slug" in other ? other.slug : "",
    status: other && "status" in other ? other.status : "",
});

@DataStore("mongodb")
@Entity({ name: "tc_mongo_doc" })
@TrackChanges()
class TcMongoDoc extends BaseMongoEntity {
    @Identifier
    @Column()
    public slug: string = "";

    @Column()
    public status: string = "";

    constructor(other?: any) {
        super(other);
        Object.assign(this, fields(other));
    }
}

@DataStore("mongodb")
@Entity({ name: "tc_mongo_acl_doc" })
@TrackChanges()
@Protect({ uid: "<ClassName>", records: CLASS_RECORDS }, true)
class TcMongoAclDoc extends BaseMongoEntity {
    @Column()
    public status: string = "";

    constructor(other?: any) {
        super(other);
        this.status = other && "status" in other ? other.status : this.status;
    }
}

@DataStore("mongodb")
@Entity({ name: "tc_mongo_zero" })
@TrackChanges(0)
class TcMongoZero extends BaseMongoEntity {
    @Column()
    public status: string = "";

    constructor(other?: any) {
        super(other);
        this.status = other && "status" in other ? other.status : this.status;
    }
}

@DataStore("sqlite")
@Entity({ name: "tc_sql_doc" })
@TrackChanges()
class TcSqlDoc extends BaseEntity {
    @Identifier
    @Column({ nullable: true })
    public slug: string = "";

    @Column({ nullable: true })
    public status: string = "";

    constructor(other?: any) {
        super(other);
        Object.assign(this, fields(other));
    }
}

@DataStore("sqlite")
@Entity({ name: "tc_sql_acl_doc" })
@TrackChanges()
@Protect({ uid: "<ClassName>", records: CLASS_RECORDS }, true)
class TcSqlAclDoc extends BaseEntity {
    @Column({ nullable: true })
    public status: string = "";

    constructor(other?: any) {
        super(other);
        this.status = other && "status" in other ? other.status : this.status;
    }
}

@DataStore("sqlite")
@Entity({ name: "tc_sql_zero" })
@TrackChanges(0)
class TcSqlZero extends BaseEntity {
    @Column({ nullable: true })
    public status: string = "";

    constructor(other?: any) {
        super(other);
        this.status = other && "status" in other ? other.status : this.status;
    }
}

const mongod: MongoMemoryServer = new MongoMemoryServer({ instance: { port: 9999 } });
const bob: JWTUser = { uid: "bob", roles: [] } as any;
const ignore = { ignoreACL: true, skipCache: true };

interface Backend {
    name: string;
    docs: () => RepoUtils<any>;
    aclDocs: () => RepoUtils<any>;
    zeros: () => RepoUtils<any>;
    /** Reads the stored rows of a record (every version, with the raw `latest` marker). */
    rows: (clazz: any, uid: string) => Promise<any[]>;
    clear: () => Promise<void>;
}

vi.setConfig({ testTimeout: 120000 });
describe("RepoUtils @TrackChanges latest marker [MongoDB + SQL]", () => {
    let objectFactory: ObjectFactory;
    let mongo: MongoConnection;
    let sql: DataSource;
    const utils: Record<string, RepoUtils<any>> = {};

    beforeAll(async () => {
        await mongod.start();
        objectFactory = new ObjectFactory(config, Logger());
        const connMgr: ConnectionManager = await objectFactory.newInstance(ConnectionManager, { name: "default" });

        const models: Map<string, any> = await ModelUtils.loadModels("./src/security");
        const classes = [TcMongoDoc, TcMongoAclDoc, TcMongoZero, TcSqlDoc, TcSqlAclDoc, TcSqlZero];
        for (const clazz of classes) {
            models.set(clazz.name, clazz);
        }
        const suffix: string = String(Date.now());
        await connMgr.connect(
            {
                acl: { type: "mongodb", url: `mongodb://localhost:9999/tc-acl-${suffix}`, synchronize: true },
                mongodb: { type: "mongodb", url: `mongodb://localhost:9999/tc-data-${suffix}`, synchronize: true },
                sqlite: { type: "better-sqlite3", host: "localhost", database: ":memory:", synchronize: true },
            },
            models,
        );
        mongo = connMgr.connections.get("mongodb") as MongoConnection;
        sql = connMgr.connections.get("sqlite") as DataSource;

        await objectFactory.newInstance(ACLUtils, { name: "default" });
        for (const clazz of classes) {
            utils[clazz.name] = await objectFactory.newInstance(RepoUtils, {
                name: clazz.name,
                initialize: true,
                args: [clazz],
            });
        }
    });

    afterAll(async () => {
        await objectFactory?.destroy();
        await mongod.stop();
    });

    const backends: Backend[] = [
        {
            name: "MongoDB",
            docs: () => utils.TcMongoDoc,
            aclDocs: () => utils.TcMongoAclDoc,
            zeros: () => utils.TcMongoZero,
            rows: async (clazz, uid) =>
                (await mongo.getRepository(clazz).find({ uid } as any).toArray()).sort((a, b) => a.version - b.version),
            clear: async () => {
                for (const clazz of [TcMongoDoc, TcMongoAclDoc, TcMongoZero]) {
                    await mongo.getRepository(clazz).deleteMany({} as any);
                }
            },
        },
        {
            name: "SQL",
            docs: () => utils.TcSqlDoc,
            aclDocs: () => utils.TcSqlAclDoc,
            zeros: () => utils.TcSqlZero,
            rows: async (clazz, uid) => await sql.getRepository(clazz).find({ where: { uid }, order: { version: "ASC" } }),
            clear: async () => {
                for (const clazz of [TcSqlDoc, TcSqlAclDoc, TcSqlZero]) {
                    await sql.getRepository(clazz).clear();
                }
            },
        },
    ];

    describe.each(backends)("$name", (backend) => {
        const docClass = () => (backend.name === "SQL" ? TcSqlDoc : TcMongoDoc);
        const aclClass = () => (backend.name === "SQL" ? TcSqlAclDoc : TcMongoAclDoc);
        const zeroClass = () => (backend.name === "SQL" ? TcSqlZero : TcMongoZero);
        const latestVersions = async (uid: string, clazz = docClass()): Promise<number[]> =>
            (await backend.rows(clazz, uid)).filter((row) => row.latest === true || row.latest === 1).map((row) => row.version);
        /** Creates a record, then updates it once per status in `statuses`. */
        const createRecord = async (utilsOf: RepoUtils<any>, slug: string, statuses: string[], options: any = ignore) => {
            let current: any = await utilsOf.create({ slug, status: statuses[0] }, options);
            for (const status of statuses.slice(1)) {
                current = await utilsOf.update({ ...current, status }, current, options);
            }
            return current;
        };

        beforeEach(async () => {
            await backend.clear();
        });

        it("marks exactly one row current after a create and after each update", async () => {
            const docs = backend.docs();
            const created = await docs.create({ slug: "a", status: "one" }, ignore);
            expect(await latestVersions(created.uid)).toEqual([0]);
            expect(created).not.toHaveProperty("latest");

            const v1 = await docs.update({ ...created, status: "two" }, created, ignore);
            expect(await latestVersions(created.uid)).toEqual([1]);
            await docs.update({ ...v1, status: "three" }, v1, ignore);
            expect(await latestVersions(created.uid)).toEqual([2]);
            expect(await backend.rows(docClass(), created.uid)).toHaveLength(3);
        });

        it("marks the newest version current when an existing record is created again under its uid", async () => {
            const docs = backend.docs();
            const created = await docs.create({ slug: "again", status: "one" }, ignore);
            const next = await docs.create({ uid: created.uid, slug: "again", status: "two" }, ignore);
            expect(next.version).toBe(1);
            expect(await latestVersions(created.uid)).toEqual([1]);
        });

        it("finds, counts and checks only the records whose current version matches", async () => {
            const docs = backend.docs();
            const a = await createRecord(docs, "a", ["pending", "approved"]);
            const b = await createRecord(docs, "b", ["pending"]);

            const pending = await docs.find({ status: "pending" }, ignore);
            expect(pending.map((r: any) => r.uid)).toEqual([b.uid]);
            expect(await docs.count({ status: "pending" }, ignore)).toBe(1);

            const approved = await docs.find({ status: "approved" }, ignore);
            expect(approved.map((r: any) => [r.uid, r.version])).toEqual([[a.uid, 1]]);
            expect(await docs.count({ status: "approved" }, ignore)).toBe(1);

            expect(await docs.find({}, ignore)).toHaveLength(2);
            expect(await docs.count({}, ignore)).toBe(2);
            for (const record of [...pending, ...approved]) {
                expect(record).not.toHaveProperty("latest");
            }
        });

        it("truncate keeps every version of a record whose current version doesn't match", async () => {
            const docs = backend.docs();
            const a = await createRecord(docs, "a", ["pending", "approved"]);
            const b = await createRecord(docs, "b", ["pending"]);

            await docs.truncate({ status: "pending" }, ignore);
            expect(await backend.rows(docClass(), b.uid)).toHaveLength(0);
            expect(await backend.rows(docClass(), a.uid)).toHaveLength(2);

            await docs.truncate({ status: "approved" }, ignore);
            expect(await backend.rows(docClass(), a.uid)).toHaveLength(0);
        });

        it("counts and truncates a recordACL model by each record's current version only", async () => {
            const acl = backend.aclDocs();
            const user = { user: bob };
            const a = await createRecord(acl, "ignored", ["pending", "approved"], user);
            const b = await createRecord(acl, "ignored", ["pending"], user);

            expect(await acl.count({ status: "pending" }, user)).toBe(1);
            expect(await acl.count({ status: "approved" }, user)).toBe(1);
            expect(await acl.count({}, user)).toBe(2);

            await acl.truncate({ status: "pending" }, user);
            expect(await backend.rows(aclClass(), b.uid)).toHaveLength(0);
            expect(await backend.rows(aclClass(), a.uid)).toHaveLength(2);
        });

        it("doesn't find a record by an identifier that only an older version held", async () => {
            const docs = backend.docs();
            const created = await docs.create({ slug: "old-name", status: "x" }, ignore);
            expect((await docs.findOne("old-name", ignore))?.uid).toBe(created.uid);

            await docs.update({ ...created, slug: "new-name" }, created, ignore);

            expect(await docs.findOne("old-name", ignore)).toBeUndefined();
            expect(await docs.exists("old-name", ignore)).toBe(0);
            expect((await docs.findOne("new-name", ignore))?.version).toBe(1);
            expect(await docs.exists("new-name", ignore)).toBe(1);
            // The old version is still there for anyone who asks for it by version.
            expect((await docs.findOne("old-name", { ...ignore, version: 0 }))?.version).toBe(0);
        });

        it("makes the newest remaining version current when the current one is purged", async () => {
            const docs = backend.docs();
            const created = await createRecord(docs, "p", ["one", "two", "three"]);
            expect(await latestVersions(created.uid)).toEqual([2]);

            // Purging a version that isn't current changes nothing.
            await docs.delete(created.uid, { ...ignore, version: "0", purge: true });
            expect(await latestVersions(created.uid)).toEqual([2]);

            await docs.delete(created.uid, { ...ignore, version: 2, purge: true });
            expect(await latestVersions(created.uid)).toEqual([1]);
            expect((await docs.findOne(created.uid, ignore))?.status).toBe("two");
            expect(await docs.count({}, ignore)).toBe(1);

            await docs.delete(created.uid, { ...ignore, version: 1, purge: true });
            expect(await backend.rows(docClass(), created.uid)).toHaveLength(0);
            expect(await docs.count({}, ignore)).toBe(0);
        });

        it("leaves the marker unchanged when a concurrent update loses", async () => {
            const docs = backend.docs();
            const created = await docs.create({ slug: "race", status: "start" }, ignore);
            await docs.update({ ...created, status: "winner" }, created, ignore);

            // The loser read the same version as the winner did.
            await expect(docs.update({ ...created, status: "loser" }, created, ignore)).rejects.toMatchObject({
                status: 409,
            });
            expect(await latestVersions(created.uid)).toEqual([1]);
            expect((await docs.findOne(created.uid, ignore))?.status).toBe("winner");
        });

        it("ignores a client-supplied latest on create, update and search", async () => {
            const docs = backend.docs();
            const created = await docs.create({ slug: "c", status: "one", latest: false } as any, ignore);
            expect(await latestVersions(created.uid)).toEqual([0]);

            const updated = await docs.update({ ...created, status: "two", latest: false }, created, ignore);
            expect(await latestVersions(created.uid)).toEqual([1]);
            expect(updated).not.toHaveProperty("latest");

            // `latest=false` doesn't turn a search into a history search.
            const found = await docs.find({ latest: "false" }, ignore);
            expect(found.map((r: any) => r.version)).toEqual([1]);
            expect(await docs.count({ latest: "false" }, ignore)).toBe(1);
        });

        it("still returns older versions when the query filters on version", async () => {
            const docs = backend.docs();
            const a = await createRecord(docs, "a", ["pending", "approved"]);
            const b = await createRecord(docs, "b", ["pending"]);

            const v0 = await docs.find({ version: "0" }, ignore);
            expect(v0.map((r: any) => r.uid).sort()).toEqual([a.uid, b.uid].sort());
            expect(await docs.count({ version: "0" }, ignore)).toBe(2);
            expect(await docs.count({ uid: a.uid, version: "gte(0)" }, ignore)).toBe(2);
            expect((await docs.find({ uid: a.uid, version: "0", status: "pending" }, ignore)).map((r: any) => r.version)).toEqual([0]);
        });

        it("treats @TrackChanges(0) as untracked: one row, updated in place, no marker", async () => {
            const zeros = backend.zeros();
            expect(ModelUtils.isTrackChanges(zeroClass())).toBe(false);
            const created = await zeros.create({ status: "one", latest: true } as any, ignore);
            const rows = await backend.rows(zeroClass(), created.uid);
            expect(rows).toHaveLength(1);
            expect(rows[0]).not.toHaveProperty("latest");

            await zeros.update({ ...created, status: "two" }, created, ignore);
            const after = await backend.rows(zeroClass(), created.uid);
            expect(after).toHaveLength(1);
            expect(after[0].status).toBe("two");
            expect(after[0]).not.toHaveProperty("latest");
            expect(await zeros.find({ status: "two" }, ignore)).toHaveLength(1);
        });
    });
});
