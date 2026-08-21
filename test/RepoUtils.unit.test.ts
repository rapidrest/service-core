///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
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
            expect(repoUtils.aclUtils.hasPermission).toHaveBeenCalledWith(
                undefined,
                repoUtils.defaultACLUid,
                "delete",
            );
            expect(repoUtils.aclUtils.hasPermission).toHaveBeenCalledWith(
                undefined,
                repoUtils.defaultACLUid,
                "update",
            );
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
                hasPermission: vi.fn().mockImplementation(async (_user: any, _acl: any, action: string) => action === "exists"),
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
        fakeRepo.updateOne = vi.fn().mockResolvedValue(undefined);
        fakeRepo.findOne = vi.fn().mockResolvedValue({ uid: "u1", version: 1, name: "after" });
        const repoUtils: any = new RepoUtils(User, fakeRepo);
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };
        repoUtils.cache = { save: vi.fn().mockRejectedValue(new Error("cache down")) };

        const result = await repoUtils.update(
            { uid: "u1", version: 0, name: "after" },
            existing,
            { ignoreACL: true },
        );
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

    it("create(): logs instead of reverting when saveACL() modified an already-existing ACL", async () => {
        const fakeRepo: any = Object.create(MongoRepository.prototype);
        fakeRepo.count = vi.fn().mockResolvedValue(0);
        fakeRepo.save = vi.fn().mockImplementation(async (obj: any) => obj);
        const repoUtils: any = new RepoUtils(RecordACLItem, fakeRepo);
        const existingAcl: any = { uid: "existing-acl", records: [] };
        const aclUtils = {
            enabled: true,
            hasPermission: vi.fn().mockResolvedValue(true),
            findACL: vi.fn().mockResolvedValue(existingAcl),
            getRecord: vi.fn().mockReturnValue(undefined), // creator has no record yet -> one gets appended
            saveACL: vi.fn().mockImplementation(async (acl: any) => acl),
            removeACL: vi.fn().mockResolvedValue(undefined),
        };
        repoUtils.aclUtils = aclUtils;
        repoUtils.logger = { warn: vi.fn(), debug: vi.fn() };

        const onRollback: Array<() => Promise<void>> = [];
        await transactionContext.run({ session: {}, datasource: "mongodb", onRollback }, () =>
            repoUtils.create({ name: "u-1" }, { user: creator }),
        );

        expect(onRollback.length).toBe(1);
        await onRollback[0]();
        expect(aclUtils.removeACL).not.toHaveBeenCalled();
        expect(repoUtils.logger.warn).toHaveBeenCalled();
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
