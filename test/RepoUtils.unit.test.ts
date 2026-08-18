///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for RepoUtils.init()'s guard clauses — the full Mongo/SQL integration
// tests always have a healthy, fully-configured repo, so these error paths never trigger there.
import "reflect-metadata";
import { RepoUtils } from "../src/models/RepoUtils";
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
