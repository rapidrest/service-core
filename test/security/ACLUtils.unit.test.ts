///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for ACLUtils's disabled/no-repo fast paths -- the full Mongo-backed
// ACLUtils.test.ts always has a healthy, fully-configured repo, so these guard branches never
// trigger there.
import { ACLUtils } from "../../src/security/ACLUtils";

function makeAclUtils(overrides: Partial<{ enabled: boolean; connMgr: any }> = {}): any {
    const aclUtils: any = new ACLUtils();
    aclUtils.enabled = overrides.enabled ?? true;
    aclUtils.connMgr = overrides.connMgr;
    aclUtils.logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
    return aclUtils;
}

describe("ACLUtils Tests (unit)", () => {
    describe("init", () => {
        it("throws when enabled and no `acl` datasource connection is configured", () => {
            const aclUtils = makeAclUtils({ enabled: true, connMgr: undefined });
            expect(() => aclUtils.init()).toThrow("Did you forget to configure the `acl` datasource?");
        });

        it("logs a warning instead of throwing when RBAC is disabled", () => {
            const aclUtils = makeAclUtils({ enabled: false });
            expect(() => aclUtils.init()).not.toThrow();
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

        it("swallows an error thrown by the repo's delete call", async () => {
            // ACLUtils's private `repo` getter treats the stored "acl" connection as a SQL
            // DataSource/MongoConnection and calls .getRepository() on it -- it's not itself the repo.
            const fakeRepo = { delete: vi.fn().mockRejectedValue(new Error("boom")) };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            await expect(aclUtils.removeACL("some-uid")).resolves.toBeUndefined();
            expect(fakeRepo.delete).toHaveBeenCalledWith({ uid: "some-uid" });
        });

        it("invalidates the cached ACL entry so a deletion isn't masked by a stale cache hit", async () => {
            const fakeRepo = { delete: vi.fn().mockResolvedValue(undefined) };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const fakeCache = { del: vi.fn().mockResolvedValue(1) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: {
                    connections: new Map<string, any>([
                        ["acl", fakeConnection],
                        ["cache", fakeCache],
                    ]),
                },
            });
            await aclUtils.removeACL("some-uid");
            expect(fakeCache.del).toHaveBeenCalledWith("db.cache.AccessControlList.some-uid");
        });

        it("does not touch the cache when none is configured", async () => {
            const fakeRepo = { delete: vi.fn().mockResolvedValue(undefined) };
            const fakeConnection = { getRepository: vi.fn().mockReturnValue(fakeRepo) };
            const aclUtils = makeAclUtils({
                enabled: true,
                connMgr: { connections: new Map([["acl", fakeConnection]]) },
            });
            // No "cache" connection registered -- cacheClient is undefined, so removeACL must not attempt del().
            await expect(aclUtils.removeACL("some-uid")).resolves.toBeUndefined();
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
    });
});
