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

    it("throws when no connection is registered for the model's datastore", async () => {
        const repoUtils: any = new RepoUtils(User);
        repoUtils.connectionManager = { connections: new Map() };
        await expect(repoUtils.init()).rejects.toThrow("No connection found for datastore 'mongodb'");
    });

    it("throws when the datastore connection has no repository for the class", async () => {
        const repoUtils: any = new RepoUtils(User);
        const fakeConn = { getRepository: () => undefined };
        repoUtils.connectionManager = { connections: new Map([["mongodb", fakeConn]]) };
        await expect(repoUtils.init()).rejects.toThrow("No repository found for class User");
    });
});
