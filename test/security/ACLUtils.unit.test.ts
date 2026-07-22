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
        it("throws when enabled and no `acl` datastore connection is configured", () => {
            const aclUtils = makeAclUtils({ enabled: true, connMgr: undefined });
            expect(() => aclUtils.init()).toThrow("Did you forget to configure the `acl` datastore?");
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

        it("returns undefined when enabled but no `acl` datastore connection is configured", async () => {
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
    });
});
