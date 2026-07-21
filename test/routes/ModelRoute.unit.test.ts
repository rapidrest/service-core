///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for ModelRoute covering edge cases (missing repoUtils, the "me" keyword,
// not-found, and recordEvent) that are impractical to reach through the full Mongo/SQL
// integration tests, which never set `recordEvent: true` and always have a healthy repoUtils.
import "reflect-metadata";
import { EventUtils, JWTUtils, Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import config from "../config";
import { ModelRoute, RepoUtils } from "../../src";
import User from "../server/models/User";

class TestRoute extends ModelRoute<User> {
    protected repoUtilsClass = RepoUtils;
}
(TestRoute as any).modelClass = User;

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
        route.repoUtils.repo.count.mockResolvedValue(0);
        const req: any = { headers: {}, socket: { remoteAddress: "1.2.3.4" } };
        await route.doDelete("user-1", { recordEvent: true, user: { uid: "u1" }, req });
        expect(route.repoUtils.delete).toHaveBeenCalled();
    });

    it("records an event with purged=false and anonymous user when versioned history remains", async () => {
        const route = makeRoute();
        const existing = new User({ uid: "user-1" });
        route.repoUtils.findOne.mockResolvedValue(existing);
        route.repoUtils.repo.count.mockResolvedValue(1);
        await route.doDelete("user-1", { recordEvent: true });
        expect(route.repoUtils.delete).toHaveBeenCalled();
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
        route.repoUtils.count.mockResolvedValue(1);
        const res = { status: vi.fn().mockReturnThis(), setHeader: vi.fn().mockReturnThis() };
        await route.doExists("me", { query: {}, res, user: { uid: "user-1" } });
        expect(route.repoUtils.searchIdQuery).toHaveBeenCalledWith("user-1", undefined);
    });

    it("throws when 'me' is used without an authenticated user", async () => {
        const route = makeRoute();
        await expect(route.doExists("me", { query: {}, res: {} })).rejects.toThrow();
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
});
