///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
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

    it("throws when no token is found and auth is required", () => {
        const strategy = makeStrategy();
        expect(() => strategy.authenticateSync(makeReq(), {} as any, true)).toThrow("Invalid or missing auth token.");
    });
});
