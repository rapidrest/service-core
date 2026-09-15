///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for ModelRoute covering edge cases (missing repoUtils, the "me" keyword,
// not-found, and recordEvent) that are impractical to reach through the full Mongo/SQL
// integration tests, which never set `recordEvent: true` and always have a healthy repoUtils.
import "reflect-metadata";
import { ApiError, EventUtils, JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import config from "../config";
import { ApiErrorMessages, ApiErrors, BulkError, CRUDRoute, ModelRoute, RepoUtils } from "../../src";
import User from "../server/models/User";

class TestRoute extends ModelRoute<User> {
    protected repoUtilsClass = RepoUtils;
}
(TestRoute as any).modelClass = User;

// validateUpdateBulk() is declared on CRUDRoute, one level below ModelRoute, so TestRoute above (which
// extends ModelRoute directly) doesn't have it — this fixture is specifically for that method.
class TestCRUDRoute extends CRUDRoute<User> {
    protected repoUtilsClass = RepoUtils;
}
(TestCRUDRoute as any).modelClass = User;

function makeRoute(repoUtilsOverrides: any = {}) {
    const route: any = new TestRoute();
    route.config = config;
    route.logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    route.repoUtils = {
        repo: { count: vi.fn().mockResolvedValue(0) },
        instantiateObject: vi.fn((obj: any) => new User(obj)),
        create: vi.fn(async (obj: any) => obj),
        findOne: vi.fn(),
        count: vi.fn().mockResolvedValue(0),
        exists: vi.fn().mockResolvedValue(0),
        find: vi.fn().mockResolvedValue([]),
        update: vi.fn(async (obj: any, existing: any) => ({ ...existing, ...obj })),
        delete: vi.fn(),
        truncate: vi.fn(),
        searchIdQuery: vi.fn(() => ({})),
        getDefaultACL: vi.fn(),
        ...repoUtilsOverrides,
    };
    return route;
}

beforeAll(async () => {
    const token = JWTUtils.createTokenSync(config.get("auth"), { uid: uuid.v4() });
    await EventUtils.init(config, Logger(), token);
});

describe("ModelRoute.superInitialize", () => {
    it("throws when objectFactory is not set", async () => {
        const route: any = new TestRoute();
        route.objectFactory = undefined;
        await expect(route.superInitialize()).rejects.toThrow("objectFactory is not set!");
    });
});

describe("ModelRoute.doCount", () => {
    it("throws INTERNAL_ERROR when repoUtils is not set", async () => {
        const route = makeRoute();
        route.repoUtils = undefined;
        await expect(route.doCount({ query: {}, res: {} })).rejects.toThrow();
    });

    it("throws INTERNAL_ERROR when res is not set", async () => {
        const route = makeRoute();
        await expect(route.doCount({ query: {} })).rejects.toThrow();
    });
});

describe("ModelRoute.doCreateObject", () => {
    it("throws when repoUtils is not set", async () => {
        const route = makeRoute();
        route.repoUtils = undefined;
        await expect(route.doCreateObject({ name: "test" }, {})).rejects.toThrow("repoUtils not set!");
    });

    it("records an event with user and request IP when recordEvent is set", async () => {
        const route = makeRoute();
        const req: any = { headers: {}, socket: { remoteAddress: "1.2.3.4" } };
        const result = await route.doCreateObject(
            { name: "test" },
            { recordEvent: true, user: { uid: "creator-1" }, req },
        );
        expect(result.name).toBe("test");
    });

    it("records an event with no user and no request", async () => {
        const route = makeRoute();
        const result = await route.doCreateObject({ name: "test" }, { recordEvent: true });
        expect(result.name).toBe("test");
    });
});

describe("ModelRoute.doDelete", () => {
    it("throws INTERNAL_ERROR when repoUtils is not set", async () => {
        const route = makeRoute();
        route.repoUtils = undefined;
        await expect(route.doDelete("id1", {})).rejects.toThrow();
    });

    it("resolves 'me' to the authenticated user's uid", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doDelete("me", { user: { uid: "user-1" } });
        expect(route.repoUtils.findOne).toHaveBeenCalledWith("user-1", expect.anything());
    });

    it("throws when 'me' is used without an authenticated user", async () => {
        const route = makeRoute();
        await expect(route.doDelete("me", {})).rejects.toThrow();
    });

    it("throws NOT_FOUND when the object does not exist", async () => {
        const route = makeRoute();
        route.repoUtils.findOne.mockResolvedValue(undefined);
        await expect(route.doDelete("missing", {})).rejects.toThrow();
    });

    it("records an event with purged=true when the record is gone after delete", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        route.repoUtils.count.mockResolvedValue(0);
        const req: any = { headers: {}, socket: { remoteAddress: "1.2.3.4" } };
        await route.doDelete("user-1", { recordEvent: true, user: { uid: "u1" }, req });
        expect(route.repoUtils.delete).toHaveBeenCalled();
    });

    it("records an event with purged=false and anonymous user when versioned history remains", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        route.repoUtils.count.mockResolvedValue(1);
        await route.doDelete("user-1", { recordEvent: true });
        expect(route.repoUtils.delete).toHaveBeenCalled();
    });

    it("counts by uid ignoring ACL and including soft-deleted rows, for accurate purged detection", async () => {
        // Regression test: this must go through repoUtils.count() (which honors the active @Transactional
        // context via getTransaction()) rather than reading `repoUtils.repo` directly, which would read
        // outside any active transaction and could observe stale pre-delete state while an outer
        // @Transactional (e.g. from CRUDRoute.delete()) is still open. `includeDeleted: true` is required too:
        // a plain (non-purge) delete on a recoverable entity only sets `deleted: true` without removing the
        // row, and count()'s default excludes soft-deleted rows - without the override, a routine soft-delete
        // would misreport `purged: true` even though the row is still present.
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        const options = { recordEvent: true, user: { uid: "u1" } };
        await route.doDelete("user-1", options);
        expect(route.repoUtils.count).toHaveBeenCalledWith(
            { uid: "user-1" },
            expect.objectContaining({ ...options, ignoreACL: true, includeDeleted: true }),
        );
    });
});

describe("ModelRoute.doExists", () => {
    it("throws INTERNAL_ERROR when repoUtils or res is not set", async () => {
        const route = makeRoute();
        route.repoUtils = undefined;
        await expect(route.doExists("id1", { query: {}, res: {} })).rejects.toThrow();
    });

    it("resolves 'me' to the authenticated user's uid", async () => {
        const route = makeRoute();
        route.repoUtils.exists.mockResolvedValue(1);
        const res = { status: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() };
        await route.doExists("me", { query: {}, res, user: { uid: "user-1" } });
        expect(route.repoUtils.exists).toHaveBeenCalledWith(
            "user-1",
            expect.objectContaining({ user: { uid: "user-1" } }),
        );
    });

    it("throws when 'me' is used without an authenticated user", async () => {
        const route = makeRoute();
        await expect(route.doExists("me", { query: {}, res: {} })).rejects.toThrow();
    });

    it("passes includeDeleted: true when ?deleted=true is requested", async () => {
        const route = makeRoute();
        const res = { status: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() };
        await route.doExists("id1", { query: { deleted: "true" }, res });
        expect(route.repoUtils.exists).toHaveBeenCalledWith("id1", expect.objectContaining({ includeDeleted: true }));
    });

    it("passes includeDeleted: false when ?deleted is not requested", async () => {
        const route = makeRoute();
        const res = { status: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() };
        await route.doExists("id1", { query: {}, res });
        expect(route.repoUtils.exists).toHaveBeenCalledWith("id1", expect.objectContaining({ includeDeleted: false }));
    });
});

describe("ModelRoute.doFind", () => {
    it("throws INTERNAL_ERROR when repoUtils is not set", async () => {
        const route = makeRoute();
        route.repoUtils = undefined;
        await expect(route.doFind({ query: {} })).rejects.toThrow();
    });
});

describe("ModelRoute.doFindById", () => {
    it("throws INTERNAL_ERROR when repoUtils is not set", async () => {
        const route = makeRoute();
        route.repoUtils = undefined;
        await expect(route.doFindById("id1", { query: {} })).rejects.toThrow();
    });

    it("resolves 'me' to the authenticated user's uid", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doFindById("me", { query: {}, user: { uid: "user-1" } });
        expect(route.repoUtils.findOne).toHaveBeenCalledWith("user-1", expect.anything());
    });

    it("throws when 'me' is used without an authenticated user", async () => {
        const route = makeRoute();
        await expect(route.doFindById("me", { query: {} })).rejects.toThrow();
    });

    it("throws NOT_FOUND when the object does not exist", async () => {
        const route = makeRoute();
        route.repoUtils.findOne.mockResolvedValue(undefined);
        await expect(route.doFindById("missing", { query: {} })).rejects.toThrow();
    });

    it("passes includeDeleted: true when ?deleted=true is requested", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doFindById("user-1", { query: { deleted: "true" } });
        expect(route.repoUtils.findOne).toHaveBeenCalledWith(
            "user-1",
            expect.objectContaining({ includeDeleted: true }),
        );
    });

    it("passes includeDeleted: false when ?deleted is not requested", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doFindById("user-1", { query: {} });
        expect(route.repoUtils.findOne).toHaveBeenCalledWith(
            "user-1",
            expect.objectContaining({ includeDeleted: false }),
        );
    });
});

describe("ModelRoute.doTruncate", () => {
    it("throws INTERNAL_ERROR when repoUtils is not set", async () => {
        const route = makeRoute();
        route.repoUtils = undefined;
        await expect(route.doTruncate({ params: {}, query: {} })).rejects.toThrow();
    });

    it("records an event with user and request IP when recordEvent is set", async () => {
        const route = makeRoute();
        const req: any = { headers: {}, socket: { remoteAddress: "1.2.3.4" } };
        await route.doTruncate({ params: {}, query: {}, recordEvent: true, user: { uid: "u1" }, req });
        expect(route.repoUtils.truncate).toHaveBeenCalled();
    });

    it("records an event with no user and no request", async () => {
        const route = makeRoute();
        await route.doTruncate({ params: {}, query: {}, recordEvent: true });
        expect(route.repoUtils.truncate).toHaveBeenCalled();
    });
});

describe("ModelRoute.doUpdate", () => {
    it("throws INTERNAL_ERROR when repoUtils is not set", async () => {
        const route = makeRoute();
        route.repoUtils = undefined;
        await expect(route.doUpdate("id1", { uid: "id1" }, {})).rejects.toThrow();
    });

    it("resolves 'me' to the authenticated user's uid", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doUpdate("me", { uid: "user-1" }, { user: { uid: "user-1" } });
        expect(route.repoUtils.findOne).toHaveBeenCalledWith("user-1", expect.anything());
    });

    it("throws when 'me' is used without an authenticated user", async () => {
        const route = makeRoute();
        await expect(route.doUpdate("me", { uid: "me" }, {})).rejects.toThrow();
    });

    it("throws NOT_FOUND when the object does not exist", async () => {
        const route = makeRoute();
        route.repoUtils.findOne.mockResolvedValue(undefined);
        await expect(route.doUpdate("missing", { uid: "missing" }, {})).rejects.toThrow();
    });

    it("records an event with user and request IP when recordEvent is set", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        const req: any = { headers: {}, socket: { remoteAddress: "1.2.3.4" } };
        await route.doUpdate("user-1", { uid: "user-1" }, { recordEvent: true, user: { uid: "u1" }, req });
        expect(route.repoUtils.update).toHaveBeenCalled();
    });

    it("records an event with no user and no request", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doUpdate("user-1", { uid: "user-1" }, { recordEvent: true });
        expect(route.repoUtils.update).toHaveBeenCalled();
    });
});

describe("ModelRoute.doUpdateProperty", () => {
    it("resolves 'me' to the authenticated user's uid", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1", version: 2 });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doUpdateProperty("me", "name", "new-name", { user: { uid: "user-1" } });
        expect(route.repoUtils.findOne).toHaveBeenCalledWith("user-1", expect.anything());
    });

    it("throws when 'me' is used without an authenticated user", async () => {
        const route = makeRoute();
        await expect(route.doUpdateProperty("me", "name", "new-name", {})).rejects.toThrow();
    });

    it("throws NOT_FOUND when the object does not exist", async () => {
        const route = makeRoute();
        route.repoUtils.findOne.mockResolvedValue(undefined);
        await expect(route.doUpdateProperty("missing", "name", "new-name", {})).rejects.toThrow();
    });

    it("skips its own lookup and uses the pre-loaded `existing` object from options", async () => {
        // doUpdateProperty's own `options.existing || findOne(...)` lookup is skipped here since
        // `existing` is provided — the single findOne call that does happen comes from the doUpdate()
        // call it delegates to internally, which always re-fetches regardless of `options.existing`.
        const route = makeRoute();
        const existing = new User({ uid: "user-1", version: 2 });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doUpdateProperty("user-1", "name", "new-name", { existing });
        expect(route.repoUtils.findOne).toHaveBeenCalledTimes(1);
        expect(route.repoUtils.update).toHaveBeenCalled();
    });

    it("uses the caller-supplied options.version instead of silently falling back to existing.version", async () => {
        // Regression test for an operator-precedence bug: `options.version || "version" in existing ? x : y`
        // parsed as `(options.version || ("version" in existing)) ? x : y`, so a BaseEntity (which always has
        // a "version" property) made the ternary always resolve to existing.version, discarding whatever
        // version the caller explicitly passed in.
        const route = makeRoute();
        const existing = new User({ uid: "user-1", version: 5 });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doUpdateProperty("user-1", "name", "new-name", { version: 3 });
        const [updateObj] = route.repoUtils.update.mock.calls[0];
        expect(updateObj.version).toBe(3);
    });

    it("falls back to existing.version when the caller does not supply options.version", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1", version: 5 });
        route.repoUtils.findOne.mockResolvedValue(existing);
        await route.doUpdateProperty("user-1", "name", "new-name", {});
        const [updateObj] = route.repoUtils.update.mock.calls[0];
        expect(updateObj.version).toBe(5);
    });
});

describe("CRUDRoute.validateCreateBulk", () => {
    it("throws BULK_CREATE_FAILURE with a per-object ApiError reason when an item fails validation", async () => {
        const route: any = new TestCRUDRoute();
        const reason = new ApiError(ApiErrors.INVALID_REQUEST, 400, "name is invalid");
        route.validateCreate = vi
            .fn()
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(reason)
            .mockRejectedValueOnce(new Error("mongo: connection string mongodb://secret@host"));

        const err: any = await route
            .validateCreateBulk([{ name: "ok" }, { name: "bad name" }, { name: "boom" }], { uid: "actor" })
            .catch((e: any) => e);

        expect(err).toBeInstanceOf(BulkError);
        expect(err.code).toBe(ApiErrors.BULK_CREATE_FAILURE);
        expect(err.message).toBe(ApiErrorMessages.BULK_CREATE_FAILURE);
        expect(err.status).toBe(400);
        expect(err.errors).toHaveLength(3);
        expect(err.errors[0]).toBeNull();
        expect(err.errors[1]).toBe(reason);
        // A non-ApiError reason is replaced with a generic ApiError so internal details aren't sent to the client.
        expect(err.errors[2]).toBeInstanceOf(ApiError);
        expect(err.errors[2].code).toBe(ApiErrors.INVALID_REQUEST);
        expect(err.errors[2].message).not.toContain("secret");
    });

    it("rethrows the validation error itself for a single (non-array) object", async () => {
        const route: any = new TestCRUDRoute();
        const reason = new ApiError(ApiErrors.INVALID_REQUEST, 400, "name is invalid");
        route.validateCreate = vi.fn().mockRejectedValue(reason);
        await expect(route.validateCreateBulk({ name: "bad name" }, { uid: "actor" })).rejects.toBe(reason);

        route.validateCreate = vi.fn().mockRejectedValue(new Error("internal detail"));
        const err: any = await route.validateCreateBulk({ name: "bad name" }, { uid: "actor" }).catch((e: any) => e);
        expect(err).not.toBeInstanceOf(BulkError);
        expect(err.code).toBe(ApiErrors.INVALID_REQUEST);
        expect(err.message).toBe(ApiErrorMessages.INVALID_REQUEST);
    });

    it("does not throw when every object passes validation", async () => {
        const route: any = new TestCRUDRoute();
        route.validateCreate = vi.fn().mockResolvedValue(undefined);
        await expect(
            route.validateCreateBulk([{ name: "a" }, { name: "b" }], { uid: "actor" }),
        ).resolves.toBeUndefined();
        await expect(route.validateCreateBulk({ name: "a" }, { uid: "actor" })).resolves.toBeUndefined();
    });
});

describe("CRUDRoute.validateUpdateBulk", () => {
    it("throws BULK_UPDATE_FAILURE when at least one item in the batch fails validation", async () => {
        const route: any = new TestCRUDRoute();
        const reason = new ApiError(ApiErrors.INVALID_REQUEST, 400, "invalid item");
        route.validateUpdate = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(reason);

        const err: any = await route
            .validateUpdateBulk(
                [
                    { uid: "user-1", name: "ok" },
                    { uid: "user-2", name: "bad" },
                ],
                { uid: "actor" },
            )
            .catch((e: any) => e);
        expect(err).toBeInstanceOf(BulkError);
        expect(err.code).toBe(ApiErrors.BULK_UPDATE_FAILURE);
        expect(err.errors).toEqual([null, reason]);
    });

    it("does not throw when every item in the batch passes validation", async () => {
        const route: any = new TestCRUDRoute();
        route.validateUpdate = vi.fn().mockResolvedValue(undefined);

        await expect(
            route.validateUpdateBulk([{ uid: "user-1", name: "ok" }], { uid: "actor" }),
        ).resolves.toBeUndefined();
    });
});
