///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for ACLUtils's disabled/no-repo fast paths -- the full Mongo-backed
// ACLUtils.test.ts always has a healthy, fully-configured repo, so these guard branches never
// trigger there.
import { ACLUtils } from "../../src/security/ACLUtils";
import { MongoConnection } from "../../src/database/MongoConnection";
import { MongoRepository } from "../../src/database/MongoRepository";

function makeAclUtils(overrides: Partial<{ enabled: boolean; connMgr: any }> = {}): any {
    const aclUtils: any = new ACLUtils();
    aclUtils.enabled = overrides.enabled ?? true;
    aclUtils.connMgr = overrides.connMgr;
    aclUtils.logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    return aclUtils;
}

describe("ACLUtils Tests (unit)", () => {
    describe("init", () => {
        it("throws when enabled and no `acl` datasource connection is configured", async () => {
            const aclUtils = makeAclUtils({ enabled: true, connMgr: undefined });
            await expect(aclUtils.init()).rejects.toThrow("Did you forget to configure the `acl` datasource?");
        });

        it("logs a warning instead of throwing when RBAC is disabled", async () => {
            const aclUtils = makeAclUtils({ enabled: false });
            await expect(aclUtils.init()).resolves.not.toThrow();
            expect(aclUtils.logger.warn).toHaveBeenCalledWith("RBAC system is disabled.");
        });
    });

    describe("checkRequestPerms", () => {
        it("returns true immediately when RBAC is disabled, without touching the repo", async () => {
            const aclUtils = makeAclUtils({ enabled: false });
            const result = await aclUtils.checkRequestPerms("some-uid", { uid: "u1" }, { method: "GET" } as any);
            expect(result).toBe(true);
        });
    });

    describe("findACL", () => {
        it("returns undefined when RBAC is disabled", async () => {
            const aclUtils = makeAclUtils({ enabled: false });
            await expect(aclUtils.findACL("some-uid")).resolves.toBeUndefined();
        });

        it("returns undefined when enabled but no `acl` datasource connection is configured", async () => {
            const aclUtils = makeAclUtils({ enabled: true, connMgr: undefined });
            await expect(aclUtils.findACL("some-uid")).resolves.toBeUndefined();
        });
    });

    describe("removeACL", () => {
        it("does nothing when RBAC is disabled", async () => {
            const aclUtils = makeAclUtils({ enabled: false });
            await expect(aclUtils.removeACL("some-uid")).resolves.toBeUndefined();
        });

        it("atomically finds-then-deletes and returns the document that was removed", async () => {
            // ACLUtils's private `repo` getter treats the stored "acl" connection as a SQL
            // DataSource/MongoConnection and calls .getRepository() on it -- it's not itself the repo.
            const existing = { uid: "some-uid", records: [{ userOrRoleId: "u1", actions: ["read"] }] };
            const fakeRepo = {
                findOne: vi.fn().mockResolvedValue(existing),
                delete: vi.fn().mockResolvedValue(undefined),
            };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            const result = await aclUtils.removeACL("some-uid");
            expect(result?.uid).toBe("some-uid");
            expect(fakeRepo.delete).toHaveBeenCalledWith({ uid: "some-uid" });
        });

        it("returns undefined and skips the delete call when there was nothing to remove", async () => {
            const fakeRepo = { findOne: vi.fn().mockResolvedValue(null), delete: vi.fn() };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            const result = await aclUtils.removeACL("some-uid");
            expect(result).toBeUndefined();
            expect(fakeRepo.delete).not.toHaveBeenCalled();
        });

        it("propagates a genuine error instead of swallowing it", async () => {
            // Narrowed error handling: only "ns not found" (the collection doesn't exist yet) is treated as
            // harmless - see RepoUtils.truncate()'s identical handling of the same driver quirk. Any other
            // failure (a network blip, etc.) must propagate, since a caller relying on the return value as a
            // restore snapshot needs to know the removal didn't actually happen.
            const fakeRepo = {
                findOne: vi.fn().mockResolvedValue({ uid: "some-uid", records: [] }),
                delete: vi.fn().mockRejectedValue(new Error("boom")),
            };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            await expect(aclUtils.removeACL("some-uid")).rejects.toThrow("boom");
        });

        it("swallows an 'ns not found' error (collection doesn't exist yet)", async () => {
            const fakeRepo = { findOne: vi.fn().mockRejectedValue(new Error("ns not found")), delete: vi.fn() };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            await expect(aclUtils.removeACL("some-uid")).resolves.toBeUndefined();
        });

        it("invalidates the cached ACL entry so a deletion isn't masked by a stale cache hit", async () => {
            const fakeRepo = {
                findOne: vi.fn().mockResolvedValue({ uid: "some-uid", records: [] }),
                delete: vi.fn().mockResolvedValue(undefined),
            };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            // `cache` is a `RedisCache` instance (which prefixes keys internally), not a raw redis
            // connection, so it's set directly rather than via a "cache" datasource connection.
            const fakeCache = { delete: vi.fn().mockResolvedValue(undefined) };
            aclUtils.cache = fakeCache;
            await aclUtils.removeACL("some-uid");
            expect(fakeCache.delete).toHaveBeenCalledWith("some-uid");
        });

        it("does not touch the cache when none is configured", async () => {
            const fakeRepo = {
                findOne: vi.fn().mockResolvedValue({ uid: "some-uid", records: [] }),
                delete: vi.fn().mockResolvedValue(undefined),
            };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            // No "cache" connection registered -- cacheClient is undefined, so removeACL must not attempt del().
            await expect(aclUtils.removeACL("some-uid")).resolves.toBeDefined();
            expect(fakeRepo.delete).toHaveBeenCalledWith({ uid: "some-uid" });
        });
    });

    describe("diffACL", () => {
        it("counts a parentUid change", () => {
            const aclUtils = makeAclUtils();
            const aclA: any = { parentUid: "p1", records: [] };
            const aclB: any = { parentUid: "p2", records: [] };
            expect(aclUtils.diffACL(aclA, aclB)).toBe(1);
        });

        it("returns 0 for two identical ACLs", () => {
            const aclUtils = makeAclUtils();
            const aclA: any = { parentUid: "p1", records: [{ userOrRoleId: "u1", actions: ["read"] }] };
            const aclB: any = { parentUid: "p1", records: [{ userOrRoleId: "u1", actions: ["read"] }] };
            expect(aclUtils.diffACL(aclA, aclB)).toBe(0);
        });

        it("counts an added and a removed record", () => {
            const aclUtils = makeAclUtils();
            const aclA: any = { parentUid: undefined, records: [{ userOrRoleId: "u1", actions: ["read"] }] };
            const aclB: any = { parentUid: undefined, records: [{ userOrRoleId: "u2", actions: ["read"] }] };
            // u1 only in A (+1), u2 only in B (+1)
            expect(aclUtils.diffACL(aclA, aclB)).toBe(2);
        });
    });

    describe("actionsChanged", () => {
        it("returns true when the action lists differ in length", () => {
            const aclUtils = makeAclUtils();
            expect(aclUtils.actionsChanged(["read"], ["read", "write"])).toBe(true);
        });

        it("returns false when the action lists match regardless of order", () => {
            const aclUtils = makeAclUtils();
            expect(aclUtils.actionsChanged(["read", "write"], ["write", "read"])).toBe(false);
        });

        it("returns true when same-length lists contain different actions", () => {
            const aclUtils = makeAclUtils();
            expect(aclUtils.actionsChanged(["read"], ["write"])).toBe(true);
        });
    });

    describe("saveACL", () => {
        it("returns null immediately when RBAC is disabled", async () => {
            const aclUtils = makeAclUtils({ enabled: false });
            await expect(aclUtils.saveACL({ uid: "x", records: [] } as any)).resolves.toBeNull();
        });

        it("returns null immediately when no ACL is provided", async () => {
            const aclUtils = makeAclUtils({ enabled: true });
            await expect(aclUtils.saveACL(undefined as any)).resolves.toBeNull();
        });

        it("throws on a version mismatch when saving to a SQL-backed repo", async () => {
            // A plain object with getRepository() duck-types as a SQL DataSource per isSqlDataSource() —
            // it's specifically NOT `instanceof MongoRepository`, which routes saveACL() down the SQL branch.
            const existing = {
                uid: "x",
                version: 5,
                parentUid: undefined,
                records: [{ userOrRoleId: "a", actions: ["read"] }],
            };
            const fakeRepo = { findOne: vi.fn().mockResolvedValue(existing), save: vi.fn() };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });

            const acl = { uid: "x", records: [{ userOrRoleId: "b", actions: ["write"] }] };
            await expect(aclUtils.saveACL(acl as any)).rejects.toThrow("The acl to save must be of the same version.");
            expect(fakeRepo.save).not.toHaveBeenCalled();
        });

        describe("preserveVersion (restoring a rollback snapshot)", () => {
            it("writes the ACL back at its own version instead of bumping it (SQL)", async () => {
                // Regression test: a plain (non-preserveVersion) save always computes
                // `version: existing ? existing.version + 1 : 0` from a *fresh* lookup - since a restore always
                // targets a uid nothing currently exists at (that's the point of restoring), that fresh lookup
                // is null, silently resetting the restored ACL's version to 0 instead of its real prior value.
                const fakeRepo = { findOne: vi.fn().mockResolvedValue(null), save: vi.fn().mockImplementation(async (x: any) => x) };
                const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
                const aclUtils = makeAclUtils({
                    enabled: true,
                    connMgr: { connections: new Map([["acl", fakeConnection]]) },
                });

                const snapshot = { uid: "x", version: 5, records: [{ userOrRoleId: "u1", actions: ["read"] }] };
                const result = await aclUtils.saveACL(snapshot as any, { preserveVersion: true });

                expect(result?.version).toBe(5);
                const [savedDoc] = fakeRepo.save.mock.calls[0];
                expect(savedDoc.version).toBe(5);
            });

            it("writes the ACL back at its own version instead of bumping it (Mongo)", async () => {
                const fakeRepo: any = Object.create(MongoRepository.prototype);
                fakeRepo.findOne = vi.fn().mockResolvedValue(null);
                fakeRepo.save = vi.fn().mockImplementation(async (x: any) => x);
                const fakeConnection: any = Object.create(MongoConnection.prototype);
                fakeConnection.getRepository = vi.fn().mockReturnValue(fakeRepo);
                const aclUtils = makeAclUtils({
                    enabled: true,
                    connMgr: { connections: new Map([["acl", fakeConnection]]) },
                });

                const snapshot = { uid: "x", version: 5, records: [{ userOrRoleId: "u1", actions: ["read"] }] };
                const result = await aclUtils.saveACL(snapshot as any, { preserveVersion: true });

                expect(result?.version).toBe(5);
                const [savedDoc] = fakeRepo.save.mock.calls[0];
                expect(savedDoc.version).toBe(5);
            });

            it("refuses to restore over a document that already exists at that uid", async () => {
                const existing = { uid: "x", version: 0, records: [] };
                const fakeRepo = { findOne: vi.fn().mockResolvedValue(existing), save: vi.fn() };
                const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
                const aclUtils = makeAclUtils({
                    enabled: true,
                    connMgr: { connections: new Map([["acl", fakeConnection]]) },
                });

                const snapshot = { uid: "x", version: 5, records: [] };
                await expect(aclUtils.saveACL(snapshot as any, { preserveVersion: true })).rejects.toThrow(
                    "a document already exists at this uid",
                );
                expect(fakeRepo.save).not.toHaveBeenCalled();
            });
        });
    });

    describe("saveDefaultACL", () => {
        it("returns null immediately when RBAC is disabled", async () => {
            const aclUtils = makeAclUtils({ enabled: false });
            await expect(aclUtils.saveDefaultACL({ uid: "x", records: [] } as any)).resolves.toBeNull();
        });

        it("returns null immediately when no ACL is provided", async () => {
            const aclUtils = makeAclUtils({ enabled: true });
            await expect(aclUtils.saveDefaultACL(undefined as any)).resolves.toBeNull();
        });

        it("retries on failure and succeeds before exhausting its attempts", async () => {
            const aclUtils = makeAclUtils({ enabled: true });
            vi.spyOn(aclUtils, "findACL").mockResolvedValue(undefined);
            let calls = 0;
            vi.spyOn(aclUtils, "saveACL").mockImplementation(async (acl: any) => {
                calls++;
                if (calls === 1) {
                    throw new Error("transient failure");
                }
                return acl;
            });

            const result = await aclUtils.saveDefaultACL({ uid: "x", records: [] } as any);
            expect(result).toBeDefined();
            expect(calls).toBeGreaterThan(1);
        });

        it("rethrows once every retry attempt has failed", async () => {
            const aclUtils = makeAclUtils({ enabled: true });
            vi.spyOn(aclUtils, "findACL").mockResolvedValue(undefined);
            vi.spyOn(aclUtils, "saveACL").mockRejectedValue(new Error("persistent failure"));

            await expect(aclUtils.saveDefaultACL({ uid: "x", records: [] } as any)).rejects.toThrow(
                "persistent failure",
            );
        });
    });

    describe("getRecord", () => {
        it("returns null when no ACL is provided", () => {
            const aclUtils = makeAclUtils();
            expect(aclUtils.getRecord(undefined as any, undefined)).toBeNull();
        });

        it("prefers a specific-uid deny record over an earlier wildcard grant, regardless of array order", () => {
            // Regression test: an ACL author listing a broad wildcard grant before a specific per-user
            // record (a natural authoring order — "everyone except banned_user") must not have the specific
            // record silently shadowed by the earlier wildcard match.
            const aclUtils = makeAclUtils();
            const acl: any = {
                records: [
                    { userOrRoleId: ".*", actions: ["read", "update", "delete"] },
                    { userOrRoleId: "banned_user", actions: [] },
                ],
            };

            const record = aclUtils.getRecord(acl, { uid: "banned_user", roles: [] });
            expect(record?.userOrRoleId).toBe("banned_user");
            expect(record?.actions).toEqual([]);
        });

        it("prefers a role match over an earlier wildcard match", () => {
            const aclUtils = makeAclUtils();
            const acl: any = {
                records: [
                    { userOrRoleId: ".*", actions: ["read"] },
                    { userOrRoleId: "admin", actions: ["full"] },
                ],
            };

            const record = aclUtils.getRecord(acl, { uid: "u1", roles: ["admin"] });
            expect(record?.userOrRoleId).toBe("admin");
        });

        it("still falls back to a wildcard match when no more specific record matches", () => {
            const aclUtils = makeAclUtils();
            const acl: any = {
                records: [
                    { userOrRoleId: ".*", actions: ["read"] },
                    { userOrRoleId: "someone-else", actions: ["full"] },
                ],
            };

            const record = aclUtils.getRecord(acl, { uid: "u1", roles: [] });
            expect(record?.userOrRoleId).toBe(".*");
        });
    });

    // A cache failure is a best-effort side effect and must never fail the read/write it's attached to.
    describe("cache writes are fire-and-forget", () => {
        const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

        it("findACL() still returns the ACL when cache.save rejects", async () => {
            const fakeRepo = { findOne: vi.fn().mockResolvedValue({ uid: "x", records: [] }) };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            aclUtils.cache = {
                load: vi.fn().mockResolvedValue(undefined),
                save: vi.fn().mockRejectedValue(new Error("cache down")),
            };

            const result = await aclUtils.findACL("x");
            expect(result?.uid).toBe("x");

            await flush();
            expect(aclUtils.cache.save).toHaveBeenCalled();
            expect(aclUtils.logger.warn).toHaveBeenCalled();
        });

        it("saveACL() still returns the saved ACL when cache.save rejects", async () => {
            const fakeRepo = {
                findOne: vi.fn().mockResolvedValue(null),
                save: vi.fn().mockImplementation(async (x: any) => x),
            };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            aclUtils.cache = { save: vi.fn().mockRejectedValue(new Error("cache down")) };

            const result = await aclUtils.saveACL({ uid: "x", records: [] } as any);
            expect(result?.uid).toBe("x");

            await flush();
            expect(aclUtils.cache.save).toHaveBeenCalled();
            expect(aclUtils.logger.warn).toHaveBeenCalled();
        });
    });

    // RepoUtils.truncate() uses these to clean up (and, on a later rollback, restore) every deleted record's
    // ACL in one call, without duplicating removeACL()/saveACL()'s own per-record logic.
    describe("removeACLs / saveACLs (batched)", () => {
        it("removeACLs() removes every uid, batched in groups of 100, and returns the deleted documents", async () => {
            // The `repo` getter special-cases `instanceof MongoConnection`; a plain object with
            // getRepository() duck-types as a SQL DataSource instead (see the `removeACL` tests above), which
            // routes through `repo.delete()` rather than the Mongo `.deleteOne()` branch.
            const fakeRepo = {
                findOne: vi.fn().mockImplementation(async ({ where: { uid } }: any) => ({ uid, records: [] })),
                delete: vi.fn().mockResolvedValue(undefined),
            };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });

            const uids: string[] = Array.from({ length: 250 }, (_, i) => `uid-${i}`);
            const removed = await aclUtils.removeACLs(uids);

            expect(fakeRepo.delete).toHaveBeenCalledTimes(250);
            expect(removed.map((acl: any) => acl.uid)).toEqual(uids);
            for (const uid of uids) {
                expect(fakeRepo.delete).toHaveBeenCalledWith({ uid });
            }
        });

        it("saveACLs() saves every ACL, batched in groups of 100", async () => {
            const fakeRepo = {
                findOne: vi.fn().mockResolvedValue(null),
                save: vi.fn().mockImplementation(async (x: any) => x),
            };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });

            const acls: any[] = Array.from({ length: 150 }, (_, i) => ({ uid: `uid-${i}`, records: [] }));
            await aclUtils.saveACLs(acls);

            expect(fakeRepo.save).toHaveBeenCalledTimes(150);
        });

        it("removeACLs() with an empty list does nothing and returns an empty array", async () => {
            const fakeRepo = { findOne: vi.fn(), delete: vi.fn() };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });

            await expect(aclUtils.removeACLs([])).resolves.toEqual([]);
            expect(fakeRepo.delete).not.toHaveBeenCalled();
        });
    });
});
