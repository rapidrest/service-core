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
            const fakeRepo: any = Object.create(MongoRepository.prototype);
            fakeRepo.count = vi.fn().mockResolvedValue(1);
            const repoUtils: any = new RepoUtils(RecoverableMongoItem, fakeRepo);

            const result = await repoUtils.exists("u1", { includeDeleted: true });

            expect(result).toBe(1);
            const [query] = fakeRepo.count.mock.calls[0];
            expect(query.$or[0]).not.toHaveProperty("deleted");
        });
    });
});
