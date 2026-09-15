///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// End-to-end scenarios for RepoUtils' ACL ownership, caching and notification paths, against a real (standalone)
// MongoDB and a real SQLite database. Each reproduces a verified review finding:
// - a record create/delete claiming or removing a class/route/default ACL that shares its uid;
// - a create adopting an ACL planted at its uid by another user;
// - ACL route writes never reaching ACLUtils' cache;
// - `me` queries, id lookups and query results sharing cache keys across users/records;
// - cached objects stripped in place, stale cached lists, and scoped fields in push payloads;
// - unbounded per-record ACL work in count()/truncate();
// - SQL date-only columns stored a day off, duplicate keys as 500s, and soft-deleted rows leaking through count().
import "reflect-metadata";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Logger, ObjectDecorators, type JWTUser } from "@rapidrest/core";
import config from "./config";
import { ObjectFactory } from "../src/ObjectFactory";
import { ConnectionManager } from "../src/database/ConnectionManager";
import { MongoConnection } from "../src/database/MongoConnection";
import { MongoRepository } from "../src/database/MongoRepository";
import { ModelUtils } from "../src/models/ModelUtils";
import { RepoUtils } from "../src/models/RepoUtils";
import { BaseEntity } from "../src/models/BaseEntity";
import { BaseMongoEntity } from "../src/models/BaseMongoEntity";
import { RecoverableBaseMongoEntity } from "../src/models/RecoverableBaseMongoEntity";
import { Column, Entity } from "../src/decorators/PersistenceDecorators";
import { Cache, DataStore, Protect, ReadOnly, TrackChanges } from "../src/decorators/ModelDecorators";
import { ACLUtils } from "../src/security/ACLUtils";
import { AccessControlListMongo } from "../src/security/AccessControlListMongo";
import { ACLAction } from "../src/security/AccessControlList";
import { ApiErrors } from "../src/ApiErrors";
const { RequiresScope } = ObjectDecorators;

const CLASS_RECORDS = [
    { userOrRoleId: "anonymous", actions: [] },
    { userOrRoleId: ".*", actions: [ACLAction.CREATE, ACLAction.READ, ACLAction.LIST, ACLAction.COUNT] },
];

@DataStore("mongodb")
@Entity({ name: "ca_note" })
@Protect({ uid: "<ClassName>", records: CLASS_RECORDS }, true)
class CaNote extends BaseMongoEntity {
    @Column()
    public text: string = "";

    constructor(other?: any) {
        super(other);
        if (other) {
            this.text = "text" in other ? other.text : this.text;
        }
    }
}

@DataStore("mongodb")
@Entity({ name: "ca_other" })
@Protect({ uid: "<ClassName>", records: CLASS_RECORDS }, true)
class CaOther extends BaseMongoEntity {
    @Column()
    public text: string = "";

    constructor(other?: any) {
        super(other);
        if (other) {
            this.text = "text" in other ? other.text : this.text;
        }
    }
}

/** A cached, recoverable model with a class-level (not record-level) ACL and scoped fields. */
@DataStore("mongodb")
@Entity({ name: "ca_item" })
@Cache(60)
@Protect({ uid: "<ClassName>", records: CLASS_RECORDS })
class CaItem extends RecoverableBaseMongoEntity {
    @Column()
    public owner: string = "";

    @Column()
    public text: string = "";

    @RequiresScope("admin")
    @Column()
    public secret: string = "";

    @ReadOnly
    @RequiresScope("admin")
    @Column()
    public adminOnly: string = "";

    constructor(other?: any) {
        super(other);
        if (other) {
            this.owner = "owner" in other ? other.owner : this.owner;
            this.text = "text" in other ? other.text : this.text;
            this.secret = "secret" in other ? other.secret : this.secret;
            this.adminOnly = "adminOnly" in other ? other.adminOnly : this.adminOnly;
        }
    }
}

/** A cached trackChanges model with a read-only scoped field. */
@DataStore("mongodb")
@Entity({ name: "ca_versioned" })
@Cache(60)
@TrackChanges()
class CaVersioned extends BaseMongoEntity {
    @Column()
    public text: string = "";

    @ReadOnly
    @RequiresScope("admin")
    @Column()
    public adminOnly: string = "";

    constructor(other?: any) {
        super(other);
        if (other) {
            this.text = "text" in other ? other.text : this.text;
            this.adminOnly = "adminOnly" in other ? other.adminOnly : this.adminOnly;
        }
    }
}

@DataStore("sqlite")
@Entity({ name: "ca_sql_note" })
class CaSqlNote extends BaseEntity {
    @Column({ nullable: true })
    public text: string = "";

    @Column({ type: "date", nullable: true })
    public day?: string;

    @Column({ unique: true, nullable: true })
    public code?: string;

    constructor(other?: any) {
        super(other);
        if (other) {
            this.text = "text" in other ? other.text : this.text;
            this.day = "day" in other ? other.day : this.day;
            this.code = "code" in other ? other.code : this.code;
        }
    }
}

@DataStore("sqlite")
@Entity({ name: "ca_sql_versioned" })
@TrackChanges()
class CaSqlVersioned extends BaseEntity {
    @Column({ nullable: true })
    public text: string = "";

    constructor(other?: any) {
        super(other);
        if (other) {
            this.text = "text" in other ? other.text : this.text;
        }
    }
}

@DataStore("sqlite")
@Entity({ name: "ca_sql_owned" })
@Protect({ uid: "<ClassName>", records: CLASS_RECORDS }, true)
class CaSqlOwned extends BaseEntity {
    @Column({ nullable: true })
    public text: string = "";

    constructor(other?: any) {
        super(other);
        if (other) {
            this.text = "text" in other ? other.text : this.text;
        }
    }
}

const mongod: MongoMemoryServer = new MongoMemoryServer({ instance: { port: 9999 } });

const alice: JWTUser = { uid: "alice", roles: [] } as any;
const bob: JWTUser = { uid: "bob", roles: [] } as any;
const mallory: JWTUser = { uid: "mallory", roles: [] } as any;
const admin: JWTUser = { uid: "root", roles: ["admin"], scopes: ["admin"] };

vi.setConfig({ testTimeout: 120000 });
describe("RepoUtils ACL ownership, caching and notifications [MongoDB + SQL]", () => {
    let objectFactory: ObjectFactory;
    let aclUtils: ACLUtils;
    let notes: RepoUtils<CaNote>;
    let others: RepoUtils<CaOther>;
    let items: RepoUtils<CaItem>;
    let versioned: RepoUtils<CaVersioned>;
    let acls: RepoUtils<AccessControlListMongo>;
    let sqlNotes: RepoUtils<CaSqlNote>;
    let sqlVersioned: RepoUtils<CaSqlVersioned>;
    let sqlOwned: RepoUtils<CaSqlOwned>;
    let noteRepo: MongoRepository<CaNote>;
    let itemRepo: MongoRepository<CaItem>;
    let versionedRepo: MongoRepository<CaVersioned>;
    let aclRepo: MongoRepository<AccessControlListMongo>;

    const expectApiError = async (promise: Promise<any>, code: string, status: number) => {
        await expect(promise).rejects.toMatchObject({ code, status });
    };
    const aclOf = async (uid: string): Promise<any> => aclRepo.findOne({ uid } as any);

    beforeAll(async () => {
        await mongod.start();
        objectFactory = new ObjectFactory(config, Logger());
        const connMgr: ConnectionManager = await objectFactory.newInstance(ConnectionManager, { name: "default" });

        const models: Map<string, any> = await ModelUtils.loadModels("./src/security");
        for (const clazz of [CaNote, CaOther, CaItem, CaVersioned, CaSqlNote, CaSqlVersioned, CaSqlOwned]) {
            models.set(clazz.name, clazz);
        }
        const suffix: string = String(Date.now());
        await connMgr.connect(
            {
                acl: { type: "mongodb", url: `mongodb://localhost:9999/ca-acl-${suffix}`, synchronize: true },
                mongodb: { type: "mongodb", url: `mongodb://localhost:9999/ca-data-${suffix}`, synchronize: true },
                sqlite: { type: "better-sqlite3", host: "localhost", database: ":memory:", synchronize: true },
            },
            models,
        );

        const mongo = connMgr.connections.get("mongodb") as MongoConnection;
        noteRepo = mongo.getRepository(CaNote);
        itemRepo = mongo.getRepository(CaItem);
        versionedRepo = mongo.getRepository(CaVersioned);
        aclRepo = (connMgr.connections.get("acl") as MongoConnection).getRepository(AccessControlListMongo);

        aclUtils = await objectFactory.newInstance(ACLUtils, { name: "default" });
        const newRepoUtils = (clazz: any): Promise<any> =>
            objectFactory.newInstance(RepoUtils, { name: clazz.name, initialize: true, args: [clazz] });
        notes = await newRepoUtils(CaNote);
        others = await newRepoUtils(CaOther);
        items = await newRepoUtils(CaItem);
        versioned = await newRepoUtils(CaVersioned);
        acls = await newRepoUtils(AccessControlListMongo);
        sqlNotes = await newRepoUtils(CaSqlNote);
        sqlVersioned = await newRepoUtils(CaSqlVersioned);
        sqlOwned = await newRepoUtils(CaSqlOwned);
    });

    afterAll(async () => {
        await objectFactory?.destroy();
        await mongod.stop();
    });

    describe("record ACLs never claim, adopt or remove a class/route/default ACL", () => {
        const routeAcl = { uid: "CaVictimRoute", records: [{ userOrRoleId: "anonymous", actions: [] }] };

        beforeAll(async () => {
            // What RouteUtils.registerRoute() does for `@Route("/victim") @Protect() class CaVictimRoute`.
            expect(await aclUtils.saveDefaultACL(routeAcl as any)).toMatchObject({ uid: "CaVictimRoute" });
        });

        it("refuses a create at a route ACL, a class ACL or any default_ uid, whoever the caller is", async () => {
            for (const uid of ["CaVictimRoute", "default_CaVictimRoute", "CaItem", "default_Anything"]) {
                for (const user of [mallory, admin]) {
                    await expectApiError(notes.create({ uid, text: "x" }, { user }), ApiErrors.IDENTIFIER_EXISTS, 400);
                    await expectApiError(
                        notes.create({ uid, text: "x" }, { user, allowExistingACL: true }),
                        ApiErrors.IDENTIFIER_EXISTS,
                        400,
                    );
                }
                expect(await noteRepo.count({ uid } as any)).toBe(0);
            }
            // Even an ACL shaped like a default one that this process never registered.
            await aclUtils.saveACL({ uid: "CaUnloadedRoute", parentUid: "default_CaUnloadedRoute", records: [] });
            await expectApiError(
                notes.create({ uid: "CaUnloadedRoute" }, { user: admin, allowExistingACL: true }),
                ApiErrors.IDENTIFIER_EXISTS,
                400,
            );
        });

        it("never removes a route/class ACL when deleting or truncating a record that shares its uid", async () => {
            // A record left over from before the fix, sharing uids with a route and a class ACL.
            await noteRepo.save({ uid: "CaVictimRoute", text: "old", version: 0 } as any);
            await noteRepo.save({ uid: "CaOther", text: "old", version: 0 } as any);
            await noteRepo.save({ uid: "CaUnloadedRoute", text: "old", version: 0 } as any);

            await notes.delete("CaVictimRoute", { user: admin, purge: true });
            await notes.truncate({ uid: "in(CaOther,CaUnloadedRoute)" }, { user: admin });

            expect(await noteRepo.count({ uid: { $in: ["CaVictimRoute", "CaOther", "CaUnloadedRoute"] } } as any)).toBe(0);
            expect(await aclOf("CaVictimRoute")).toBeTruthy();
            expect(await aclOf("CaOther")).toBeTruthy();
            expect(await aclOf("CaUnloadedRoute")).toBeTruthy();
        });

        it("recreates a missing user-editable ACL on the next saveDefaultACL(), so a route never registers against null", async () => {
            await aclRepo.deleteMany({ uid: "CaVictimRoute" } as any);
            await (aclUtils as any).cache?.clear();

            const result: any = await aclUtils.saveDefaultACL(routeAcl as any);

            expect(result).toMatchObject({ uid: "CaVictimRoute", parentUid: "default_CaVictimRoute" });
            expect(await aclOf("CaVictimRoute")).toMatchObject({ parentUid: "default_CaVictimRoute" });
            expect(await aclUtils.hasPermission(undefined, "CaVictimRoute", ACLAction.READ)).toBe(false);
        });
    });

    describe("planted ACL reuse", () => {
        it("refuses an admin's create at a uid a low-privilege user already claimed on another model", async () => {
            await notes.create({ uid: "acme-billing", text: "planted" }, { user: mallory });

            await expectApiError(
                others.create({ uid: "acme-billing", text: "billing" }, { user: admin }),
                ApiErrors.IDENTIFIER_EXISTS,
                400,
            );
            expect(await others.count({ uid: "acme-billing" }, { ignoreACL: true })).toBe(0);
        });

        it("refuses any user's create at a uid carrying a planted wildcard grant", async () => {
            const planted: CaNote = await notes.create({ uid: "planted-star", text: "planted" }, { user: mallory });
            const acl: any = await aclOf(planted.uid);
            await aclUtils.saveACL({ ...acl, records: [...acl.records, { userOrRoleId: "*", actions: ["*"] }] });

            await expectApiError(
                others.create({ uid: "planted-star", text: "mine" }, { user: alice }),
                ApiErrors.IDENTIFIER_EXISTS,
                400,
            );
        });

        it("still reuses the record's own ACL for a trackChanges new version", async () => {
            // Covered with a real trackChanges + recordACL model in RepoUtils.unit.test.ts; here the plain allowExistingACL
            // opt-in for trusted code (e.g. a deterministic well-known uid whose ACL is saved first).
            await aclUtils.saveACL({ uid: "well-known-folder", parentUid: "CaNote", records: [] });
            const created: CaNote = await notes.create(
                { uid: "well-known-folder", text: "inbox" },
                { user: alice, allowExistingACL: true },
            );
            expect(created.uid).toBe("well-known-folder");
            expect((await aclOf("well-known-folder")).records).toEqual([]);
        });
    });

    describe("ACL model writes reach ACLUtils' cache", () => {
        it("revokes immediately after an update, a delete and a truncate through the ACL model's RepoUtils", async () => {
            for (const uid of ["acl-upd", "acl-del", "acl-trunc"]) {
                await aclUtils.saveACL({ uid, records: [{ userOrRoleId: "bob", actions: [ACLAction.READ] }] });
                // Warm the ACLUtils cache.
                expect(await aclUtils.hasPermission(bob, uid, ACLAction.READ)).toBe(true);
            }

            const existing: any = await acls.findOne("acl-upd", { ignoreACL: true });
            await acls.update({ uid: "acl-upd", version: existing.version, records: [] } as any, existing, {
                ignoreACL: true,
            });
            expect(await aclUtils.hasPermission(bob, "acl-upd", ACLAction.READ)).toBe(false);

            await acls.delete("acl-del", { ignoreACL: true });
            expect(await aclUtils.hasPermission(bob, "acl-del", ACLAction.READ)).toBe(false);

            await acls.truncate({ uid: "acl-trunc" }, { ignoreACL: true });
            expect(await aclUtils.hasPermission(bob, "acl-trunc", ACLAction.READ)).toBe(false);
        });

        it("doesn't renew a cached ACL on every cache hit", async () => {
            await aclUtils.saveACL({ uid: "acl-hit", records: [] });
            await aclUtils.findACL("acl-hit");
            const cache: any = (aclUtils as any).cache;
            const save = vi.spyOn(cache, "save");
            try {
                await aclUtils.findACL("acl-hit");
                await aclUtils.findACL("acl-hit");
                expect(save).not.toHaveBeenCalled();
            } finally {
                save.mockRestore();
            }
        });
    });

    describe("result cache keys", () => {
        it("doesn't serve one user's `me` query results to another user", async () => {
            await items.create({ owner: "alice", text: "a" }, { user: alice });
            await items.create({ owner: "bob", text: "b" }, { user: bob });

            const aliceItems: CaItem[] = await items.find({ owner: "me" }, { user: alice });
            const bobItems: CaItem[] = await items.find({ owner: "me" }, { user: bob });

            expect(aliceItems.map((i) => i.owner)).toEqual(["alice"]);
            expect(bobItems.map((i) => i.owner)).toEqual(["bob"]);
        });

        it("still rejects a forged $literal query when the real literal query's results are cached", async () => {
            await items.create({ owner: "lit", text: "literal" }, { user: alice });
            expect((await items.find({ text: ModelUtils.literal("literal") }, { user: alice })).length).toBe(1);

            await expectApiError(
                items.find({ text: { $literal: { op: "eq", value: "literal" } } }, { user: alice }),
                ApiErrors.INVALID_REQUEST,
                400,
            );
        });

        it("never answers an id lookup with a record whose uid collides with a cache key", async () => {
            const victim: CaItem = await items.create({ uid: "n1", owner: "alice", text: "victim" }, { user: alice });
            expect((await items.findOne("n1", { user: alice }))?.text).toBe("victim");

            // The key findOne("n1") used to be cached under, and the key it is cached under now.
            const legacyKey: string = items.hashQuery(items.searchIdQuery("n1"));
            await items.create({ uid: legacyKey, owner: "mallory", text: "attacker" }, { user: mallory });
            await items.create({ uid: "rec:latest:n1", owner: "mallory", text: "attacker" }, { user: mallory });
            // Even an entry planted directly under the record's key is refused unless it really is that record.
            await (items as any).cache.save("rec:latest:n1", { ...victim, uid: "other", text: "attacker" });

            expect((await items.findOne("n1", { user: alice }))?.text).toBe("victim");
            expect((await items.findOne(legacyKey, { user: alice }))?.text).toBe("attacker");
        });
    });

    describe("cached objects", () => {
        it("never strips scoped fields from the cached copy served to other users", async () => {
            const created: CaItem = await items.create(
                { owner: "root", text: "scoped", secret: "s3cret", adminOnly: "ao" },
                { user: admin, ignoreACL: true },
            );

            // Warm every cache path as a user without the scope.
            expect((await items.findOne(created.uid, { user: bob }))?.secret).toBeUndefined();
            expect((await items.find({ text: "scoped" }, { user: bob }))[0].secret).toBeUndefined();
            expect((await items.find({ text: "scoped" }, { user: bob }))[0].secret).toBeUndefined();

            expect((await items.findOne(created.uid, { user: admin }))?.secret).toBe("s3cret");
            expect((await items.find({ text: "scoped" }, { user: admin }))[0].secret).toBe("s3cret");
        });

        it("keeps a read-only scoped field when a user who can't see it updates the record", async () => {
            const created: CaItem = await items.create({ owner: "bob", text: "v0", adminOnly: "keep" }, { user: admin });
            const existing: CaItem | undefined = await items.findOne(created.uid, { user: bob, skipCache: true });
            expect(existing?.adminOnly).toBeUndefined();

            await items.update({ uid: created.uid, version: existing!.version, text: "v1" }, existing!, {
                user: bob,
                ignoreACL: true,
            });

            expect(((await itemRepo.findOne({ uid: created.uid } as any)) as any).adminOnly).toBe("keep");
        });

        it("keeps a read-only scoped field in a new trackChanges version written by a user who can't see it", async () => {
            const created: CaVersioned = await versioned.create({ text: "v0", adminOnly: "keep" }, { user: admin });
            const existing: CaVersioned | undefined = await versioned.findOne(created.uid, { user: bob, skipCache: true });
            expect(existing?.adminOnly).toBeUndefined();

            const updated: CaVersioned = await versioned.update(
                { uid: created.uid, version: existing!.version, text: "v1" },
                existing!,
                { user: bob },
            );

            const stored: any = await versionedRepo.findOne({ uid: created.uid, version: updated.version } as any);
            expect(stored.text).toBe("v1");
            expect(stored.adminOnly).toBe("keep");
        });

        it("serves an updated record, and drops a deleted one, from a cached list", async () => {
            const created: CaItem = await items.create({ owner: "list", text: "before" }, { user: alice });
            expect((await items.find({ owner: "list" }, { user: alice }))[0].text).toBe("before");

            const loadMany = vi.spyOn((items as any).cache, "loadMany");
            try {
                await items.update({ uid: created.uid, version: created.version, text: "after" }, created, {
                    user: admin,
                });
                const listed: CaItem[] = await items.find({ owner: "list" }, { user: alice });
                expect(loadMany).toHaveBeenCalled(); // served from the cache
                expect(listed[0].text).toBe("after");

                await items.create({ owner: "list", text: "second" }, { user: alice });
                await items.delete(created.uid, { user: admin, purge: true });
                const afterDelete: CaItem[] = await items.find({ owner: "list" }, { user: alice });
                expect(afterDelete.some((i) => i.uid === created.uid)).toBe(false);
            } finally {
                loadMany.mockRestore();
            }
        });

        it("drops every cached version of a deleted trackChanges record", async () => {
            const created: CaVersioned = await versioned.create({ text: "v0" }, { user: admin });
            await versioned.update({ uid: created.uid, version: 0, text: "v1" }, created, { user: admin });
            expect((await versioned.findOne(created.uid, { version: 0, ignoreACL: true }))?.text).toBe("v0");
            expect((await versioned.find({ uid: created.uid }, { ignoreACL: true }))[0].text).toBe("v1");

            await versioned.delete(created.uid, { ignoreACL: true, purge: true });

            expect(await versioned.findOne(created.uid, { version: 0, ignoreACL: true })).toBeUndefined();
            expect(await versioned.find({ uid: created.uid }, { ignoreACL: true })).toEqual([]);
        });
    });

    describe("push notifications", () => {
        it("never publishes a scoped field, whatever the writer's scopes", async () => {
            const sendMessage = vi.fn();
            const original: any = (items as any).notificationUtils;
            (items as any).notificationUtils = { sendMessage };
            try {
                const created: CaItem = await items.create(
                    { owner: "bob", text: "n", secret: "s3cret", adminOnly: "ao" },
                    { user: admin },
                );
                expect(created.secret).toBe("s3cret"); // the writer still gets what they may see
                const updated: CaItem = await items.update(
                    { uid: created.uid, version: created.version, text: "n2", secret: "s3cret2" },
                    created,
                    { user: admin },
                );
                expect(updated.secret).toBe("s3cret2");

                expect(sendMessage).toHaveBeenCalledTimes(2);
                for (const [channels, type, , payload] of sendMessage.mock.calls) {
                    expect(channels).toContain(created.uid);
                    expect(type).toBe("CaItem");
                    // What is actually published: the payload serialized to JSON.
                    const published: any = JSON.parse(JSON.stringify(payload));
                    expect(published.uid).toBe(created.uid);
                    expect(published).not.toHaveProperty("secret");
                    expect(published).not.toHaveProperty("adminOnly");
                }
                expect(sendMessage.mock.calls[1][3].text).toBe("n2");
            } finally {
                (items as any).notificationUtils = original;
            }
        });
    });

    describe("record-ACL work on count() and truncate()", () => {
        it("counts every matching record (never capped) but caps truncate() on a recordACL model [MongoDB]", async () => {
            for (let i = 0; i < 5; i++) {
                await notes.create({ text: "bulk" }, { user: bob });
            }
            expect(await notes.count({ text: "bulk" }, { user: bob })).toBe(5);
            // A page size doesn't limit a count - it's the true total.
            expect(await notes.count({ text: "bulk", limit: 2 }, { user: bob })).toBe(5);

            await notes.truncate({ text: "bulk", limit: 2 }, { user: bob });
            expect(await noteRepo.count({ text: "bulk" } as any)).toBe(3);
            // A trusted server-side truncate (ignoreACL) isn't capped.
            await notes.truncate({ text: "bulk" }, { user: bob, ignoreACL: true });
            expect(await noteRepo.count({ text: "bulk" } as any)).toBe(0);
        });

        it("counts every matching record (never capped) but caps truncate() on a recordACL model [SQL]", async () => {
            for (let i = 0; i < 4; i++) {
                await sqlOwned.create({ text: "bulk" }, { user: bob });
            }
            expect(await sqlOwned.count({ text: "bulk" }, { user: bob })).toBe(4);
            expect(await sqlOwned.count({ text: "bulk", limit: 3 }, { user: bob })).toBe(4);
            await sqlOwned.truncate({ text: "bulk", limit: 1 }, { user: bob });
            expect(await sqlOwned.count({ text: "bulk" }, { ignoreACL: true })).toBe(3);
        });
    });

    describe("SQL date-only columns", () => {
        it("stores a YYYY-MM-DD value as that calendar date on a server west of UTC, and rejects anything else", async () => {
            const tz: string | undefined = process.env.TZ;
            process.env.TZ = "America/Los_Angeles";
            try {
                const note: CaSqlNote = await sqlNotes.create({ text: "dated", day: "2026-09-14" }, {});
                const rows: any[] = await (sqlNotes.repo as any).query("SELECT day FROM ca_sql_note WHERE uid = ?", [
                    note.uid,
                ]);
                expect(rows[0].day).toBe("2026-09-14");
                expect((await sqlNotes.findOne(note.uid))?.day).toBe("2026-09-14");

                for (const bad of ["2026-02-30", "2026-09-14T00:00:00Z", 1789344000000, "14/09/2026"]) {
                    await expectApiError(sqlNotes.create({ day: bad } as any, {}), ApiErrors.INVALID_REQUEST, 400);
                }
            } finally {
                if (tz === undefined) {
                    delete process.env.TZ;
                } else {
                    process.env.TZ = tz;
                }
            }
        });
    });

    describe("duplicate keys", () => {
        it("maps a duplicate unique column to 400 on create and update, and a version clash to 409 [SQL]", async () => {
            const first: CaSqlNote = await sqlNotes.create({ text: "a", code: "dup-a" }, {});
            const second: CaSqlNote = await sqlNotes.create({ text: "b", code: "dup-b" }, {});

            await expectApiError(sqlNotes.create({ text: "c", code: "dup-a" }, {}), ApiErrors.IDENTIFIER_EXISTS, 400);
            await expectApiError(
                sqlNotes.update({ uid: second.uid, version: second.version, code: "dup-a" }, second, {}),
                ApiErrors.IDENTIFIER_EXISTS,
                400,
            );
            expect((await sqlNotes.findOne(first.uid))?.code).toBe("dup-a");

            // Two updates that both read version 0: the loser's insert of (uid, 1) is a lost optimistic-lock race.
            const doc: CaSqlVersioned = await sqlVersioned.create({ text: "v0" }, {});
            await sqlVersioned.update({ uid: doc.uid, version: 0, text: "first" }, { ...doc } as any, {});
            await expectApiError(
                sqlVersioned.update({ uid: doc.uid, version: 0, text: "second" }, { ...doc } as any, {}),
                ApiErrors.INVALID_OBJECT_VERSION,
                409,
            );
        });

        it("never turns a racing SQL create into an update of the winner's row", async () => {
            // One in-memory SQLite connection can't run two transactions at once, so the race is reproduced by having the
            // loser's existence check miss the winner's row, exactly as it would when both checks run first.
            const uid: string = "sql-race-" + Date.now();
            await sqlNotes.create({ uid, text: "winner" }, {});
            const countById = vi.spyOn(sqlNotes as any, "countById").mockResolvedValueOnce(0);
            try {
                await expectApiError(sqlNotes.create({ uid, text: "loser" }, {}), ApiErrors.IDENTIFIER_EXISTS, 400);
            } finally {
                countById.mockRestore();
            }
            expect((await sqlNotes.findOne(uid, { skipCache: true }))?.text).toBe("winner");
            expect(await sqlNotes.count({ uid }, { ignoreACL: true })).toBe(1);
        });
    });

    describe("count() and soft-deleted records", () => {
        it("never counts soft-deleted records for a caller without DELETE+UPDATE, whatever the filter's spelling", async () => {
            await items.create({ owner: "sd", text: "live" }, { user: alice });
            const gone: CaItem = await items.create({ owner: "sd", text: "gone" }, { user: alice });
            await items.delete(gone.uid, { ignoreACL: true });

            for (const deleted of [true, "true", "eq(true)", "in(true)", "ne(false)", "in(true,false)", ["true", "false"]]) {
                expect(await items.count({ owner: "sd", deleted }, { user: bob })).toBe(1);
            }
            expect(await items.count({ owner: "sd", $or: [{ deleted: "true" }] }, { user: bob })).toBe(0);
            expect(await items.count({ owner: "sd", deleted: "eq(true)" }, { user: admin })).toBe(1);
            expect(await items.count({ owner: "sd" }, { user: bob })).toBe(1);
        });
    });
});
