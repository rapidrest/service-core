///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// End-to-end exploit scenarios for RepoUtils' write path, against a real (standalone, so non-transactional)
// MongoDB and a real SQLite database. Each was found by an adversarial review of @rapidmx/restapi, a large downstream
// consumer that had to work around it itself:
// - a create body's `_id` replacing an unrelated document;
// - a create adopting (and granting its creator full rights on) an ACL that guards some other record;
// - dotted/`$` keys in an update body writing nested paths that validation never saw;
// - optimistic locking silently skipped for a plain (non-model-instance) `existing` document;
// - a successful Mongo update reported as a 500 because its separate read-back raced a concurrent update;
// - Date-typed fields persisted as strings, so date range queries never match them.
import "reflect-metadata";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Logger, type JWTUser } from "@rapidrest/core";
import config from "./config";
import { ObjectFactory } from "../src/ObjectFactory";
import { ConnectionManager } from "../src/database/ConnectionManager";
import { MongoConnection } from "../src/database/MongoConnection";
import { MongoRepository } from "../src/database/MongoRepository";
import { ModelUtils } from "../src/models/ModelUtils";
import { RepoUtils } from "../src/models/RepoUtils";
import { BaseEntity } from "../src/models/BaseEntity";
import { BaseMongoEntity } from "../src/models/BaseMongoEntity";
import { Column, Entity } from "../src/decorators/PersistenceDecorators";
import { DataStore, Protect } from "../src/decorators/ModelDecorators";
import { ACLUtils } from "../src/security/ACLUtils";
import { AccessControlListMongo } from "../src/security/AccessControlListMongo";
import { ACLAction } from "../src/security/AccessControlList";
import { ApiErrors } from "../src/ApiErrors";

// Any authenticated user may create and read, but only a record's own ACL grants anything more.
const CLASS_RECORDS = [
    { userOrRoleId: "anonymous", actions: [] },
    { userOrRoleId: ".*", actions: [ACLAction.CREATE, ACLAction.READ, ACLAction.LIST, ACLAction.COUNT] },
];

@DataStore("mongodb")
@Entity({ name: "ws_note" })
@Protect({ uid: "<ClassName>", records: CLASS_RECORDS }, true)
class WsNote extends BaseMongoEntity {
    @Column()
    public mailboxUid: string = "";

    @Column()
    public text: string = "";

    @Column()
    public tags: string[] = [];

    @Column()
    public when?: Date;

    constructor(other?: any) {
        super(other);
        if (other) {
            this.mailboxUid = "mailboxUid" in other ? other.mailboxUid : this.mailboxUid;
            this.text = "text" in other ? other.text : this.text;
            this.tags = "tags" in other ? other.tags : this.tags;
            this.when = "when" in other ? other.when : this.when;
        }
    }
}

/** A second, unrelated record-ACL model sharing the one global ACL collection with WsNote. */
@DataStore("mongodb")
@Entity({ name: "ws_other" })
@Protect({ uid: "<ClassName>", records: CLASS_RECORDS }, true)
class WsOther extends BaseMongoEntity {
    @Column()
    public text: string = "";

    constructor(other?: any) {
        super(other);
        if (other) {
            this.text = "text" in other ? other.text : this.text;
        }
    }
}

@DataStore("sqlite")
@Entity({ name: "ws_sql_note" })
class WsSqlNote extends BaseEntity {
    @Column()
    public text: string = "";

    @Column()
    public when: Date = new Date(0);

    constructor(other?: any) {
        super(other);
        if (other) {
            this.text = "text" in other ? other.text : this.text;
            this.when = "when" in other ? other.when : this.when;
        }
    }
}

const mongod: MongoMemoryServer = new MongoMemoryServer({ instance: { port: 9999 } });

const alice: JWTUser = { uid: "alice", roles: [] } as any;
const mallory: JWTUser = { uid: "mallory", roles: [] } as any;
const admin: JWTUser = { uid: "root", roles: ["admin"] } as any;

vi.setConfig({ testTimeout: 120000 });
describe("RepoUtils write-path safety [MongoDB + SQL]", () => {
    let objectFactory: ObjectFactory;
    let notes: RepoUtils<WsNote>;
    let others: RepoUtils<WsOther>;
    let sqlNotes: RepoUtils<WsSqlNote>;
    let noteRepo: MongoRepository<WsNote>;
    let otherRepo: MongoRepository<WsOther>;
    let aclRepo: MongoRepository<AccessControlListMongo>;

    const expectApiError = async (promise: Promise<any>, code: string, status: number) => {
        await expect(promise).rejects.toMatchObject({ code, status });
    };

    beforeAll(async () => {
        await mongod.start();
        objectFactory = new ObjectFactory(config, Logger());
        const connMgr: ConnectionManager = await objectFactory.newInstance(ConnectionManager, { name: "default" });

        const models: Map<string, any> = await ModelUtils.loadModels("./src/security");
        models.set("WsNote", WsNote);
        models.set("WsOther", WsOther);
        models.set("WsSqlNote", WsSqlNote);
        const suffix: string = String(Date.now());
        await connMgr.connect(
            {
                acl: { type: "mongodb", url: `mongodb://localhost:9999/ws-acl-${suffix}`, synchronize: true },
                mongodb: { type: "mongodb", url: `mongodb://localhost:9999/ws-data-${suffix}`, synchronize: true },
                sqlite: { type: "better-sqlite3", host: "localhost", database: ":memory:", synchronize: true },
            },
            models,
        );

        noteRepo = (connMgr.connections.get("mongodb") as MongoConnection).getRepository(WsNote);
        otherRepo = (connMgr.connections.get("mongodb") as MongoConnection).getRepository(WsOther);
        aclRepo = (connMgr.connections.get("acl") as MongoConnection).getRepository(AccessControlListMongo);

        await objectFactory.newInstance(ACLUtils, { name: "default" });
        const newRepoUtils = (clazz: any): Promise<any> =>
            objectFactory.newInstance(RepoUtils, { name: clazz.name, initialize: true, args: [clazz] });
        notes = await newRepoUtils(WsNote);
        others = await newRepoUtils(WsOther);
        sqlNotes = await newRepoUtils(WsSqlNote);
    });

    afterAll(async () => {
        await objectFactory?.destroy();
        await mongod.stop();
    });

    describe("create() with a client-supplied _id [MongoDB]", () => {
        it("inserts a new document instead of replacing the one that owns that _id", async () => {
            const victim: WsNote = await notes.create({ mailboxUid: "alice-mbx", text: "private" }, { user: alice });

            // What a route does with a POST body: instantiate the model from it, then create().
            const body: any = { _id: String(victim._id), mailboxUid: "mallory-mbx", text: "pwned" };
            const created: WsNote = await notes.create(new WsNote(body), { user: mallory, ignoreACL: true });

            expect(String(created._id)).not.toBe(String(victim._id));
            const stored: any = await noteRepo.findOne({ _id: victim._id });
            expect(stored.text).toBe("private");
            expect(stored.mailboxUid).toBe("alice-mbx");
            expect(await noteRepo.count({ uid: created.uid } as any)).toBe(1);
        });

        it("discards a client-supplied version, dateCreated and dateModified", async () => {
            const created: WsNote = await notes.create(
                { text: "forged", version: 99, dateCreated: "2000-01-01T00:00:00Z" } as any,
                { user: alice },
            );
            const stored: any = await noteRepo.findOne({ uid: created.uid } as any);
            expect(stored.version).toBe(0);
            expect(stored.dateCreated.getFullYear()).toBeGreaterThan(2000);
        });

        it("keeps a trusted caller's preserved _id, but still refuses to overwrite an existing document", async () => {
            const victim: WsNote = await notes.create({ text: "keep me" }, { user: alice });
            await expectApiError(
                notes.create({ _id: victim._id, text: "restore over it" } as any, { user: admin, preserveId: true }),
                ApiErrors.IDENTIFIER_EXISTS,
                400,
            );
            expect(((await noteRepo.findOne({ _id: victim._id })) as any).text).toBe("keep me");
        });
    });

    describe("create() under a uid that already has an ACL [MongoDB]", () => {
        const aclOf = async (uid: string): Promise<any> => aclRepo.findOne({ uid } as any);

        it("refuses another user's create of a different model at that uid, leaving the ACL and data untouched", async () => {
            const victim: WsNote = await notes.create({ text: "alice's" }, { user: alice });
            const aclBefore: any = await aclOf(victim.uid);

            await expectApiError(
                others.create({ uid: victim.uid, text: "hijack" }, { user: mallory, ignoreACL: true }),
                ApiErrors.IDENTIFIER_EXISTS,
                400,
            );

            const aclAfter: any = await aclOf(victim.uid);
            expect(aclAfter.version).toBe(aclBefore.version);
            expect(aclAfter.records).toEqual(aclBefore.records);
            expect(aclAfter.records.some((r: any) => r.userOrRoleId === "mallory")).toBe(false);
            expect(await otherRepo.count({ uid: victim.uid } as any)).toBe(0);

            // ...and mallory still has no rights on alice's record.
            const aclUtils: ACLUtils = (notes as any).aclUtils;
            expect(await aclUtils.hasPermission(mallory, victim.uid, ACLAction.UPDATE)).toBe(false);
        });

        it("refuses a create at a well-known ACL uid (e.g. another model's class ACL)", async () => {
            await expectApiError(
                others.create({ uid: "WsNote", text: "take over the class ACL" }, { user: mallory, ignoreACL: true }),
                ApiErrors.IDENTIFIER_EXISTS,
                400,
            );
            const classAcl: any = await aclOf("WsNote");
            expect(classAcl.records.some((r: any) => r.userOrRoleId === "mallory")).toBe(false);
        });

        it("refuses even the owner's create of another model at their own record's uid, leaving the ACL untouched", async () => {
            const note: WsNote = await notes.create({ text: "alice's" }, { user: alice });
            const aclBefore: any = await aclOf(note.uid);

            await expectApiError(
                others.create({ uid: note.uid, text: "same owner" }, { user: alice }),
                ApiErrors.IDENTIFIER_EXISTS,
                400,
            );

            const aclAfter: any = await aclOf(note.uid);
            expect(aclAfter.version).toBe(aclBefore.version);
            expect(aclAfter.records).toEqual(aclBefore.records);
            expect(await otherRepo.count({ uid: note.uid } as any)).toBe(0);
        });

        it("refuses a trusted caller too, and reuses the ACL unchanged only when trusted code passes allowExistingACL", async () => {
            const note: WsNote = await notes.create({ text: "alice's" }, { user: alice });
            await expectApiError(
                others.create({ uid: note.uid, text: "admin" }, { user: admin }),
                ApiErrors.IDENTIFIER_EXISTS,
                400,
            );
            await others.create({ uid: note.uid, text: "admin" }, { user: admin, allowExistingACL: true });
            expect((await aclOf(note.uid)).records.some((r: any) => r.userOrRoleId === "root")).toBe(false);
        });

        it("lets only one of two concurrent creates of different models claim the same uid, with no orphan row", async () => {
            const uid: string = "race-" + Date.now();
            const [a, b] = await Promise.allSettled([
                notes.create({ uid, text: "alice" }, { user: alice }),
                others.create({ uid, text: "mallory" }, { user: mallory }),
            ]);

            const fulfilled: any[] = [a, b].filter((r) => r.status === "fulfilled");
            const rejected: any[] = [a, b].filter((r) => r.status === "rejected");
            expect(fulfilled.length).toBe(1);
            expect(rejected.length).toBe(1);
            expect(rejected[0].reason?.code).toBe(ApiErrors.IDENTIFIER_EXISTS);

            const winner: string = a.status === "fulfilled" ? "alice" : "mallory";
            const acl: any = await aclOf(uid);
            expect(acl.records.map((r: any) => r.userOrRoleId)).toEqual([winner]);
            expect((await noteRepo.count({ uid } as any)) + (await otherRepo.count({ uid } as any))).toBe(1);
        });
    });

    describe("update() with path/operator keys", () => {
        it("rejects a dotted or $ key with a 400 and writes nothing [MongoDB]", async () => {
            const note: WsNote = await notes.create({ text: "t", tags: ["a", "b"] }, { user: alice });

            for (const key of ["tags.1", "$rename"]) {
                await expectApiError(
                    notes.update({ uid: note.uid, version: note.version, [key]: "z" } as any, note, { user: alice }),
                    ApiErrors.INVALID_REQUEST,
                    400,
                );
            }

            const stored: any = await noteRepo.findOne({ uid: note.uid } as any);
            expect(stored.tags).toEqual(["a", "b"]);
            expect(stored.version).toBe(note.version);
        });

        it("rejects a dotted or $ key with a 400 [SQL]", async () => {
            const note: WsSqlNote = await sqlNotes.create({ text: "t" }, {});
            for (const key of ["text.x", "$set"]) {
                await expectApiError(
                    sqlNotes.update({ uid: note.uid, version: note.version, [key]: "z" } as any, note, {}),
                    ApiErrors.INVALID_REQUEST,
                    400,
                );
            }
        });
    });

    describe("optimistic locking with a plain existing document", () => {
        it("enforces the version check and bumps version/dateModified for a raw Mongo document [MongoDB]", async () => {
            const note: WsNote = await notes.create({ text: "v0" }, { user: alice });
            const row: any = await noteRepo.findOne({ uid: note.uid } as any);
            expect(row).not.toBeInstanceOf(WsNote);

            // Two writers that both read version 0: the second must lose, not silently overwrite the first.
            const first: WsNote = await notes.update({ uid: note.uid, version: 0, text: "first" }, row, {
                user: alice,
            });
            expect(first.version).toBe(1);
            expect(first.dateModified.getTime()).toBeGreaterThanOrEqual(row.dateModified.getTime());
            await expectApiError(
                notes.update({ uid: note.uid, version: 0, text: "second" }, row, { user: alice }),
                ApiErrors.INVALID_OBJECT_VERSION,
                409,
            );

            const stored: any = await noteRepo.findOne({ uid: note.uid } as any);
            expect(stored.text).toBe("first");
            expect(stored.version).toBe(1);
        });

        it("enforces the version check for a plain copy of a row [SQL]", async () => {
            const note: WsSqlNote = await sqlNotes.create({ text: "v0" }, {});
            const plain: any = { ...note };
            await sqlNotes.update({ uid: note.uid, version: 0, text: "first" }, plain, {});
            await expectApiError(
                sqlNotes.update({ uid: note.uid, version: 1, text: "stale" }, plain, {}),
                ApiErrors.INVALID_OBJECT_VERSION,
                409,
            );
        });
    });

    describe("update() racing a concurrent update [MongoDB]", () => {
        it("returns its own successful write even when another update lands right after it", async () => {
            const note: WsNote = await notes.create({ text: "v0" }, { user: alice });
            const repo: MongoRepository<WsNote> = (notes as any).repo;
            const original = repo.findOneAndUpdate.bind(repo);
            const spy = vi.spyOn(repo, "findOneAndUpdate").mockImplementationOnce(async (...args: any[]) => {
                const doc: any = await (original as any)(...args);
                // A concurrent writer bumps the version again before this call could have read its result back.
                await noteRepo.updateOne({ uid: note.uid }, { $set: { text: "concurrent" }, $inc: { version: 1 } });
                return doc;
            });
            try {
                const updated: WsNote = await notes.update({ uid: note.uid, version: 0, text: "mine" }, note, {
                    user: alice,
                });
                expect(updated.version).toBe(1);
                expect(updated.text).toBe("mine");
            } finally {
                spy.mockRestore();
            }
            expect(((await noteRepo.findOne({ uid: note.uid } as any)) as any).version).toBe(2);
        });
    });

    describe("Date-typed properties from JSON", () => {
        it("persists ISO strings as dates on create and update, so range queries match, and rejects invalid dates [MongoDB]", async () => {
            const note: WsNote = await notes.create({ text: "dated", when: "2026-03-01T10:00:00.000Z" } as any, {
                user: alice,
            });

            const raw: any = await noteRepo.collection.findOne({ uid: note.uid } as any);
            expect(raw.when).toBeInstanceOf(Date);
            const inRange = {
                uid: note.uid,
                when: { $gte: new Date("2026-03-01T00:00:00Z"), $lt: new Date("2026-03-02T00:00:00Z") },
            };
            expect(await noteRepo.count(inRange as any)).toBe(1);

            await notes.update({ uid: note.uid, version: note.version, when: "2026-04-01T00:00:00Z" } as any, note, {
                user: alice,
            });
            const updated: any = await noteRepo.collection.findOne({ uid: note.uid } as any);
            expect(updated.when).toBeInstanceOf(Date);
            expect(updated.when.toISOString()).toBe("2026-04-01T00:00:00.000Z");

            await expectApiError(
                notes.create({ text: "bad", when: "not-a-date" } as any, { user: alice }),
                ApiErrors.INVALID_REQUEST,
                400,
            );
        });

        it("persists ISO strings as dates and rejects invalid dates [SQL]", async () => {
            const note: WsSqlNote = await sqlNotes.create(
                { text: "dated", when: "2026-03-01T10:00:00.000Z" } as any,
                {},
            );
            const stored: WsSqlNote | undefined = await sqlNotes.findOne(note.uid);
            expect(stored?.when).toBeInstanceOf(Date);
            expect(stored?.when.toISOString()).toBe("2026-03-01T10:00:00.000Z");

            await expectApiError(
                sqlNotes.update({ uid: note.uid, version: note.version, when: "31/31/2026" } as any, note, {}),
                ApiErrors.INVALID_REQUEST,
                400,
            );
        });
    });
});
