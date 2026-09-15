///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for RepoUtils.init()'s guard clauses — the full Mongo/SQL integration
// tests always have a healthy, fully-configured repo, so these error paths never trigger there.
import "reflect-metadata";
import * as typeorm from "typeorm";
import { RepoUtils } from "../src/models/RepoUtils";
import { MongoRepository } from "../src/database/MongoRepository";
import { ModelUtils } from "../src/models/ModelUtils";
import { RecoverableBaseEntity } from "../src/models/RecoverableBaseEntity";
import { RecoverableBaseMongoEntity } from "../src/models/RecoverableBaseMongoEntity";
import { transactionContext } from "../src/decorators/DatabaseDecorators";
import { ApiErrors } from "../src";
import { BaseMongoEntity } from "../src/models/BaseMongoEntity";
import { SimpleMongoEntity } from "../src/models/SimpleMongoEntity";
import { Column } from "../src/decorators/PersistenceDecorators";
import { AccessControlListMongo } from "../src/security/AccessControlListMongo";
import User from "./server/models/User";

describe("RepoUtils.init guard clauses", () => {
    it("throws when the model class has no @DataStore configured", async () => {
        class NoDataStoreModel {}
        const repoUtils: any = new RepoUtils(NoDataStoreModel);
        await expect(repoUtils.init()).rejects.toThrow("Did you forget to add @DataStore()");
    });

    it("throws when the ConnectionManager could not be retrieved", async () => {
        const repoUtils: any = new RepoUtils(User);
        repoUtils.connectionManager = undefined;
        await expect(repoUtils.init()).rejects.toThrow("Failed to retrieve ConnectionManager");
    });

    it("throws when no connection is registered for the model's datasource", async () => {
        const repoUtils: any = new RepoUtils(User);
        repoUtils.connectionManager = { connections: new Map() };
        await expect(repoUtils.init()).rejects.toThrow("No connection found for datasource 'mongodb'");
    });

    it("throws when the datasource connection has no repository for the class", async () => {
        const repoUtils: any = new RepoUtils(User);
        const fakeConn = { getRepository: () => undefined };
        repoUtils.connectionManager = { connections: new Map([["mongodb", fakeConn]]) };
        await expect(repoUtils.init()).rejects.toThrow("No repository found for class User");
    });
});

// Every data-access method starts with the same `if (!this.repo) throw INTERNAL_ERROR` guard, for the case
// where a caller uses a RepoUtils instance before init() has resolved its repository. The full Mongo/SQL
// integration tests always have a healthy repo by the time these methods run, so this never triggers there.
describe("RepoUtils methods without a configured repo", () => {
    const expectInternalError = async (promise: Promise<any>) => {
        await expect(promise).rejects.toMatchObject({ status: 500 });
    };

    it("count() throws", async () => {
        const repoUtils: any = new RepoUtils(User);
        await expectInternalError(repoUtils.count({}));
    });

    it("exists() throws", async () => {
        const repoUtils: any = new RepoUtils(User);
        await expectInternalError(repoUtils.exists("some-uid"));
    });

    it("create() throws", async () => {
        const repoUtils: any = new RepoUtils(User);
        await expectInternalError(repoUtils.create({}));
    });

    it("delete() throws", async () => {
        const repoUtils: any = new RepoUtils(User);
        await expectInternalError(repoUtils.delete("some-uid", {}));
    });

    it("find() throws", async () => {
        const repoUtils: any = new RepoUtils(User);
        await expectInternalError(repoUtils.find({}));
    });

    it("findOne() throws", async () => {
        const repoUtils: any = new RepoUtils(User);
        await expectInternalError(repoUtils.findOne("some-uid"));
    });

    it("truncate() throws", async () => {
        const repoUtils: any = new RepoUtils(User);
        await expectInternalError(repoUtils.truncate({}, {}));
    });

    it("update() throws", async () => {
        const repoUtils: any = new RepoUtils(User);
        await expectInternalError(repoUtils.update({}, {} as any));
    });
});

// count()'s query is built up-front by ModelUtils.buildSearchQuery() and only afterwards handed to the
// Mongo/SQL driver, so these exercise that hand-off directly against fake repos rather than a real database.
describe("RepoUtils.count()", () => {
    beforeAll(() => {
        ModelUtils.setTypeOrm(typeorm);
    });

    class RecoverableMongoItem extends RecoverableBaseMongoEntity {}
    class RecoverableVersionedMongoItem extends RecoverableBaseMongoEntity {}
    (RecoverableVersionedMongoItem as any).trackChanges = 0;
    class RecoverableSqlItem extends RecoverableBaseEntity {}

    it("passes the active transaction's session to a simple (non-aggregate) Mongo count query", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(3);
        const repoUtils: any = new RepoUtils(User, fakeRepo);
        const session = { id: "fake-session" };

        const result = await transactionContext.run({ session }, () => repoUtils.count({ uid: "u1" }));

        expect(fakeRepo.count).toHaveBeenCalledWith(expect.objectContaining({ uid: "u1" }), { session });
        expect(result).toBe(3);
    });

    it("runs against the active transaction's entityManager for a SQL count query", async () => {
        const fakeRepo: any = { count: vi.fn().mockResolvedValue(2) };
        const emRepo: any = { count: vi.fn().mockResolvedValue(5) };
        const entityManager: any = { getRepository: vi.fn().mockReturnValue(emRepo) };
        const repoUtils: any = new RepoUtils(User, fakeRepo);

        const result = await transactionContext.run({ entityManager }, () => repoUtils.count({ uid: "u1" }));

        expect(entityManager.getRepository).toHaveBeenCalledWith(User);
        expect(emRepo.count).toHaveBeenCalled();
        expect(fakeRepo.count).not.toHaveBeenCalled();
        expect(result).toBe(5);
    });

    it("excludes soft-deleted rows by default (simple Mongo query)", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(4);
        const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

        await repoUtils.count({ uid: "u1" });

        const [matchArg] = fakeRepo.count.mock.calls[0];
        expect(matchArg.deleted).toBe(false);
    });

    it("includes soft-deleted rows when includeDeleted is set (simple Mongo query)", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(4);
        const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

        await repoUtils.count({ uid: "u1" }, { includeDeleted: true });

        const [matchArg] = fakeRepo.count.mock.calls[0];
        expect(matchArg).not.toHaveProperty("deleted");
    });

    it("includes soft-deleted rows when includeDeleted is set (aggregate Mongo query for a trackChanges model)", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        const cursor: any = { next: vi.fn().mockResolvedValue({ count: 7 }) };
        fakeRepo.aggregate = vi.fn().mockReturnValue(cursor);
        const repoUtils: any = new RepoUtils(RecoverableVersionedMongoItem, fakeRepo);

        const result = await repoUtils.count({ uid: "u1" }, { includeDeleted: true });

        const [pipeline] = fakeRepo.aggregate.mock.calls[0];
        expect(pipeline[0].$match).not.toHaveProperty("deleted");
        expect(result).toBe(7);
    });

    it("includes soft-deleted rows when includeDeleted is set (SQL query)", async () => {
        const fakeRepo: any = { count: vi.fn().mockResolvedValue(2) };
        const repoUtils: any = new RepoUtils(RecoverableSqlItem, fakeRepo);

        await repoUtils.count({ uid: "u1" }, { includeDeleted: true });

        const [queryArg] = fakeRepo.count.mock.calls[0];
        expect(queryArg.where[0]).not.toHaveProperty("deleted");
    });
});

// findOne()/exists() otherwise never surface a soft-deleted RecoverableBaseEntity row by id - includeDeleted
// is the escape hatch an admin history/restore view needs to fetch (or check for) a specific past version.
describe("RepoUtils soft-delete visibility (includeDeleted)", () => {
    class RecoverableMongoItem extends RecoverableBaseMongoEntity {}

    describe("findOne()", () => {
        it("excludes a soft-deleted record by default", async () => {
            const deletedRecord = { uid: "u1", deleted: true, version: 0 };
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue(deletedRecord) });
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

            const result = await repoUtils.findOne("u1");
            expect(result).toBeUndefined();
        });

        it("returns a soft-deleted record when includeDeleted is set", async () => {
            const deletedRecord = { uid: "u1", deleted: true, version: 0 };
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue(deletedRecord) });
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

            const result = await repoUtils.findOne("u1", { includeDeleted: true });
            expect(result?.uid).toBe("u1");
            expect(result?.deleted).toBe(true);
        });

        it("still returns undefined for a record that doesn't exist at all, even with includeDeleted", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue(null) });
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

            const result = await repoUtils.findOne("missing", { includeDeleted: true });
            expect(result).toBeUndefined();
        });

        it("hides a soft-deleted record from a caller lacking DELETE+UPDATE permission, even with includeDeleted", async () => {
            const deletedRecord = { uid: "u1", deleted: true, version: 0 };
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue(deletedRecord) });
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);
            repoUtils.aclUtils = {
                enabled: true,
                findACL: vi.fn().mockResolvedValue(undefined),
                hasPermission: vi.fn().mockResolvedValue(false),
            };

            const result = await repoUtils.findOne("u1", { includeDeleted: true });
            expect(result).toBeUndefined();
        });

        it("returns a soft-deleted record to a caller with DELETE+UPDATE permission", async () => {
            const deletedRecord = { uid: "u1", deleted: true, version: 0 };
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue(deletedRecord) });
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);
            repoUtils.aclUtils = {
                enabled: true,
                findACL: vi.fn().mockResolvedValue(undefined),
                hasPermission: vi.fn().mockResolvedValue(true),
            };

            const result = await repoUtils.findOne("u1", { includeDeleted: true });
            expect(result?.uid).toBe("u1");
            expect(repoUtils.aclUtils.hasPermission).toHaveBeenCalledWith(undefined, repoUtils.defaultACLUid, "delete");
            expect(repoUtils.aclUtils.hasPermission).toHaveBeenCalledWith(undefined, repoUtils.defaultACLUid, "update");
        });
    });

    describe("exists()", () => {
        it("does not match a soft-deleted record's query by default", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValue(0);
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

            const result = await repoUtils.exists("u1");

            expect(result).toBe(0);
            const [query] = fakeRepo.count.mock.calls[0];
            expect(query.$or[0].deleted).toBe(false);
        });

        it("matches a soft-deleted record's query when includeDeleted is set", async () => {
            // The live (non-deleted) pass finds nothing; only the second, includeDeleted pass matches. No
            // aclUtils is configured on this bare RepoUtils, so the DELETE+UPDATE restore-permission gate is
            // skipped (treated as satisfied) and the second pass always runs.
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

            const result = await repoUtils.exists("u1", { includeDeleted: true });

            expect(result).toBe(1);
            expect(fakeRepo.count).toHaveBeenCalledTimes(2);
            const [liveQuery] = fakeRepo.count.mock.calls[0];
            expect(liveQuery.$or[0].deleted).toBe(false);
            const [deletedQuery] = fakeRepo.count.mock.calls[1];
            expect(deletedQuery.$or[0]).not.toHaveProperty("deleted");
        });

        it("does not run the includeDeleted pass at all when the live record is already found", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValue(1);
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

            const result = await repoUtils.exists("u1", { includeDeleted: true });

            expect(result).toBe(1);
            expect(fakeRepo.count).toHaveBeenCalledTimes(1);
        });

        it("does not surface a soft-deleted record to a caller lacking DELETE+UPDATE permission", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);
            repoUtils.aclUtils = {
                enabled: true,
                // Grants the ordinary EXISTS action (so the class-level gate at the top of exists() passes),
                // but not DELETE/UPDATE (the restore-permission gate for the includeDeleted pass).
                hasPermission: vi
                    .fn()
                    .mockImplementation(async (_user: any, _acl: any, action: string) => action === "exists"),
            };
            repoUtils.defaultACLUid = "default-acl";

            const result = await repoUtils.exists("u1", { includeDeleted: true });

            expect(result).toBe(0);
            // Only the live-record pass ran; the second pass was blocked by the failed permission check.
            expect(fakeRepo.count).toHaveBeenCalledTimes(1);
        });

        it("surfaces a soft-deleted record to a caller with DELETE+UPDATE permission", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);
            repoUtils.aclUtils = {
                enabled: true,
                hasPermission: vi.fn().mockResolvedValue(true),
            };
            repoUtils.defaultACLUid = "default-acl";

            const result = await repoUtils.exists("u1", { includeDeleted: true });

            expect(result).toBe(1);
            expect(fakeRepo.count).toHaveBeenCalledTimes(2);
            expect(repoUtils.aclUtils.hasPermission).toHaveBeenCalledWith(undefined, "default-acl", "delete");
            expect(repoUtils.aclUtils.hasPermission).toHaveBeenCalledWith(undefined, "default-acl", "update");
        });
    });

    describe("find()", () => {
        it("does not filter out live results when aclUtils is disabled/absent", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([{ uid: "u1", deleted: false }]),
            });
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

            const result = await repoUtils.find({});
            expect(result.length).toBe(1);
        });

        it("hides a soft-deleted result from a caller lacking DELETE+UPDATE permission (non-recordACL model)", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                    { uid: "live", deleted: false },
                    { uid: "gone", deleted: true },
                ]),
            });
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);
            repoUtils.aclUtils = {
                enabled: true,
                // Grants the ordinary LIST action (class-level gate) but not DELETE/UPDATE.
                hasPermission: vi
                    .fn()
                    .mockImplementation(async (_user: any, _acl: any, action: string) => action === "list"),
            };
            repoUtils.defaultACLUid = "default-acl";

            const result = await repoUtils.find({});

            expect(result.map((r: any) => r.uid)).toEqual(["live"]);
        });

        it("includes a soft-deleted result for a caller with DELETE+UPDATE permission (non-recordACL model)", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([
                    { uid: "live", deleted: false },
                    { uid: "gone", deleted: true },
                ]),
            });
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);
            repoUtils.aclUtils = { enabled: true, hasPermission: vi.fn().mockResolvedValue(true) };
            repoUtils.defaultACLUid = "default-acl";

            const result = await repoUtils.find({});

            expect(result.map((r: any) => r.uid).sort()).toEqual(["gone", "live"]);
            expect(repoUtils.aclUtils.hasPermission).toHaveBeenCalledWith(undefined, "default-acl", "delete");
            expect(repoUtils.aclUtils.hasPermission).toHaveBeenCalledWith(undefined, "default-acl", "update");
        });

        it("checks a soft-deleted result's own record ACL (not the class ACL) for a recordACL model", async () => {
            class RecoverableRecordACLItem extends RecoverableBaseMongoEntity {}
            (RecoverableRecordACLItem as any).recordACL = true;

            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({
                toArray: vi.fn().mockResolvedValue([{ uid: "gone", deleted: true }]),
            });
            const repoUtils: any = new RepoUtils(RecoverableRecordACLItem, fakeRepo);
            const hasPermission = vi.fn().mockResolvedValue(true);
            repoUtils.aclUtils = { enabled: true, hasPermission };

            const result = await repoUtils.find({});

            expect(result.map((r: any) => r.uid)).toEqual(["gone"]);
            // Checked against the record's own uid, not the (unset) class-level defaultACLUid.
            expect(hasPermission).toHaveBeenCalledWith(undefined, "gone", "delete");
            expect(hasPermission).toHaveBeenCalledWith(undefined, "gone", "update");
        });
    });

    describe("count()", () => {
        it("does not touch the query for an ordinary (non-?deleted=true) count", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValue(3);
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);
            repoUtils.aclUtils = { enabled: true, hasPermission: vi.fn().mockResolvedValue(true) };

            const result = await repoUtils.count({ uid: "u1" });

            expect(result).toBe(3);
            const [matchArg] = fakeRepo.count.mock.calls[0];
            expect(matchArg.deleted).toBe(false);
        });

        it("strips a client's ?deleted=true override and falls back to the live count for a caller lacking DELETE+UPDATE (non-recordACL)", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValue(9);
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);
            repoUtils.aclUtils = {
                enabled: true,
                // Grants the ordinary COUNT action (class-level gate) but not DELETE/UPDATE.
                hasPermission: vi
                    .fn()
                    .mockImplementation(async (_user: any, _acl: any, action: string) => action === "count"),
            };
            repoUtils.defaultACLUid = "default-acl";

            const result = await repoUtils.count({ uid: "u1", deleted: true });

            expect(result).toBe(9);
            const [matchArg] = fakeRepo.count.mock.calls[0];
            // The override was stripped back out, so the default exclusion applies again.
            expect(matchArg.deleted).toBe(false);
        });

        it("honors a client's ?deleted=true override for a caller with DELETE+UPDATE (non-recordACL)", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValue(9);
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);
            repoUtils.aclUtils = { enabled: true, hasPermission: vi.fn().mockResolvedValue(true) };
            repoUtils.defaultACLUid = "default-acl";

            const result = await repoUtils.count({ uid: "u1", deleted: true });

            expect(result).toBe(9);
            const [matchArg] = fakeRepo.count.mock.calls[0];
            expect(matchArg.deleted).toBe(true);
        });

        it("gates a recordACL model's ?deleted=true count by DELETE+UPDATE per uid instead of the ordinary action", async () => {
            class RecoverableRecordACLItem extends RecoverableBaseMongoEntity {}
            (RecoverableRecordACLItem as any).recordACL = true;

            const fakeRepo: any = Object.create(MongoRepository.prototype);
            // count() streams uids from a projected cursor (never `distinct`, never capped).
            fakeRepo.find = vi.fn().mockReturnValue(
                (async function* () {
                    yield { uid: "allowed" };
                    yield { uid: "denied" };
                })(),
            );
            fakeRepo.distinct = vi.fn();
            const repoUtils: any = new RepoUtils(RecoverableRecordACLItem, fakeRepo);
            const hasPermission = vi.fn().mockImplementation(async (_user: any, uid: string, action: string) => {
                if (action === "count") return true; // class-level gate at the top of count()
                if (uid === "allowed") return true;
                // "denied" has UPDATE but not DELETE - must not count as restorable.
                return action === "update";
            });
            repoUtils.aclUtils = { enabled: true, hasPermission };

            const result = await repoUtils.count({ uid: "u1", deleted: true });

            expect(result).toBe(1);
            expect(hasPermission).toHaveBeenCalledWith(undefined, "allowed", "delete");
            expect(hasPermission).toHaveBeenCalledWith(undefined, "allowed", "update");
            expect(hasPermission).toHaveBeenCalledWith(undefined, "denied", "delete");
            expect(fakeRepo.find).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ projection: { uid: 1 } }));
            expect(fakeRepo.distinct).not.toHaveBeenCalled();
        });

        it("counts every permitted record past a page and across permission batches, skipping duplicate versions", async () => {
            class TrackedRecordACLItem extends RecoverableBaseMongoEntity {}
            (TrackedRecordACLItem as any).recordACL = true;
            (TrackedRecordACLItem as any).trackChanges = true;

            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue(
                (async function* () {
                    for (let i = 0; i < 250; i++) {
                        yield { uid: `u${i}` };
                        // An older version of the same record.
                        yield { uid: `u${i}` };
                    }
                })(),
            );
            const repoUtils: any = new RepoUtils(TrackedRecordACLItem, fakeRepo);
            const hasPermission = vi.fn().mockImplementation(async (_user: any, uid: string) => uid !== "u7");
            repoUtils.aclUtils = { enabled: true, hasPermission };

            expect(await repoUtils.count({ limit: 10 })).toBe(249);
        });
    });
});

// A cache failure is a best-effort side effect and must never fail (or, under MongoDB's
// withTransaction() retry semantics, cause a retry of) the write it's attached to. These
// exercise every RepoUtils call site that fires a cache write without awaiting it.
describe("RepoUtils cache writes are fire-and-forget", () => {
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    beforeAll(() => {
        ModelUtils.setTypeOrm(typeorm);
    });

    it("create() still returns successfully when cache.save rejects", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(0);
        fakeRepo.save = vi.fn().mockImplementation(async (obj: any) => obj);
        const repoUtils: any = new RepoUtils(User, fakeRepo);
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };
        repoUtils.cache = { save: vi.fn().mockRejectedValue(new Error("cache down")) };

        const result = await repoUtils.create({ name: "u-create" }, { ignoreACL: true });
        expect(result).toBeDefined();

        await flush();
        // Only the latest-version entry: User doesn't keep versions.
        expect(repoUtils.cache.save).toHaveBeenCalledTimes(1);
        expect(repoUtils.logger.warn).toHaveBeenCalled();
    });

    it("delete() still returns successfully when cache.delete rejects", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.deleteMany = vi.fn().mockResolvedValue(undefined);
        const repoUtils: any = new RepoUtils(User, fakeRepo);
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };
        repoUtils.cache = { deleteMany: vi.fn().mockRejectedValue(new Error("cache down")) };

        await expect(repoUtils.delete("u1", { ignoreACL: true })).resolves.toBeUndefined();

        await flush();
        expect(repoUtils.cache.deleteMany).toHaveBeenCalledWith(["rec:latest:u1"]);
        expect(repoUtils.logger.warn).toHaveBeenCalled();
    });

    it("update() still returns successfully when cache.save rejects", async () => {
        const existing = new User({ uid: "u1", version: 0, name: "before" });
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.findOneAndUpdate = vi.fn().mockResolvedValue({ uid: "u1", version: 1, name: "after" });
        const repoUtils: any = new RepoUtils(User, fakeRepo);
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };
        repoUtils.cache = { save: vi.fn().mockRejectedValue(new Error("cache down")) };

        const result = await repoUtils.update({ uid: "u1", version: 0, name: "after" }, existing, { ignoreACL: true });
        expect(result).toBeDefined();

        await flush();
        expect(repoUtils.cache.save).toHaveBeenCalledTimes(1);
        expect(repoUtils.logger.warn).toHaveBeenCalled();
    });

    it("find() still returns results when the cache saves reject", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ uid: "u1" }]) });
        const repoUtils: any = new RepoUtils(User, fakeRepo);
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };
        repoUtils.cache = {
            load: vi.fn().mockResolvedValue(undefined),
            save: vi.fn().mockRejectedValue(new Error("cache down")),
            saveMany: vi.fn().mockRejectedValue(new Error("cache down")),
        };

        const result = await repoUtils.find({}, { ignoreACL: true });
        expect(result.length).toBe(1);

        await flush();
        expect(repoUtils.cache.save).toHaveBeenCalled();
        expect(repoUtils.cache.saveMany).toHaveBeenCalled();
        expect(repoUtils.logger.warn).toHaveBeenCalled();
    });

    it("findOne() still returns a result when cache.save rejects", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.find = vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue({ uid: "u1", version: 0 }) });
        const repoUtils: any = new RepoUtils(User, fakeRepo);
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };
        repoUtils.cache = {
            load: vi.fn().mockResolvedValue(undefined),
            save: vi.fn().mockRejectedValue(new Error("cache down")),
        };

        const result = await repoUtils.findOne("u1", { ignoreACL: true });
        expect(result?.uid).toBe("u1");

        await flush();
        expect(repoUtils.cache.save).toHaveBeenCalled();
        expect(repoUtils.logger.warn).toHaveBeenCalled();
    });
});

// A non-`trackChanges` `update()` guards against a lost optimistic-lock race with a conditional DB write
// (`updateOne({uid, version: V}, ...)` on Mongo / `repo.update({uid, version: V}, ...)` on SQL) - neither
// driver throws when that filter matches nothing (a concurrent writer already bumped the row past `V`), it
// just reports zero rows touched. Without checking that result, `update()` used to fall through to its own
// `findOne(uid, version: V + 1)` fallback lookup and silently return whatever it found there - the *other*
// writer's row - as if it were this call's own successful write, discarding the caller's edit with no error
// surfaced to anyone. Found via an adversarial concurrency review of activesync, a downstream consumer of
// this package, and fixed here since every entity's optimistic-concurrency guarantee depends on it.
describe("RepoUtils.update() detects a lost optimistic-lock race", () => {
    beforeAll(() => {
        ModelUtils.setTypeOrm(typeorm);
    });

    it("throws INVALID_OBJECT_VERSION when a Mongo findOneAndUpdate() matches no document (a concurrent writer won)", async () => {
        const existing = new User({ uid: "u1", version: 0, name: "before" });
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.findOneAndUpdate = vi.fn().mockResolvedValue(null);
        fakeRepo.findOne = vi.fn();
        const repoUtils: any = new RepoUtils(User, fakeRepo);

        await expect(
            repoUtils.update({ uid: "u1", version: 0, name: "after" }, existing, { ignoreACL: true }),
        ).rejects.toMatchObject({ code: ApiErrors.INVALID_OBJECT_VERSION, status: 409 });
        expect(fakeRepo.findOne).not.toHaveBeenCalled();
    });

    it("returns the document its own atomic findOneAndUpdate() produced, with no separate read-back", async () => {
        const existing = new User({ uid: "u1", version: 0, name: "before" });
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.findOneAndUpdate = vi.fn().mockResolvedValue({ uid: "u1", version: 1, name: "after" });
        // A read-back by (uid, version + 1) would miss here: a concurrent writer already moved on to version 2.
        fakeRepo.findOne = vi.fn().mockResolvedValue(null);
        const repoUtils: any = new RepoUtils(User, fakeRepo);

        const result = await repoUtils.update({ uid: "u1", version: 0, name: "after" }, existing, { ignoreACL: true });

        expect(result.version).toBe(1);
        expect(result.name).toBe("after");
        expect(fakeRepo.findOne).not.toHaveBeenCalled();
        const [filter, update, options] = fakeRepo.findOneAndUpdate.mock.calls[0];
        expect(filter).toEqual({ uid: "u1", version: 0 });
        expect(update.$set.version).toBe(1);
        expect(update.$set.dateModified).toBeInstanceOf(Date);
        expect(update.$set).not.toHaveProperty("_id");
        expect(options.returnDocument).toBe("after");
    });

    it("throws INVALID_OBJECT_VERSION when a SQL-backed repo.update() reports 0 affected rows (a concurrent writer won)", async () => {
        const existing = new User({ uid: "u1", version: 0, name: "before" });
        const fakeRepo: any = { update: vi.fn().mockResolvedValue({ affected: 0 }) };
        const repoUtils: any = new RepoUtils(User, fakeRepo);

        await expect(
            repoUtils.update({ uid: "u1", version: 0, name: "after" }, existing, { ignoreACL: true }),
        ).rejects.toMatchObject({ code: ApiErrors.INVALID_OBJECT_VERSION });
    });

    it("still succeeds when a SQL-backed repo.update() reports 1 affected row", async () => {
        const existing = new User({ uid: "u1", version: 0, name: "before" });
        const fakeRepo: any = {
            update: vi.fn().mockResolvedValue({ affected: 1 }),
            findOne: vi.fn().mockResolvedValue({ uid: "u1", version: 1, name: "after" }),
        };
        const repoUtils: any = new RepoUtils(User, fakeRepo);

        const result = await repoUtils.update({ uid: "u1", version: 0, name: "after" }, existing, { ignoreACL: true });

        expect(result.version).toBe(1);
    });

    it("does not throw when a SQL driver reports an ambiguous (undefined) affected count", async () => {
        // Not every TypeORM driver populates `affected` - treat "we don't know" as distinct from "definitely
        // zero" rather than rejecting a write the driver never actually told us failed.
        const existing = new User({ uid: "u1", version: 0, name: "before" });
        const fakeRepo: any = {
            update: vi.fn().mockResolvedValue({ affected: undefined }),
            findOne: vi.fn().mockResolvedValue({ uid: "u1", version: 1, name: "after" }),
        };
        const repoUtils: any = new RepoUtils(User, fakeRepo);

        const result = await repoUtils.update({ uid: "u1", version: 0, name: "after" }, existing, { ignoreACL: true });

        expect(result.version).toBe(1);
    });
});

// `ACLUtils.saveACL()`/`removeACL()` commit independently, on the `acl` connection's own transaction — they
// can't be rolled back by the entity-side transaction's own abort. RepoUtils compensates by registering a
// best-effort cleanup hook (via `registerRollbackHook`) against the active outer transaction. These tests run
// the decorated methods inside a manually-established `transactionContext` (rather than a real Mongo/SQL
// connection) so the registered hooks can be inspected and invoked directly, simulating "the outer transaction
// subsequently failed" without needing to fake a whole driver-level transaction.
describe("RepoUtils ACL compensating actions on transaction rollback", () => {
    class RecordACLItem extends RecoverableBaseMongoEntity {}
    (RecordACLItem as any).recordACL = true;

    const creator = { uid: "creator", roles: [] };

    it("create(): registers a hook that deletes a freshly-created ACL", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(0);
        fakeRepo.save = vi.fn().mockImplementation(async (obj: any) => obj);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const aclUtils = {
            enabled: true,
            isReservedUid: vi.fn().mockReturnValue(false),
            isProtectedACL: vi.fn().mockReturnValue(false),
            hasPermission: vi.fn().mockResolvedValue(true),
            findACL: vi.fn().mockResolvedValue(undefined),
            getRecord: vi.fn().mockReturnValue(undefined),
            saveACL: vi.fn().mockImplementation(async (acl: any) => acl),
            removeACL: vi.fn().mockResolvedValue(undefined),
        };
        repoUtils.aclUtils = aclUtils;
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };

        const onRollback: Array<() => Promise<void>> = [];
        const result = await transactionContext.run({ session: {}, datasource: "mongodb", onRollback }, () =>
            repoUtils.create({ name: "u-1" }, { user: creator }),
        );

        expect(aclUtils.saveACL).toHaveBeenCalledTimes(1);
        expect(onRollback.length).toBe(1);

        // Simulate the outer (entity-side) transaction subsequently failing.
        await onRollback[0]();
        expect(aclUtils.removeACL).toHaveBeenCalledWith(result.uid);
    });

    it("create(): refuses an existing ACL even when the creator already holds every creator right on it (no save, no hook)", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(0);
        fakeRepo.save = vi.fn().mockImplementation(async (obj: any) => obj);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const existingAcl: any = { uid: "existing-acl", records: [] };
        const aclUtils = {
            enabled: true,
            isReservedUid: vi.fn().mockReturnValue(false),
            isProtectedACL: vi.fn().mockReturnValue(false),
            hasPermission: vi.fn().mockResolvedValue(true),
            findACL: vi.fn().mockResolvedValue(existingAcl),
            getRecord: vi.fn().mockReturnValue(undefined),
            saveACL: vi.fn().mockImplementation(async (acl: any) => acl),
            removeACL: vi.fn().mockResolvedValue(undefined),
        };
        repoUtils.aclUtils = aclUtils;
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };

        const onRollback: Array<() => Promise<void>> = [];
        await expect(
            transactionContext.run({ session: {}, datasource: "mongodb", onRollback }, () =>
                repoUtils.create({ name: "u-1" }, { user: creator }),
            ),
        ).rejects.toMatchObject({ code: ApiErrors.IDENTIFIER_EXISTS, status: 400 });

        expect(aclUtils.saveACL).not.toHaveBeenCalled();
        expect(fakeRepo.save).not.toHaveBeenCalled();
        expect(existingAcl.records).toEqual([]);
        expect(onRollback.length).toBe(0);
    });

    it("create(): registers no rollback hook when trusted code adopts an existing ACL", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(0);
        fakeRepo.save = vi.fn().mockImplementation(async (obj: any) => obj);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const existingRecord = { userOrRoleId: "creator", actions: ["read"] };
        const existingAcl: any = { uid: "existing-acl", records: [existingRecord] };
        const aclUtils = {
            enabled: true,
            isReservedUid: vi.fn().mockReturnValue(false),
            isProtectedACL: vi.fn().mockReturnValue(false),
            hasPermission: vi.fn().mockResolvedValue(true),
            findACL: vi.fn().mockResolvedValue(existingAcl),
            getRecord: vi.fn().mockReturnValue(existingRecord), // creator already has a record
            saveACL: vi.fn().mockImplementation(async (acl: any) => acl),
            removeACL: vi.fn().mockResolvedValue(undefined),
        };
        repoUtils.aclUtils = aclUtils;

        const onRollback: Array<() => Promise<void>> = [];
        await transactionContext.run({ session: {}, datasource: "mongodb", onRollback }, () =>
            repoUtils.create({ name: "u-1" }, { user: creator, allowExistingACL: true }),
        );
        expect(aclUtils.saveACL).not.toHaveBeenCalled();

        expect(onRollback.length).toBe(0);
    });

    it("delete() purge: registers a hook that restores the removed ACL snapshot", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.deleteMany = vi.fn().mockResolvedValue(undefined);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const snapshot: any = { uid: "u1", records: [{ userOrRoleId: "owner", actions: ["read"] }] };
        const aclUtils = {
            enabled: true,
            isReservedUid: vi.fn().mockReturnValue(false),
            isProtectedACL: vi.fn().mockReturnValue(false),
            findACL: vi.fn().mockResolvedValue(snapshot), // used by delete()'s permission check
            hasPermission: vi.fn().mockResolvedValue(true),
            // removeACL() is now the sole (atomic) source of the restore snapshot - it returns exactly what
            // it deleted, rather than a separate, earlier findACL() read.
            removeACL: vi.fn().mockResolvedValue(snapshot),
            saveACL: vi.fn().mockResolvedValue(undefined),
        };
        repoUtils.aclUtils = aclUtils;
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };

        const onRollback: Array<() => Promise<void>> = [];
        await transactionContext.run({ session: {}, datasource: "mongodb", onRollback }, () =>
            repoUtils.delete("u1", { user: { uid: "owner", roles: [] }, purge: true }),
        );

        expect(aclUtils.removeACL).toHaveBeenCalledWith("u1", { unlessProtected: true });
        expect(onRollback.length).toBe(1);

        await onRollback[0]();
        expect(aclUtils.saveACL).toHaveBeenCalledWith(snapshot, { preserveVersion: true });
    });

    it("delete() purge: registers no rollback hook when the record had no ACL to begin with", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.deleteMany = vi.fn().mockResolvedValue(undefined);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const aclUtils = {
            enabled: true,
            isReservedUid: vi.fn().mockReturnValue(false),
            isProtectedACL: vi.fn().mockReturnValue(false),
            findACL: vi.fn().mockResolvedValue(undefined),
            hasPermission: vi.fn().mockResolvedValue(true),
            removeACL: vi.fn().mockResolvedValue(undefined),
            saveACL: vi.fn().mockResolvedValue(undefined),
        };
        repoUtils.aclUtils = aclUtils;

        const onRollback: Array<() => Promise<void>> = [];
        await transactionContext.run({ session: {}, datasource: "mongodb", onRollback }, () =>
            repoUtils.delete("u1", { user: { uid: "owner", roles: [] }, purge: true }),
        );

        expect(onRollback.length).toBe(0);
    });

    it("truncate(): registers a hook that batch-restores every removed ACL snapshot", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.distinct = vi.fn().mockResolvedValue(["u1", "u2"]);
        fakeRepo.deleteMany = vi.fn().mockResolvedValue(undefined);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const snapshots: Record<string, any> = {
            u1: { uid: "u1", records: [] },
            u2: { uid: "u2", records: [] },
        };
        const aclUtils = {
            enabled: true,
            isReservedUid: vi.fn().mockReturnValue(false),
            isProtectedACL: vi.fn().mockReturnValue(false),
            hasPermission: vi.fn().mockResolvedValue(true),
            // removeACLs() is now the sole (atomic) source of the restore snapshots - it returns exactly what
            // it deleted, rather than a separate, earlier batch of findACL() reads.
            removeACLs: vi.fn().mockResolvedValue([snapshots.u1, snapshots.u2]),
            saveACLs: vi.fn().mockResolvedValue(undefined),
        };
        repoUtils.aclUtils = aclUtils;
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };

        const onRollback: Array<() => Promise<void>> = [];
        await transactionContext.run({ session: {}, datasource: "mongodb", onRollback }, () =>
            repoUtils.truncate({}, { user: { uid: "u", roles: [] } }),
        );

        expect(aclUtils.removeACLs).toHaveBeenCalledWith(["u1", "u2"], { unlessProtected: true });
        expect(onRollback.length).toBe(1);

        await onRollback[0]();
        expect(aclUtils.saveACLs).toHaveBeenCalledWith([snapshots.u1, snapshots.u2]);
    });
});

// Write-path hardening found via an adversarial review of @rapidmx/restapi, a large downstream consumer that had to
// work around each of these itself. The real exploit scenarios are also covered end to end, against real MongoDB and
// SQL, in test/RepoUtils.WriteSafety.test.ts.
describe("RepoUtils write-path safety", () => {
    class RecordACLItem extends RecoverableBaseMongoEntity {}
    (RecordACLItem as any).recordACL = true;

    class DatedItem extends BaseMongoEntity {
        @Column()
        public when: Date = new Date(0);

        // Reflected as `Object` (a union), so only coerced because of the explicit column type.
        @Column({ type: "timestamptz" })
        public maybe: Date | null = null;

        @Column()
        public label: string = "";

        constructor(other?: any) {
            super(other);
            if (other) {
                this.when = "when" in other ? other.when : this.when;
                this.maybe = "maybe" in other ? other.maybe : this.maybe;
                this.label = "label" in other ? other.label : this.label;
            }
        }
    }

    class SimpleItem extends SimpleMongoEntity {
        public name: string = "";
    }

    const creator = { uid: "creator", roles: [] };

    const makeCreateRepo = () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(0);
        fakeRepo.save = vi.fn().mockImplementation(async (obj: any) => obj);
        return fakeRepo;
    };

    const makeAclUtils = (overrides: any = {}) => ({
        enabled: true,
        isReservedUid: vi.fn().mockReturnValue(false),
        isProtectedACL: vi.fn().mockReturnValue(false),
        hasPermission: vi.fn().mockResolvedValue(true),
        findACL: vi.fn().mockResolvedValue(undefined),
        getRecord: vi.fn().mockReturnValue(undefined),
        saveACL: vi.fn().mockImplementation(async (acl: any) => acl),
        removeACL: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    });

    beforeAll(() => {
        ModelUtils.setTypeOrm(typeorm);
    });

    describe("create()", () => {
        it("drops a caller-supplied _id and always inserts", async () => {
            const fakeRepo = makeCreateRepo();
            const repoUtils: any = new RepoUtils(User, fakeRepo);

            await repoUtils.create({ _id: "0123456789abcdef01234567", name: "u-id" }, { ignoreACL: true });

            const [saved, options] = fakeRepo.save.mock.calls[0];
            expect(saved._id).toBeUndefined();
            expect(options.insertOnly).toBe(true);
        });

        it("keeps the _id when trusted code passes preserveId, still insert-only", async () => {
            const fakeRepo = makeCreateRepo();
            const repoUtils: any = new RepoUtils(User, fakeRepo);

            await repoUtils.create(
                { _id: "0123456789abcdef01234567", name: "u-id" },
                { ignoreACL: true, preserveId: true },
            );

            const [saved, options] = fakeRepo.save.mock.calls[0];
            expect(String(saved._id)).toBe("0123456789abcdef01234567");
            expect(options.insertOnly).toBe(true);
        });

        it("discards a caller-supplied version, dateCreated and dateModified", async () => {
            const fakeRepo = makeCreateRepo();
            const repoUtils: any = new RepoUtils(User, fakeRepo);
            const before: number = Date.now();

            const result = await repoUtils.create(
                {
                    name: "u-forged",
                    version: 42,
                    dateCreated: "2001-01-01T00:00:00Z",
                    dateModified: "2001-01-01T00:00:00Z",
                },
                { ignoreACL: true },
            );

            expect(result.version).toBe(0);
            expect(new Date(result.dateCreated).getTime()).toBeGreaterThanOrEqual(before);
            expect(new Date(result.dateModified).getTime()).toBeGreaterThanOrEqual(before);
        });

        it("reports a duplicate key from the insert as IDENTIFIER_EXISTS", async () => {
            const fakeRepo = makeCreateRepo();
            fakeRepo.save = vi.fn().mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000 }));
            const repoUtils: any = new RepoUtils(User, fakeRepo);

            await expect(repoUtils.create({ name: "u-dup" }, { ignoreACL: true })).rejects.toMatchObject({
                code: ApiErrors.IDENTIFIER_EXISTS,
                status: 400,
            });
        });

        it("claims a fresh ACL insert-only, before the record is written", async () => {
            const fakeRepo = makeCreateRepo();
            const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
            const aclUtils = makeAclUtils();
            aclUtils.saveACL = vi.fn().mockImplementation(async (acl: any) => {
                expect(fakeRepo.save).not.toHaveBeenCalled();
                return acl;
            });
            repoUtils.aclUtils = aclUtils;

            const result = await repoUtils.create({}, { user: creator });

            expect(aclUtils.findACL).toHaveBeenCalledWith(result.uid, [], { skipCache: true, skipParents: true });
            const [acl, options] = aclUtils.saveACL.mock.calls[0];
            expect(options).toEqual({ createOnly: true });
            expect(acl.records).toEqual([
                { userOrRoleId: "creator", actions: expect.arrayContaining(["update", "delete"]) },
            ]);
        });

        it("refuses (IDENTIFIER_EXISTS) to adopt an existing ACL, writing nothing", async () => {
            const fakeRepo = makeCreateRepo();
            const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
            const foreignAcl: any = { uid: "victim", records: [{ userOrRoleId: "victim-owner", actions: ["*"] }] };
            const aclUtils = makeAclUtils({
                findACL: vi.fn().mockResolvedValue(foreignAcl),
                // The creator can read the foreign record, but not e.g. delete it.
                hasPermission: vi
                    .fn()
                    .mockImplementation(async (_u: any, _a: any, action: string) => action === "read"),
            });
            repoUtils.aclUtils = aclUtils;

            await expect(repoUtils.create({ uid: "victim" }, { user: creator, ignoreACL: true })).rejects.toMatchObject(
                {
                    code: ApiErrors.IDENTIFIER_EXISTS,
                    status: 400,
                },
            );
            expect(fakeRepo.save).not.toHaveBeenCalled();
            expect(aclUtils.saveACL).not.toHaveBeenCalled();
            expect(foreignAcl.records.length).toBe(1);
        });

        it("reuses an existing ACL unchanged only when trusted code passes allowExistingACL, not for a trusted role", async () => {
            {
                const fakeRepo = makeCreateRepo();
                const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
                repoUtils.aclUtils = makeAclUtils({ findACL: vi.fn().mockResolvedValue({ uid: "shared", records: [] }) });
                await expect(
                    repoUtils.create({ uid: "shared" }, { user: { uid: "root", roles: ["admin"] }, ignoreACL: true }),
                ).rejects.toMatchObject({ code: ApiErrors.IDENTIFIER_EXISTS, status: 400 });
                expect(fakeRepo.save).not.toHaveBeenCalled();
            }
            for (const [user, options] of [
                [{ uid: "root", roles: ["admin"] }, { allowExistingACL: true }],
                [creator, { allowExistingACL: true }],
            ] as any[]) {
                const fakeRepo = makeCreateRepo();
                const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
                const existingAcl: any = { uid: "shared", records: [] };
                const aclUtils = makeAclUtils({
                    findACL: vi.fn().mockResolvedValue(existingAcl),
                    hasPermission: vi.fn().mockResolvedValue(false),
                });
                repoUtils.aclUtils = aclUtils;

                await repoUtils.create({ uid: "shared" }, { user, ignoreACL: true, ...options });

                expect(fakeRepo.save).toHaveBeenCalledTimes(1);
                expect(aclUtils.saveACL).not.toHaveBeenCalled();
                expect(existingAcl.records).toEqual([]);
            }
        });

        it("reuses the existing ACL unchanged for a trackChanges new version (never adds the creator to it)", async () => {
            class VersionedRecordACLItem extends RecoverableBaseMongoEntity {}
            (VersionedRecordACLItem as any).recordACL = true;
            (VersionedRecordACLItem as any).trackChanges = -1;
            const fakeRepo = makeCreateRepo();
            fakeRepo.count = vi.fn().mockResolvedValue(1);
            const repoUtils: any = new RepoUtils(VersionedRecordACLItem, fakeRepo);
            const existingAcl: any = { uid: "doc", records: [{ userOrRoleId: "editors", actions: ["update"] }] };
            const aclUtils = makeAclUtils({ findACL: vi.fn().mockResolvedValue(existingAcl) });
            repoUtils.aclUtils = aclUtils;

            const result = await repoUtils.create({ uid: "doc" }, { user: { uid: "editor", roles: ["editors"] } });

            expect(result.version).toBe(1);
            expect(aclUtils.saveACL).not.toHaveBeenCalled();
            expect(existingAcl.records).toEqual([{ userOrRoleId: "editors", actions: ["update"] }]);
        });

        it("removes the freshly claimed ACL when the record write fails, logging if that removal fails too", async () => {
            const fakeRepo = makeCreateRepo();
            fakeRepo.save = vi.fn().mockRejectedValue(new Error("write failed"));
            const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
            const aclUtils = makeAclUtils();
            repoUtils.aclUtils = aclUtils;
            repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };

            await expect(repoUtils.create({ uid: "fresh" }, { user: creator })).rejects.toThrow("write failed");
            expect(aclUtils.removeACL).toHaveBeenCalledWith("fresh");
            expect(repoUtils.logger.warn).not.toHaveBeenCalled();

            aclUtils.removeACL = vi.fn().mockRejectedValue(new Error("acl down"));
            await expect(repoUtils.create({ uid: "fresh2" }, { user: creator })).rejects.toThrow("write failed");
            expect(repoUtils.logger.warn).toHaveBeenCalled();
        });

        it("coerces Date-typed properties to dates, and rejects an invalid date with a 400", async () => {
            const fakeRepo = makeCreateRepo();
            const repoUtils: any = new RepoUtils(DatedItem, fakeRepo);

            const result = await repoUtils.create(
                { when: "2026-01-02T03:04:05.000Z", maybe: 1767225600000, label: "2026-01-02" },
                { ignoreACL: true },
            );
            const [saved] = fakeRepo.save.mock.calls[0];
            expect(saved.when).toBeInstanceOf(Date);
            expect(saved.when.toISOString()).toBe("2026-01-02T03:04:05.000Z");
            expect(saved.maybe).toBeInstanceOf(Date);
            expect(saved.label).toBe("2026-01-02"); // not a date column
            expect(result.when).toBeInstanceOf(Date);

            for (const bad of ["not a date", "   "]) {
                await expect(repoUtils.create({ when: bad }, { ignoreACL: true })).rejects.toMatchObject({
                    code: ApiErrors.INVALID_REQUEST,
                    status: 400,
                });
            }
        });
    });

    describe("update()", () => {
        it.each([["aliases.3"], ["$inc"], ["$where"]])("rejects the path/operator key %s with a 400", async (key) => {
            const existing = new User({ uid: "u1", version: 0, name: "before" });
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.findOneAndUpdate = vi.fn();
            const repoUtils: any = new RepoUtils(User, fakeRepo);

            await expect(
                repoUtils.update({ uid: "u1", version: 0, [key]: "x" }, existing, { ignoreACL: true }),
            ).rejects.toMatchObject({ code: ApiErrors.INVALID_REQUEST, status: 400 });
            expect(fakeRepo.findOneAndUpdate).not.toHaveBeenCalled();
        });

        it("enforces the optimistic lock for a plain (non-instance) existing document carrying a version", async () => {
            const existing: any = { uid: "u1", version: 3, name: "before", dateCreated: new Date(0) };
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.findOneAndUpdate = vi.fn().mockResolvedValue({ uid: "u1", version: 4, name: "after" });
            const repoUtils: any = new RepoUtils(User, fakeRepo);

            await expect(
                repoUtils.update({ uid: "u1", version: 2, name: "after" }, existing, { ignoreACL: true }),
            ).rejects.toMatchObject({ code: ApiErrors.INVALID_OBJECT_VERSION, status: 409 });

            const result = await repoUtils.update(
                { uid: "u1", version: 3, name: "after", dateCreated: new Date() },
                existing,
                { ignoreACL: true },
            );
            expect(result.version).toBe(4);
            const [filter, update] = fakeRepo.findOneAndUpdate.mock.calls[0];
            expect(filter).toEqual({ uid: "u1", version: 3 });
            expect(update.$set.version).toBe(4);
            expect(update.$set.dateModified).toBeInstanceOf(Date);
            expect(update.$set.dateCreated).toEqual(new Date(0));
        });

        it("takes _id from the stored record, never from the input", async () => {
            const storedId = "aaaaaaaaaaaaaaaaaaaaaaaa";
            const existing: any = { _id: storedId, uid: "u1", version: 0, name: "before" };
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.save = vi.fn().mockImplementation(async (x: any) => x);
            const repoUtils: any = new RepoUtils(User, fakeRepo);

            // The (id-less) fallback branch saves the whole object - by the stored `_id`, not the input's.
            const obj: any = { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", version: 0 };
            existing.uid = undefined;
            existing.version = undefined;
            await repoUtils.update(obj, existing, { ignoreACL: true });
            expect(fakeRepo.save.mock.calls[0][0]._id).toBe(storedId);

            // No stored `_id` at all (e.g. a SQL row): the input's is dropped.
            const sqlRepo: any = {
                update: vi.fn().mockResolvedValue({ affected: 1 }),
                findOne: vi.fn().mockResolvedValue({ uid: "u1", version: 1 }),
            };
            const sqlUtils: any = new RepoUtils(User, sqlRepo);
            await sqlUtils.update(
                { _id: "bbbbbbbbbbbbbbbbbbbbbbbb", uid: "u1", version: 0 },
                { uid: "u1", version: 0 },
                { ignoreACL: true },
            );
            expect(sqlRepo.update.mock.calls[0][1]).not.toHaveProperty("_id");
        });

        it("reports a 404 when an unversioned Mongo record vanished before its atomic update", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.findOneAndUpdate = vi.fn().mockResolvedValueOnce(null);
            const repoUtils: any = new RepoUtils(SimpleItem, fakeRepo);

            await expect(
                repoUtils.update({ uid: "s1", name: "x" }, new SimpleItem({ uid: "s1" }), { ignoreACL: true }),
            ).rejects.toMatchObject({ code: ApiErrors.NOT_FOUND, status: 404 });

            fakeRepo.findOneAndUpdate = vi.fn().mockResolvedValueOnce({ uid: "s1", name: "x" });
            const result = await repoUtils.update({ uid: "s1", name: "x" }, new SimpleItem({ uid: "s1" }), {
                ignoreACL: true,
            });
            expect(result.uid).toBe("s1");
        });

        it("coerces Date-typed properties on update too", async () => {
            const existing = new DatedItem({ uid: "d1", version: 0 });
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.findOneAndUpdate = vi
                .fn()
                .mockImplementation(async (_f: any, u: any) => ({ uid: "d1", ...u.$set }));
            const repoUtils: any = new RepoUtils(DatedItem, fakeRepo);

            await repoUtils.update({ uid: "d1", version: 0, when: "2026-05-06T00:00:00Z" }, existing, {
                ignoreACL: true,
            });
            expect(fakeRepo.findOneAndUpdate.mock.calls[0][1].$set.when).toBeInstanceOf(Date);

            await expect(
                repoUtils.update({ uid: "d1", version: 0, when: "yesterday-ish" }, existing, { ignoreACL: true }),
            ).rejects.toMatchObject({ code: ApiErrors.INVALID_REQUEST, status: 400 });
        });
    });
});

// Unit-level coverage for the ACL ownership, caching, notification, date and duplicate-key fixes. The exploit scenarios
// themselves run end to end, against real MongoDB and SQL, in test/RepoUtils.CacheAndACL.test.ts.
class RecoverableItemMongo extends RecoverableBaseMongoEntity {}

describe("RepoUtils ACL ownership, caching and input hardening", () => {
    const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

    class DateItem extends BaseMongoEntity {
        @Column()
        public when: Date = new Date(0);

        @Column({ type: "date" })
        public day: string = "";

        constructor(other?: any) {
            super(other);
            if (other) {
                this.when = "when" in other ? other.when : this.when;
                this.day = "day" in other ? other.day : this.day;
            }
        }
    }

    beforeAll(() => {
        ModelUtils.setTypeOrm(typeorm);
    });

    describe("date input", () => {
        const mongoUtils = (): any => new RepoUtils(DateItem, Object.create(MongoRepository.prototype));

        it.each([
            ["2026-09-14T10:00", "2026-09-14T10:00:00.000Z"],
            ["2026-09-14 10:00:30", "2026-09-14T10:00:30.000Z"],
            ["2026-09-14T10:00:30.123456Z", "2026-09-14T10:00:30.123Z"],
            ["2026-09-14T10:00:30.5+0530", "2026-09-14T04:30:30.500Z"],
            ["2026-09-14T10:00-07", "2026-09-14T17:00:00.000Z"],
            ["2026-09-14T10:00+02:00", "2026-09-14T08:00:00.000Z"],
            ["2026-09-14", "2026-09-14T00:00:00.000Z"],
            ["0050-01-01", "0050-01-01T00:00:00.000Z"],
            [1726000000000, "2024-09-10T20:26:40.000Z"],
            [-100000000000, "1966-10-31T14:13:20.000Z"],
        ])("accepts %s", (input, iso) => {
            const obj: any = { when: input };
            mongoUtils().coerceDateProperties(obj, DateItem);
            expect(obj.when).toBeInstanceOf(Date);
            expect(obj.when.toISOString()).toBe(iso);
        });

        it.each([
            [1726000000], // epoch seconds
            ["1726000000000"], // numeric string
            ["1"],
            [0],
            [NaN],
            [Infinity],
            [253402300800000], // after 9999-12-31
            ["2026-02-30"],
            ["2026-13-01"],
            ["2026-09-14T24:00"],
            ["2026-09-14T10:60"],
            ["2026-09-14T10:00:61Z"],
            ["2026-09-14T10:00+5"],
            ["Sep 14 2026"],
            [" 2026-09-14"],
            [""],
            [true],
            [{}],
        ])("rejects %s with a 400", (input) => {
            expect(() => mongoUtils().coerceDateProperties({ when: input }, DateItem)).toThrow(
                expect.objectContaining({ code: ApiErrors.INVALID_REQUEST, status: 400 }),
            );
        });

        it("leaves Date, null and undefined values alone, and ignores a missing object or class", () => {
            const date: Date = new Date();
            const obj: any = { when: date, day: null };
            mongoUtils().coerceDateProperties(obj, DateItem);
            expect(obj.when).toBe(date);
            expect(obj.day).toBeNull();
            expect(() => mongoUtils().coerceDateProperties(undefined, DateItem)).not.toThrow();
            expect(() => mongoUtils().coerceDateProperties({}, undefined)).not.toThrow();
        });

        it("keeps a SQL date-only value as a validated YYYY-MM-DD string, but converts it on MongoDB", () => {
            const sqlUtils: any = new RepoUtils(DateItem, {} as any);
            const sqlObj: any = { day: "2026-09-14" };
            sqlUtils.coerceDateProperties(sqlObj, DateItem);
            expect(sqlObj.day).toBe("2026-09-14");
            for (const bad of ["2026-09-14T00:00:00Z", 1789344000000, "2026-02-29"]) {
                expect(() => sqlUtils.coerceDateProperties({ day: bad }, DateItem)).toThrow(
                    expect.objectContaining({ status: 400, message: expect.stringContaining("YYYY-MM-DD") }),
                );
            }

            const mongoObj: any = { day: "2026-09-14" };
            mongoUtils().coerceDateProperties(mongoObj, DateItem);
            expect(mongoObj.day).toEqual(new Date("2026-09-14T00:00:00Z"));
        });
    });

    describe("create() on SQL", () => {
        it("inserts instead of saving, and maps a SQL duplicate key to IDENTIFIER_EXISTS", async () => {
            const sqlRepo: any = { count: vi.fn().mockResolvedValue(0), insert: vi.fn().mockResolvedValue({}) };
            const repoUtils: any = new RepoUtils(User, sqlRepo);

            const created = await repoUtils.create({ name: "sql-u" }, { ignoreACL: true });
            expect(sqlRepo.insert).toHaveBeenCalledTimes(1);
            expect(created.name).toBe("sql-u");

            for (const err of [
                { code: "23505" },
                { code: "ER_DUP_ENTRY" },
                { driverError: { code: "SQLITE_CONSTRAINT_PRIMARYKEY" } },
            ]) {
                sqlRepo.insert = vi.fn().mockRejectedValue(Object.assign(new Error("dup"), err));
                await expect(repoUtils.create({ name: "sql-u" }, { ignoreACL: true })).rejects.toMatchObject({
                    code: ApiErrors.IDENTIFIER_EXISTS,
                    status: 400,
                });
            }
        });
    });

    describe("record ACL ownership", () => {
        class OwnedItem extends RecoverableBaseMongoEntity {}
        (OwnedItem as any).recordACL = true;

        const makeAclUtils = (overrides: any = {}): any => ({
            enabled: true,
            isReservedUid: vi.fn().mockReturnValue(false),
            isProtectedACL: vi.fn().mockReturnValue(false),
            hasPermission: vi.fn().mockResolvedValue(true),
            findACL: vi.fn().mockResolvedValue(undefined),
            getRecord: vi.fn().mockReturnValue(undefined),
            saveACL: vi.fn().mockImplementation(async (acl: any) => acl),
            removeACL: vi.fn().mockResolvedValue(undefined),
            ...overrides,
        });

        it("refuses a reserved uid before reading any ACL, and a protected existing ACL even for a new version", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValue(0);
            fakeRepo.save = vi.fn();
            const repoUtils: any = new RepoUtils(OwnedItem, fakeRepo);
            repoUtils.aclUtils = makeAclUtils({ isReservedUid: vi.fn().mockReturnValue(true) });
            await expect(repoUtils.create({ uid: "OwnedItem" }, { user: { uid: "u" } })).rejects.toMatchObject({
                code: ApiErrors.IDENTIFIER_EXISTS,
            });
            expect(repoUtils.aclUtils.findACL).not.toHaveBeenCalled();

            (OwnedItem as any).trackChanges = -1;
            try {
                fakeRepo.count = vi.fn().mockResolvedValue(1);
                repoUtils.aclUtils = makeAclUtils({
                    findACL: vi.fn().mockResolvedValue({ uid: "route", parentUid: "default_route", records: [] }),
                    isProtectedACL: vi.fn().mockReturnValue(true),
                });
                await expect(repoUtils.create({ uid: "route" }, { user: { uid: "u" } })).rejects.toMatchObject({
                    code: ApiErrors.IDENTIFIER_EXISTS,
                });
                expect(fakeRepo.save).not.toHaveBeenCalled();
            } finally {
                delete (OwnedItem as any).trackChanges;
            }
        });

        it("keeps the ACL when purging one version leaves other versions of the record", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.deleteMany = vi.fn().mockResolvedValue(undefined);
            fakeRepo.count = vi.fn().mockResolvedValue(2);
            const repoUtils: any = new RepoUtils(OwnedItem, fakeRepo);
            repoUtils.aclUtils = makeAclUtils();

            await repoUtils.delete("u1", { ignoreACL: true, purge: true, version: "1" });
            expect(repoUtils.aclUtils.removeACL).not.toHaveBeenCalled();

            fakeRepo.count = vi.fn().mockResolvedValue(0);
            await repoUtils.delete("u1", { ignoreACL: true, purge: true, version: "2" });
            expect(repoUtils.aclUtils.removeACL).toHaveBeenCalledWith("u1", { unlessProtected: true });
        });
    });

    describe("update() duplicate keys", () => {
        it("maps a duplicate unique column to 400 and an identity clash to 409, passing other errors through", async () => {
            const existing = new User({ uid: "u1", version: 0, name: "before" });
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            const repoUtils: any = new RepoUtils(User, fakeRepo);
            const update = () => repoUtils.update({ uid: "u1", version: 0, name: "x" }, existing, { ignoreACL: true });
            const dup = (extra: any = {}) => Object.assign(new Error("E11000"), { code: 11000, ...extra });

            fakeRepo.findOneAndUpdate = vi.fn().mockRejectedValue(dup({ keyPattern: { name: 1 } }));
            await expect(update()).rejects.toMatchObject({ code: ApiErrors.IDENTIFIER_EXISTS, status: 400 });

            fakeRepo.findOneAndUpdate = vi.fn().mockRejectedValue(dup({ keyPattern: { uid: 1, version: 1 } }));
            await expect(update()).rejects.toMatchObject({ code: ApiErrors.INVALID_OBJECT_VERSION, status: 409 });

            // No field information: an in-place update defaults to 400.
            fakeRepo.findOneAndUpdate = vi.fn().mockRejectedValue(dup());
            await expect(update()).rejects.toMatchObject({ code: ApiErrors.IDENTIFIER_EXISTS, status: 400 });

            fakeRepo.findOneAndUpdate = vi.fn().mockRejectedValue(new Error("network"));
            await expect(update()).rejects.toThrow("network");
        });

        it("maps an unidentified duplicate key on a SQL trackChanges insert to 409", async () => {
            class SqlVersioned extends RecoverableBaseEntity {}
            (SqlVersioned as any).trackChanges = -1;
            const sqlRepo: any = {
                findOne: vi.fn().mockResolvedValue(null),
                insert: vi.fn().mockRejectedValue(Object.assign(new Error("dup"), { code: "23505" })),
            };
            const repoUtils: any = new RepoUtils(SqlVersioned, sqlRepo);
            await expect(
                repoUtils.update({ uid: "v1", version: 0 }, { uid: "v1", version: 0 }, { ignoreACL: true }),
            ).rejects.toMatchObject({ code: ApiErrors.INVALID_OBJECT_VERSION, status: 409 });
        });
    });

    describe("update() with a read-only field missing from existing", () => {
        class GuardedItem extends BaseMongoEntity {
            public secretFlag: string = "";
        }
        Reflect.defineMetadata("rrst:readOnly", true, GuardedItem.prototype, "secretFlag");
        Object.defineProperty(GuardedItem.prototype, "secretFlag", {
            enumerable: true,
            writable: true,
            value: undefined,
        });

        it("leaves it out of an in-place update", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.findOneAndUpdate = vi
                .fn()
                .mockImplementation(async (_f: any, u: any) => ({ uid: "g1", ...u.$set }));
            const repoUtils: any = new RepoUtils(GuardedItem, fakeRepo);
            const existing: any = { uid: "g1", version: 0 }; // secretFlag stripped

            await repoUtils.update({ uid: "g1", version: 0, secretFlag: "forged" }, existing, { ignoreACL: true });
            expect(fakeRepo.findOneAndUpdate.mock.calls[0][1].$set).not.toHaveProperty("secretFlag");
        });

        it("takes it from the stored record for a SQL trackChanges version, or leaves it out when unreadable", async () => {
            class SqlGuarded extends GuardedItem {}
            (SqlGuarded as any).trackChanges = -1;
            const sqlRepo: any = {
                findOne: vi
                    .fn()
                    .mockResolvedValueOnce({ uid: "g1", version: 0, secretFlag: "stored" })
                    .mockResolvedValueOnce({ uid: "g1", version: 1, secretFlag: "stored" }),
                insert: vi.fn().mockResolvedValue({}),
            };
            const repoUtils: any = new RepoUtils(SqlGuarded, sqlRepo);

            await repoUtils.update(
                { uid: "g1", version: 0, secretFlag: "forged" },
                { uid: "g1", version: 0 },
                { ignoreACL: true },
            );
            expect(sqlRepo.insert.mock.calls[0][0].secretFlag).toBe("stored");

            sqlRepo.findOne = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ uid: "g1", version: 1 });
            sqlRepo.insert.mockClear();
            await repoUtils.update(
                { uid: "g1", version: 0, secretFlag: "forged" },
                { uid: "g1", version: 0 },
                { ignoreACL: true },
            );
            expect(sqlRepo.insert.mock.calls[0][0]).not.toHaveProperty("secretFlag");
        });
    });

    describe("queryIncludesDeleted()", () => {
        class SqlRecoverable extends RecoverableBaseEntity {}
        const { And, Equal, Not } = typeorm;

        it.each([
            [{ where: [{ deleted: false }] }, false],
            [{ where: [{ deleted: Equal(false) }, { deleted: false }] }, false],
            [{ where: [{ deleted: And(Equal(true), Equal(false)) }] }, false],
            [{ where: [{ deleted: false }, { deleted: Equal(true) }] }, true],
            [{ where: [{ deleted: Not(false) }] }, true],
            [{ where: [{ deleted: And(Equal(true)) }] }, true],
            [{ where: [{ deleted: "false" }] }, true],
            [{ where: [] }, true],
            [{ take: 100 }, true],
        ])("SQL %o -> %s", (searchQuery, expected) => {
            const repoUtils: any = new RepoUtils(SqlRecoverable, {} as any);
            expect(repoUtils.queryIncludesDeleted(searchQuery)).toBe(expected);
        });

        it.each([
            [{ $match: { deleted: false } }, false],
            [{ $match: { deleted: { $eq: false } } }, false],
            [[{ $match: { $or: [{ deleted: false }, { deleted: { $eq: false } }] } }], false],
            [{ $match: { $and: [{ a: 1 }, { deleted: false }] } }, false],
            [{ $match: { $or: [] } }, true],
            [{ $match: { deleted: { $eq: false, $ne: true } } }, true],
            [{ $match: { deleted: { $ne: false } } }, true],
            [{ deleted: false }, false],
            [[{}], true],
        ])("MongoDB %o -> %s", (searchQuery, expected) => {
            const repoUtils: any = new RepoUtils(RecoverableItemMongo, Object.create(MongoRepository.prototype));
            expect(repoUtils.queryIncludesDeleted(searchQuery)).toBe(expected);
        });

        it("is always false for a model that isn't recoverable", () => {
            const repoUtils: any = new RepoUtils(User, Object.create(MongoRepository.prototype));
            expect(repoUtils.queryIncludesDeleted({ $match: {} })).toBe(false);
        });
    });

    describe("cache", () => {
        const makeCache = (): any => {
            const store: Map<string, any> = new Map();
            return {
                store,
                load: vi.fn(async (k: string) => store.get(k)),
                loadMany: vi.fn(async (ks: string[]) => ks.map((k) => store.get(k))),
                save: vi.fn(async (k: string, v: any) => void store.set(k, v)),
                saveMany: vi.fn(async (ks: string[], vs: any[]) => ks.forEach((k, i) => store.set(k, vs[i]))),
                deleteMany: vi.fn(async (ks: string[]) => ks.forEach((k) => store.delete(k))),
            };
        };

        it("never caches a specific version of a model whose versions are updated in place", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({ next: vi.fn().mockResolvedValue({ uid: "u1", version: 3 }) });
            const repoUtils: any = new RepoUtils(User, fakeRepo);
            repoUtils.cache = makeCache();

            await repoUtils.findOne("u1", { version: "3", ignoreACL: true });
            expect(repoUtils.cache.load).not.toHaveBeenCalled();
            expect(repoUtils.cache.save).not.toHaveBeenCalled();
        });

        it("ignores malformed or mismatched cached list entries", async () => {
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([]) });
            const repoUtils: any = new RepoUtils(User, fakeRepo);
            const cache: any = makeCache();
            repoUtils.cache = cache;

            const key: string = repoUtils.queryCacheKey({ query: { limit: 100, page: 0 }, user: undefined });
            cache.store.set(key, [["a", null], "junk", ["b", null]]);
            cache.store.set("rec:latest:a", { uid: "not-a" });
            expect(await repoUtils.find({}, { ignoreACL: true })).toEqual([]);
            expect(fakeRepo.find).toHaveBeenCalled();

            cache.store.set(key, "junk");
            expect(await repoUtils.loadCachedResults(key)).toEqual([]);
            expect(repoUtils.matchesId(undefined, "a")).toBe(false);
            expect(repoUtils.matchesId({ uid: "a", version: 1 }, "a", 2)).toBe(false);
            expect(repoUtils.copyRecord(null)).toBeNull();
        });

        it("references versions of a trackChanges model by version, and drops them all on truncate [SQL]", async () => {
            class SqlTracked extends RecoverableBaseEntity {}
            (SqlTracked as any).trackChanges = -1;
            const rows: any[] = [
                { uid: "t1", version: 0 },
                { uid: "t1", version: 1 },
            ];
            const sqlRepo: any = {
                find: vi.fn().mockResolvedValue(rows),
                delete: vi.fn().mockResolvedValue({}),
            };
            const repoUtils: any = new RepoUtils(SqlTracked, sqlRepo);
            const cache: any = makeCache();
            repoUtils.cache = cache;

            repoUtils.cacheResults("q:x", [...rows, { version: 5 }]);
            await flush();
            expect(cache.store.get("q:x")).toEqual([
                ["t1", 0],
                ["t1", 1],
            ]);
            expect(cache.store.has("rec:v0:t1")).toBe(true);

            await repoUtils.truncate({}, { ignoreACL: true });
            await flush();
            expect(cache.deleteMany).toHaveBeenCalledWith(["rec:latest:t1", "rec:v0:t1", "rec:v1:t1"]);
            expect(cache.store.has("rec:v0:t1")).toBe(false);
        });

        it("logs a failed ACL cache invalidation instead of failing the write", async () => {
            class AclLike extends AccessControlListMongo {}
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.deleteMany = vi.fn().mockResolvedValue(undefined);
            const repoUtils: any = new RepoUtils(AclLike, fakeRepo);
            repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };
            repoUtils.aclUtils = { enabled: false, invalidateACLs: vi.fn().mockRejectedValue(new Error("down")) };

            await repoUtils.delete("acl-1", { ignoreACL: true });
            expect(repoUtils.aclUtils.invalidateACLs).toHaveBeenCalledWith(["acl-1"]);
            expect(repoUtils.logger.warn).toHaveBeenCalled();
        });
    });
});
