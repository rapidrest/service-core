///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { JWTUtils } from "@rapidrest/core";
import { JWTStrategy, JWTStrategyOptions } from "../../src/auth/JWTStrategy";

const authConfig = {
    secret: "MyPasswordIsSecure",
    options: { expiresIn: "7 days", audience: "mydomain.com", issuer: "api.mydomain.com" },
};

function makeStrategy(optionOverrides: Partial<JWTStrategyOptions> = {}) {
    const strategy: any = new JWTStrategy(Object.assign(new JWTStrategyOptions(), optionOverrides));
    strategy.config = authConfig;
    return strategy as JWTStrategy;
}

function makeReq(overrides: any = {}): any {
    return { headers: {}, query: {}, cookies: {}, signedCookies: {}, ...overrides };
}

describe("JWTStrategy.getAuthToken (via authenticateSync)", () => {
    it("ignores a query param token when allowQueryParam is false (default)", () => {
        const strategy = makeStrategy();
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const result = strategy.authenticateSync(makeReq({ query: { auth_token: token } }), {} as any);
        expect(result).toBeUndefined();
    });

    it("reads a query param token when allowQueryParam is true", () => {
        const strategy = makeStrategy({ allowQueryParam: true });
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const result = strategy.authenticateSync(makeReq({ query: { auth_token: token } }), {} as any);
        expect(result?.user?.uid).toBe("u1");
    });

    it("skips a malformed Authorization header with no scheme separator", () => {
        const strategy = makeStrategy();
        const result = strategy.authenticateSync(makeReq({ headers: { authorization: "not-two-parts" } }), {} as any);
        expect(result).toBeUndefined();
    });

    it("skips an Authorization header whose scheme doesn't match", () => {
        const strategy = makeStrategy();
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const result = strategy.authenticateSync(makeReq({ headers: { authorization: `Basic ${token}` } }), {} as any);
        expect(result).toBeUndefined();
    });

    it("finds the token among multiple Authorization header values", () => {
        const strategy = makeStrategy();
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const result = strategy.authenticateSync(
            makeReq({ headers: { authorization: ["Basic garbage", `jwt ${token}`] } }),
            {} as any,
        );
        expect(result?.user?.uid).toBe("u1");
    });

    it("reads the token from a signed cookie when cookieSecure is true", () => {
        const strategy = makeStrategy({ cookieSecure: true });
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const result = strategy.authenticateSync(makeReq({ signedCookies: { jwt: token } }), {} as any);
        expect(result?.user?.uid).toBe("u1");
    });

    it("does not read signedCookies when cookieSecure is false", () => {
        const strategy = makeStrategy({ cookieSecure: false });
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const result = strategy.authenticateSync(makeReq({ signedCookies: { jwt: token } }), {} as any);
        expect(result).toBeUndefined();
    });

    it("reads the token from a plain cookie when cookieSecure is false", () => {
        const strategy = makeStrategy({ cookieSecure: false });
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const result = strategy.authenticateSync(makeReq({ cookies: { jwt: token } }), {} as any);
        expect(result?.user?.uid).toBe("u1");
    });

    describe("source precedence (query > header > cookie, per the documented order)", () => {
        it("prefers the Authorization header over a cookie when both are present", () => {
            const strategy = makeStrategy();
            const headerToken = JWTUtils.createTokenSync(authConfig, { uid: "header-user" });
            const cookieToken = JWTUtils.createTokenSync(authConfig, { uid: "cookie-user" });
            const result = strategy.authenticateSync(
                makeReq({
                    headers: { authorization: `jwt ${headerToken}` },
                    cookies: { jwt: cookieToken },
                }),
                {} as any,
            );
            expect(result?.user?.uid).toBe("header-user");
        });

        it("prefers a query parameter over the Authorization header when both are present and allowed", () => {
            const strategy = makeStrategy({ allowQueryParam: true });
            const queryToken = JWTUtils.createTokenSync(authConfig, { uid: "query-user" });
            const headerToken = JWTUtils.createTokenSync(authConfig, { uid: "header-user" });
            const result = strategy.authenticateSync(
                makeReq({
                    query: { auth_token: queryToken },
                    headers: { authorization: `jwt ${headerToken}` },
                }),
                {} as any,
            );
            expect(result?.user?.uid).toBe("query-user");
        });

        it("falls back to the cookie only when neither the query parameter nor the header supplied a token", () => {
            const strategy = makeStrategy({ allowQueryParam: true });
            const cookieToken = JWTUtils.createTokenSync(authConfig, { uid: "cookie-user" });
            const result = strategy.authenticateSync(makeReq({ cookies: { jwt: cookieToken } }), {} as any);
            expect(result?.user?.uid).toBe("cookie-user");
        });
    });
});

describe("JWTStrategy.authenticate (async)", () => {
    it("returns the authenticated user for a valid token in the Authorization header", async () => {
        const strategy = makeStrategy();
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const result = await strategy.authenticate(makeReq({ headers: { authorization: `jwt ${token}` } }), {} as any);
        expect(result?.user?.uid).toBe("u1");
        expect(result?.method).toBe("jwt");
    });

    it("returns undefined when no token is found and auth is not required", async () => {
        const strategy = makeStrategy();
        const result = await strategy.authenticate(makeReq(), {} as any);
        expect(result).toBeUndefined();
    });
});

describe("JWTStrategy.authenticateSync", () => {
    it("returns undefined when no token is found and auth is not required", () => {
        const strategy = makeStrategy();
        expect(strategy.authenticateSync(makeReq(), {} as any)).toBeUndefined();
    });

    it("returns undefined when no token is found and auth is not required", () => {
        const strategy = makeStrategy();
        const result = strategy.authenticateSync(makeReq(), {} as any);
        expect(result).toBeUndefined();
    });
});

describe("JWTStrategy session updates", () => {
    it("does not touch req.session when it is undefined", async () => {
        const strategy = makeStrategy();
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const req = makeReq({ headers: { authorization: `jwt ${token}` } });
        expect(req.session).toBeUndefined();

        await strategy.authenticate(req, {} as any);
        expect(req.session).toBeUndefined();
    });

    it("does not create a session on failed authentication", async () => {
        const strategy = makeStrategy();
        const req = makeReq({ session: {} });

        await strategy.authenticate(req, {} as any);
        expect(req.session).toEqual({});
    });

    it("populates ip, lastAccess and userUid on the session (async)", async () => {
        const strategy = makeStrategy();
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const req = makeReq({
            headers: { authorization: `jwt ${token}` },
            session: {},
            socket: { remoteAddress: "203.0.113.5" },
        });

        const before = Date.now();
        const result = await strategy.authenticate(req, {} as any);
        const after = Date.now();

        expect(result?.user?.uid).toBe("u1");
        expect(req.session.ip).toBe("203.0.113.5");
        expect(req.session.userUid).toBe("u1");
        expect(req.session.lastAccess).toBeGreaterThanOrEqual(before);
        expect(req.session.lastAccess).toBeLessThanOrEqual(after);
        expect(req.session.lastLogin).toBe(req.session.lastAccess);
    });

    it("populates ip, lastAccess and userUid on the session (sync)", () => {
        const strategy = makeStrategy();
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const req = makeReq({
            headers: { authorization: `jwt ${token}` },
            session: {},
            socket: { remoteAddress: "203.0.113.5" },
        });

        const before = Date.now();
        const result = strategy.authenticateSync(req, {} as any);
        const after = Date.now();

        expect(result?.user?.uid).toBe("u1");
        expect(req.session.ip).toBe("203.0.113.5");
        expect(req.session.userUid).toBe("u1");
        expect(req.session.lastAccess).toBeGreaterThanOrEqual(before);
        expect(req.session.lastAccess).toBeLessThanOrEqual(after);
        expect(req.session.lastLogin).toBe(req.session.lastAccess);
    });

    it("preserves the original lastLogin across subsequent authentications, only advancing lastAccess", async () => {
        const strategy = makeStrategy();
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u1" });
        const req = makeReq({
            headers: { authorization: `jwt ${token}` },
            session: { lastLogin: 12345, lastAccess: 12345 },
            socket: { remoteAddress: "203.0.113.5" },
        });

        await strategy.authenticate(req, {} as any);

        expect(req.session.lastLogin).toBe(12345);
        expect(req.session.lastAccess).toBeGreaterThan(12345);
    });

    it("updates userUid and ip on the session when a different user re-authenticates", async () => {
        const strategy = makeStrategy();
        const token = JWTUtils.createTokenSync(authConfig, { uid: "u2" });
        const req = makeReq({
            headers: { authorization: `jwt ${token}` },
            session: { userUid: "u1", ip: "198.51.100.1", lastLogin: 111, lastAccess: 111 },
            socket: { remoteAddress: "203.0.113.5" },
        });

        await strategy.authenticate(req, {} as any);

        expect(req.session.userUid).toBe("u2");
        expect(req.session.ip).toBe("203.0.113.5");
        expect(req.session.lastLogin).toBe(111);
    });
});

describe("JWTStrategy.init", () => {
    it("warns that cookie auth is disabled when cookieSecure is enabled, since signed-cookie verification isn't implemented", () => {
        const strategy: any = makeStrategy({ cookieSecure: true });
        strategy.logger = { warn: vi.fn() };

        strategy.init();

        expect(strategy.logger.warn).toHaveBeenCalledWith(expect.stringContaining("cookieSecure"));
    });

    it("does not warn when cookieSecure is left at its default (false)", () => {
        const strategy: any = makeStrategy();
        strategy.logger = { warn: vi.fn() };

        strategy.init();

        expect(strategy.logger.warn).not.toHaveBeenCalled();
    });
});
