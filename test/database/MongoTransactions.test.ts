///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Integration test verifying `@Transactional` — and, through it, every transactional operation on
// `RepoUtils` (create/update/delete/truncate) — against a *real* MongoDB replica set, the one deployment
// topology that actually supports multi-document transactions. This is deliberately the only test file in the
// suite that pays for a replica set (single-node election takes real wall-clock time); every other Mongo-backed
// test intentionally uses a plain standalone `MongoMemoryServer`, which is faster to start and also happens to
// be exactly the "doesn't support transactions" case that `@Transactional`'s fallback exists to handle (see
// ConnectionManager.detectMongoTransactionSupport() and its own unit tests for that side).
//
// Each RepoUtils method that writes both the entity and a related ACL record in the same call is used to prove
// genuine cross-collection atomicity: a forced failure partway through must roll back the entity write too,
// which is only possible if a real transaction (not the non-transactional fallback) was actually used.
import "reflect-metadata";
import * as uuid from "uuid";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { Logger, type JWTUser } from "@rapidrest/core";
import config from "../config";
import { ObjectFactory } from "../../src/ObjectFactory";
import { ConnectionManager } from "../../src/database/ConnectionManager";
import { MongoConnection } from "../../src/database/MongoConnection";
import { MongoRepository } from "../../src/database/MongoRepository";
import { ModelUtils } from "../../src/models/ModelUtils";
import { RepoUtils } from "../../src/models/RepoUtils";
import { BaseMongoEntity } from "../../src/models/BaseMongoEntity";
import { Column, Entity } from "../../src/decorators/PersistenceDecorators";
import { DataStore, Protect } from "../../src/decorators/ModelDecorators";
import { ACLUtils } from "../../src/security/ACLUtils";
import { AccessControlListMongo } from "../../src/security/AccessControlListMongo";
import { ACLAction } from "../../src/security/AccessControlList";
import { ModelRoute } from "../../src/routes/ModelRoute";
import { Transactional, TransactionalMode } from "../../src/decorators/DatabaseDecorators";

const FULL_ACCESS = [
    ACLAction.CREATE,
    ACLAction.READ,
    ACLAction.UPDATE,
    ACLAction.DELETE,
    ACLAction.COUNT,
    ACLAction.EXISTS,
    ACLAction.LIST,
    ACLAction.TRUNCATE,
];

// `recordACL: true` (the second @Protect argument) makes create()/delete() also write/remove a per-record ACL
// document in the same @Transactional call as the entity write — the two-write scenario this file uses to
// prove real cross-collection atomicity. Shares the "acl" datastore with AccessControlListMongo itself (rather
// than its own "mongodb" datastore) since a MongoDB ClientSession can only be used with operations issued
// through the same MongoClient it was created from — the entity and its ACL must live on the same connection
// for one transaction to ever cover both.
@DataStore("acl")
@Entity()
@Protect({ uid: "<ClassName>", records: [{ userOrRoleId: ".*", actions: FULL_ACCESS }] }, true)
class TxTestItem extends BaseMongoEntity {
    @Column()
    public name: string = "";

    constructor(other?: Partial<TxTestItem>) {
        super(other);
        if (other) {
            this.name = "name" in other ? (other.name as string) : this.name;
        }
    }
}

// A minimal ModelRoute concrete class, used to prove that a route-level @Transactional method (e.g.
// doCreateObject/doDelete) merges with RepoUtils' own @Transactional methods it calls into, rather than
// opening a second, nested session for the same logical operation.
class TxTestRoute extends ModelRoute<TxTestItem> {
    protected repoUtilsClass = RepoUtils;
}
(TxTestRoute as any).modelClass = TxTestItem;

const user: JWTUser = { uid: "tx-test-user", roles: [] } as any;

vi.setConfig({ testTimeout: 120000 });
describe("RepoUtils @Transactional Tests [MongoDB replica set]", () => {
    let replSet: MongoMemoryReplSet;
    let objectFactory: ObjectFactory;
    let connMgr: ConnectionManager;
    let repoUtils: any;
    let route: any;
    let itemRepo: MongoRepository<TxTestItem>;
    let aclRepo: MongoRepository<AccessControlListMongo>;

    beforeAll(async () => {
        // `wiredTiger` is required — the default `ephemeralForTest` storage engine doesn't support replication
        // (and therefore not transactions) at all.
        replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });

        objectFactory = new ObjectFactory(config, Logger());
        connMgr = await objectFactory.newInstance(ConnectionManager, { name: "default" });

        const models: Map<string, any> = await ModelUtils.loadModels("./src/security");
        models.set("TxTestItem", TxTestItem);

        await connMgr.connect(
            { acl: { type: "mongodb", url: replSet.getUri("tx-test"), database: "tx-test", synchronize: true } },
            models,
        );

        const conn: MongoConnection = connMgr.connections.get("acl") as MongoConnection;
        itemRepo = conn.getRepository(TxTestItem);
        aclRepo = conn.getRepository(AccessControlListMongo);

        // Must exist (registered under "default") before any RepoUtils resolves its @Inject("ACLUtils") field.
        await objectFactory.newInstance(ACLUtils, { name: "default" });

        repoUtils = await objectFactory.newInstance(RepoUtils, {
            name: TxTestItem.name,
            initialize: true,
            args: [TxTestItem],
        });

        route = await objectFactory.newInstance(TxTestRoute, { name: "TxTestRoute", initialize: true });
    });

    afterAll(async () => {
        await objectFactory.destroy();
        await replSet.stop();
    });

    it("detects that the replica set supports transactions", () => {
        const conn: MongoConnection = connMgr.connections.get("acl") as MongoConnection;
        expect(conn.supportsTransactions).toBe(true);
    });

    describe("create()", () => {
        it("commits the entity and its per-record ACL atomically", async () => {
            const created = await repoUtils.create({ name: "committed" }, { user });

            const foundItem = await itemRepo.findOne({ uid: created.uid } as any);
            expect(foundItem).toBeDefined();
            expect(foundItem?.name).toBe("committed");

            const foundAcl = await aclRepo.findOne({ uid: created.uid } as any);
            expect(foundAcl).toBeDefined();
        });

        it("rolls back the entity write when the ACL save fails partway through the transaction", async () => {
            const saveACL = vi.spyOn(repoUtils.aclUtils, "saveACL").mockRejectedValueOnce(new Error("boom"));
            try {
                const name = "should-not-persist-" + uuid.v4();
                await expect(repoUtils.create({ name }, { user })).rejects.toThrow("boom");

                // If create() had silently fallen back to non-transactional execution, the entity save (which
                // happens before the ACL save) would already have committed before the ACL save's failure.
                const found = await itemRepo.findOne({ name } as any);
                expect(found).toBeNull();
            } finally {
                saveACL.mockRestore();
            }
        });

        it("lets only one of two concurrent creates for the same identifier succeed", async () => {
            const uid = uuid.v4();
            const [a, b] = await Promise.allSettled([
                repoUtils.create({ uid, name: "race-a" }, { user }),
                repoUtils.create({ uid, name: "race-b" }, { user }),
            ]);

            const results = [a, b];
            const fulfilled = results.filter((r) => r.status === "fulfilled");
            const rejected = results.filter((r) => r.status === "rejected");
            expect(fulfilled.length).toBe(1);
            expect(rejected.length).toBe(1);
            expect(rejected[0].reason?.status).toBe(400);

            const count = await itemRepo.count({ uid } as any);
            expect(count).toBe(1);
        });
    });

    describe("update()", () => {
        it("commits the new field values", async () => {
            const created = await repoUtils.create({ name: "original" }, { user });
            const updated = await repoUtils.update(
                { ...created, name: "updated", version: created.version },
                created,
                { user },
            );
            expect(updated.name).toBe("updated");

            const found = await itemRepo.findOne({ uid: created.uid } as any);
            expect(found?.name).toBe("updated");
        });

        it("rolls back the write when a downstream step fails inside the transaction", async () => {
            const created = await repoUtils.create({ name: "will-fail-update" }, { user });
            const sendMessage = vi
                .spyOn(repoUtils.notificationUtils, "sendMessage")
                .mockImplementationOnce(() => {
                    throw new Error("boom");
                });
            try {
                await expect(
                    repoUtils.update({ ...created, name: "should-not-persist", version: created.version }, created, {
                        user,
                    }),
                ).rejects.toThrow("boom");

                const found = await itemRepo.findOne({ uid: created.uid } as any);
                expect(found?.name).toBe("will-fail-update");
            } finally {
                sendMessage.mockRestore();
            }
        });
    });

    describe("delete()", () => {
        it("commits the entity and ACL removal atomically", async () => {
            const created = await repoUtils.create({ name: "to-delete" }, { user });
            await repoUtils.delete(created.uid, { user });

            expect(await itemRepo.findOne({ uid: created.uid } as any)).toBeNull();
            expect(await aclRepo.findOne({ uid: created.uid } as any)).toBeNull();
        });

        it("rolls back the entity deletion when the ACL removal fails partway through the transaction", async () => {
            const created = await repoUtils.create({ name: "should-survive-failed-delete" }, { user });
            const removeACL = vi.spyOn(repoUtils.aclUtils, "removeACL").mockRejectedValueOnce(new Error("boom"));
            try {
                await expect(repoUtils.delete(created.uid, { user })).rejects.toThrow("boom");

                // If delete() had silently fallen back to non-transactional execution, the entity delete
                // (which happens before the ACL removal) would already have committed.
                const found = await itemRepo.findOne({ uid: created.uid } as any);
                expect(found).toBeDefined();
            } finally {
                removeACL.mockRestore();
            }
        });
    });

    describe("truncate()", () => {
        it("commits the removal of every matching document", async () => {
            const marker = "truncate-" + uuid.v4();
            await repoUtils.create({ name: marker }, { user });
            await repoUtils.create({ name: marker }, { user });

            await repoUtils.truncate({ name: marker }, { user, ignoreACL: true });

            const count = await itemRepo.count({ name: marker } as any);
            expect(count).toBe(0);
        });

        it("rolls back the deletion when a downstream step fails inside the transaction", async () => {
            const marker = "truncate-fail-" + uuid.v4();
            await repoUtils.create({ name: marker }, { user });

            const sendMessage = vi
                .spyOn(repoUtils.notificationUtils, "sendMessage")
                .mockImplementationOnce(() => {
                    throw new Error("boom");
                });
            try {
                await expect(repoUtils.truncate({ name: marker }, { user, ignoreACL: true })).rejects.toThrow("boom");

                // If truncate() had silently fallen back to non-transactional execution, the deleteMany() call
                // (which happens before the push notification loop) would already have committed.
                const count = await itemRepo.count({ name: marker } as any);
                expect(count).toBe(1);
            } finally {
                sendMessage.mockRestore();
            }
        });
    });

    describe("nested @Transactional calls [ModelRoute -> RepoUtils]", () => {
        it("merges the route-level transaction with RepoUtils' own, opening only one real session", async () => {
            const conn: MongoConnection = connMgr.connections.get("acl") as MongoConnection;
            const startSessionSpy = vi.spyOn(conn, "startSession");
            try {
                const created = await route.doCreateObject({ name: "nested-create" }, { user });

                expect(startSessionSpy).toHaveBeenCalledTimes(1);
                const found = await itemRepo.findOne({ uid: created.uid } as any);
                expect(found).toBeDefined();
            } finally {
                startSessionSpy.mockRestore();
            }
        });

        it("rolls back the outer route call's write when the inner RepoUtils write fails, via the single merged transaction", async () => {
            const conn: MongoConnection = connMgr.connections.get("acl") as MongoConnection;
            const startSessionSpy = vi.spyOn(conn, "startSession");
            const saveACL = vi.spyOn(repoUtils.aclUtils, "saveACL").mockRejectedValueOnce(new Error("boom"));
            try {
                const name = "nested-rollback-" + uuid.v4();
                await expect(route.doCreateObject({ name }, { user })).rejects.toThrow("boom");

                // Only one session was ever opened - proves the rollback of the entity write (caused by the
                // ACL save failing) happened because both writes shared the *same* transaction, not because
                // two independent transactions both happened to fail.
                expect(startSessionSpy).toHaveBeenCalledTimes(1);
                const found = await itemRepo.findOne({ name } as any);
                expect(found).toBeNull();
            } finally {
                saveACL.mockRestore();
                startSessionSpy.mockRestore();
            }
        });

        it("merges doDelete's findOne + RepoUtils.delete + ACL removal into one transaction and rolls all of it back together", async () => {
            const created = await repoUtils.create({ name: "nested-delete-target-" + uuid.v4() }, { user });

            const conn: MongoConnection = connMgr.connections.get("acl") as MongoConnection;
            const startSessionSpy = vi.spyOn(conn, "startSession");
            const removeACL = vi.spyOn(repoUtils.aclUtils, "removeACL").mockRejectedValueOnce(new Error("boom"));
            try {
                await expect(route.doDelete(created.uid, { user })).rejects.toThrow("boom");

                expect(startSessionSpy).toHaveBeenCalledTimes(1);
                const found = await itemRepo.findOne({ uid: created.uid } as any);
                expect(found).toBeDefined();
            } finally {
                removeACL.mockRestore();
                startSessionSpy.mockRestore();
            }
        });

        it("TransactionalMode.CREATE opens a genuinely independent inner transaction that can roll back without affecting the outer one", async () => {
            const conn: MongoConnection = connMgr.connections.get("acl") as MongoConnection;
            const startSessionSpy = vi.spyOn(conn, "startSession");

            class NestedTxHarness {
                public modelClass = { datasource: "acl" };
                public _objectFactory = objectFactory;

                @Transactional()
                public async outer(outerName: string, innerName: string): Promise<{ innerError?: string }> {
                    await repoUtils.create({ name: outerName }, { user });
                    try {
                        await this.inner(innerName);
                        return {};
                    } catch (err: any) {
                        // Caught here (rather than left to propagate) specifically so the outer transaction
                        // commits regardless of the inner one's outcome - proving the two are independent.
                        return { innerError: err.message };
                    }
                }

                @Transactional(undefined, { mode: TransactionalMode.CREATE })
                public async inner(innerName: string): Promise<void> {
                    await repoUtils.create({ name: innerName }, { user });
                    throw new Error("boom");
                }
            }

            try {
                const outerName = "nested-create-mode-outer-" + uuid.v4();
                const innerName = "nested-create-mode-inner-" + uuid.v4();

                const result = await new NestedTxHarness().outer(outerName, innerName);

                expect(result.innerError).toBe("boom");
                expect(startSessionSpy).toHaveBeenCalledTimes(2);

                // The outer write committed even though the inner (independently-transacted) write rolled back.
                expect(await itemRepo.findOne({ name: outerName } as any)).toBeDefined();
                expect(await itemRepo.findOne({ name: innerName } as any)).toBeNull();
            } finally {
                startSessionSpy.mockRestore();
            }
        });
    });
});
