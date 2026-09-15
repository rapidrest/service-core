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
            fakeRepo.distinct = vi.fn().mockResolvedValue(["allowed", "denied"]);
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
        expect(repoUtils.cache.save).toHaveBeenCalledTimes(2);
        expect(repoUtils.logger.warn).toHaveBeenCalled();
    });

    it("delete() still returns successfully when cache.delete rejects", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.deleteMany = vi.fn().mockResolvedValue(undefined);
        const repoUtils: any = new RepoUtils(User, fakeRepo);
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };
        repoUtils.cache = { delete: vi.fn().mockRejectedValue(new Error("cache down")) };

        await expect(repoUtils.delete("u1", { ignoreACL: true })).resolves.toBeUndefined();

        await flush();
        expect(repoUtils.cache.delete).toHaveBeenCalledTimes(3);
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
        expect(repoUtils.cache.save).toHaveBeenCalledTimes(2);
        expect(repoUtils.logger.warn).toHaveBeenCalled();
    });

    it("find() still returns results when cache.saveSet/saveMany reject", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValue([{ uid: "u1" }]) });
        const repoUtils: any = new RepoUtils(User, fakeRepo);
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };
        repoUtils.cache = {
            loadSet: vi.fn().mockResolvedValue(undefined),
            saveSet: vi.fn().mockRejectedValue(new Error("cache down")),
            saveMany: vi.fn().mockRejectedValue(new Error("cache down")),
        };

        const result = await repoUtils.find({}, { ignoreACL: true });
        expect(result.length).toBe(1);

        await flush();
        expect(repoUtils.cache.saveSet).toHaveBeenCalled();
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

    it("create(): reuses an existing ACL unchanged (no save, no hook) when the creator already holds every creator right on it", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(0);
        fakeRepo.save = vi.fn().mockImplementation(async (obj: any) => obj);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const existingAcl: any = { uid: "existing-acl", records: [] };
        const aclUtils = {
            enabled: true,
            hasPermission: vi.fn().mockResolvedValue(true),
            findACL: vi.fn().mockResolvedValue(existingAcl),
            getRecord: vi.fn().mockReturnValue(undefined),
            saveACL: vi.fn().mockImplementation(async (acl: any) => acl),
            removeACL: vi.fn().mockResolvedValue(undefined),
        };
        repoUtils.aclUtils = aclUtils;
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };

        const onRollback: Array<() => Promise<void>> = [];
        await transactionContext.run({ session: {}, datasource: "mongodb", onRollback }, () =>
            repoUtils.create({ name: "u-1" }, { user: creator }),
        );

        expect(aclUtils.saveACL).not.toHaveBeenCalled();
        expect(existingAcl.records).toEqual([]);
        expect(onRollback.length).toBe(0);
    });

    it("create(): registers no rollback hook when the ACL didn't actually need to change", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(0);
        fakeRepo.save = vi.fn().mockImplementation(async (obj: any) => obj);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const existingRecord = { userOrRoleId: "creator", actions: ["read"] };
        const existingAcl: any = { uid: "existing-acl", records: [existingRecord] };
        const aclUtils = {
            enabled: true,
            hasPermission: vi.fn().mockResolvedValue(true),
            findACL: vi.fn().mockResolvedValue(existingAcl),
            getRecord: vi.fn().mockReturnValue(existingRecord), // creator already has a record
            saveACL: vi.fn().mockImplementation(async (acl: any) => acl),
            removeACL: vi.fn().mockResolvedValue(undefined),
        };
        repoUtils.aclUtils = aclUtils;

        const onRollback: Array<() => Promise<void>> = [];
        await transactionContext.run({ session: {}, datasource: "mongodb", onRollback }, () =>
            repoUtils.create({ name: "u-1" }, { user: creator }),
        );

        expect(onRollback.length).toBe(0);
    });

    it("delete() purge: registers a hook that restores the removed ACL snapshot", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.deleteMany = vi.fn().mockResolvedValue(undefined);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const snapshot: any = { uid: "u1", records: [{ userOrRoleId: "owner", actions: ["read"] }] };
        const aclUtils = {
            enabled: true,
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

        expect(aclUtils.removeACL).toHaveBeenCalledWith("u1");
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

        expect(aclUtils.removeACLs).toHaveBeenCalledWith(["u1", "u2"]);
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

            expect(aclUtils.findACL).toHaveBeenCalledWith(result.uid, [], { skipCache: true });
            const [acl, options] = aclUtils.saveACL.mock.calls[0];
            expect(options).toEqual({ createOnly: true });
            expect(acl.records).toEqual([
                { userOrRoleId: "creator", actions: expect.arrayContaining(["update", "delete"]) },
            ]);
        });

        it("refuses (IDENTIFIER_EXISTS) to adopt an existing ACL the creator doesn't already fully hold, writing nothing", async () => {
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

        it("reuses an existing ACL unchanged for a trusted caller, or when trusted code passes allowExistingACL", async () => {
            for (const [user, options] of [
                [{ uid: "root", roles: ["admin"] }, {}],
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
