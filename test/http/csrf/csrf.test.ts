///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ApiError } from "@rapidrest/core";
import {
    DEFAULT_CSRF_COOKIE_NAME,
    DEFAULT_CSRF_HEADER_NAME,
    buildCsrfCookie,
    createCsrfMiddleware,
    ensureCsrfCookie,
    generateCsrfToken,
    verifyCsrfRequest,
} from "../../../src/http/csrf/csrf";
import { ApiErrors } from "../../../src/ApiErrors";

function makeReq(overrides: any = {}): any {
    return { method: "POST", path: "/widgets", headers: {}, cookies: {}, ...overrides };
}

function makeRes(): any {
    return { appendHeader: vi.fn().mockReturnThis(), setHeader: vi.fn() };
}

describe("generateCsrfToken", () => {
    it("returns a non-empty, URL-safe token and never repeats itself", () => {
        const a = generateCsrfToken();
        const b = generateCsrfToken();
        expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(a.length).toBeGreaterThan(20);
        expect(a).not.toEqual(b);
    });
});

describe("buildCsrfCookie", () => {
    it("builds a Secure, SameSite=Lax, non-HttpOnly cookie with no Domain attribute by default", () => {
        const header = buildCsrfCookie("tok123");
        expect(header).toBe("csrf=tok123; Path=/; SameSite=Lax; Secure");
        expect(header).not.toContain("Domain=");
        expect(header).not.toContain("HttpOnly");
    });

    it("honors a custom name, path, maxAge and sameSite", () => {
        const header = buildCsrfCookie("tok123", { name: "xcsrf", path: "/api", maxAge: 3600, sameSite: "Strict" });
        expect(header).toBe("xcsrf=tok123; Path=/api; SameSite=Strict; Max-Age=3600; Secure");
    });

    it("omits Secure when secure: false (plain-HTTP local dev)", () => {
        const header = buildCsrfCookie("tok123", { secure: false });
        expect(header).not.toContain("Secure");
    });

    it("builds a clearing cookie (Max-Age=0) for an empty token, ignoring any configured maxAge", () => {
        const header = buildCsrfCookie("", { maxAge: 3600 });
        expect(header).toBe("csrf=; Path=/; SameSite=Lax; Max-Age=0; Secure");
    });
});

describe("ensureCsrfCookie", () => {
    it("issues a fresh cookie and returns its value when the request carries none", () => {
        const req = makeReq({ cookies: {} });
        const res = makeRes();
        const token = ensureCsrfCookie(req, res);
        expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(res.appendHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining(`${DEFAULT_CSRF_COOKIE_NAME}=${token}`));
    });

    it("returns the existing cookie value and issues nothing when one is already present", () => {
        const req = makeReq({ cookies: { csrf: "existing-token" } });
        const res = makeRes();
        const token = ensureCsrfCookie(req, res);
        expect(token).toBe("existing-token");
        expect(res.appendHeader).not.toHaveBeenCalled();
    });

    it("honors a configured cookie name", () => {
        const req = makeReq({ cookies: {} });
        const res = makeRes();
        ensureCsrfCookie(req, res, { cookieName: "xcsrf" });
        expect(res.appendHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("xcsrf="));
    });
});

describe("verifyCsrfRequest", () => {
    it("defaults to GET (a safe, always-passing method) when req.method is unset", () => {
        const req = makeReq({ cookies: {} });
        delete req.method;
        expect(() => verifyCsrfRequest(req)).not.toThrow();
    });

    it("reads the first value when a header arrives as an array (e.g. a duplicated Origin header)", () => {
        const req = makeReq({
            cookies: { csrf: "tok-abc" },
            headers: { "x-csrf-token": ["tok-abc", "tok-other"] },
        });
        expect(() => verifyCsrfRequest(req)).not.toThrow();
    });

    it("passes GET/HEAD/OPTIONS requests without any token present", () => {
        for (const method of ["GET", "HEAD", "OPTIONS"]) {
            expect(() => verifyCsrfRequest(makeReq({ method, cookies: {} }))).not.toThrow();
        }
    });

    it("passes any method when enabled: false", () => {
        expect(() => verifyCsrfRequest(makeReq({ cookies: {} }), { enabled: false })).not.toThrow();
    });

    it("passes a same-origin mutating request whose cookie and header match", () => {
        const req = makeReq({
            cookies: { csrf: "tok-abc" },
            headers: { "x-csrf-token": "tok-abc", origin: "https://mail.example.com", host: "mail.example.com" },
        });
        expect(() => verifyCsrfRequest(req)).not.toThrow();
    });

    it("rejects a same-origin mutating request with no CSRF cookie at all", () => {
        const req = makeReq({ cookies: {}, headers: { "x-csrf-token": "tok-abc" } });
        expect(() => verifyCsrfRequest(req)).toThrow(ApiError);
        try {
            verifyCsrfRequest(req);
            throw new Error("expected verifyCsrfRequest to throw");
        } catch (err: any) {
            expect(err.code).toBe(ApiErrors.AUTH_CSRF_FAILURE);
            expect(err.status).toBe(403);
        }
    });

    it("rejects a same-origin mutating request with no header at all", () => {
        const req = makeReq({ cookies: { csrf: "tok-abc" }, headers: {} });
        expect(() => verifyCsrfRequest(req)).toThrow(ApiError);
    });

    it("rejects when the cookie and header values differ", () => {
        const req = makeReq({ cookies: { csrf: "tok-abc" }, headers: { "x-csrf-token": "tok-xyz" } });
        expect(() => verifyCsrfRequest(req)).toThrow(ApiError);
    });

    it("rejects when the cookie and header values differ only in length (defeats a naive substring check)", () => {
        const req = makeReq({ cookies: { csrf: "tok-abc" }, headers: { "x-csrf-token": "tok-abcdef" } });
        expect(() => verifyCsrfRequest(req)).toThrow(ApiError);
    });

    it("is case-insensitive about the header name it reads", () => {
        // HttpRequest.headers is always lower-cased by both HTTP adapters — simulate that here.
        const req = makeReq({ cookies: { csrf: "tok-abc" }, headers: { "x-csrf-token": "tok-abc" } });
        expect(() => verifyCsrfRequest(req, { headerName: "X-CSRF-Token" })).not.toThrow();
    });

    it("honors a configured cookie/header name pair", () => {
        const req = makeReq({ cookies: { xcsrf: "tok-abc" }, headers: { "x-my-csrf": "tok-abc" } });
        expect(() => verifyCsrfRequest(req, { cookieName: "xcsrf", headerName: "x-my-csrf" })).not.toThrow();
    });

    it("rejects a request whose Origin isn't in the allow-list, even for an otherwise-valid double-submit pair", () => {
        const req = makeReq({
            cookies: { csrf: "tok-abc" },
            headers: { "x-csrf-token": "tok-abc", origin: "https://evil.example.com", host: "mail.example.com" },
        });
        expect(() => verifyCsrfRequest(req, { allowedOrigins: ["https://mail.example.com"] })).toThrow(ApiError);
    });

    it("passes a same-origin request whose Origin is in the allow-list", () => {
        const req = makeReq({
            cookies: { csrf: "tok-abc" },
            headers: { "x-csrf-token": "tok-abc", origin: "https://mail.example.com", host: "mail.example.com" },
        });
        expect(() => verifyCsrfRequest(req, { allowedOrigins: ["https://mail.example.com"] })).not.toThrow();
    });

    it("falls back to Referer when Origin is absent", () => {
        const req = makeReq({
            cookies: { csrf: "tok-abc" },
            headers: {
                "x-csrf-token": "tok-abc",
                referer: "https://evil.example.com/some/page",
                host: "mail.example.com",
            },
        });
        expect(() => verifyCsrfRequest(req, { allowedOrigins: ["https://mail.example.com"] })).toThrow(ApiError);
    });

    it("treats an unparseable Referer as no-origin-known when Origin is also absent (falls through to the double-submit check)", () => {
        const req = makeReq({
            cookies: { csrf: "tok-abc" },
            headers: { "x-csrf-token": "tok-abc", referer: "not a url either", host: "mail.example.com" },
        });
        expect(() => verifyCsrfRequest(req, { allowedOrigins: ["https://mail.example.com"] })).not.toThrow();
    });

    it("passes a cross-origin request whose Origin is explicitly allow-listed, without needing a matching cookie/header pair", () => {
        // The whole point: react-shared's authApiFetch() drives auth-server cross-origin (e.g. from an admin
        // console on mail.example.com), and its JavaScript can never read auth-server's host-only CSRF
        // cookie. The Origin allow-list is the only defense available to this call shape.
        const req = makeReq({
            cookies: {},
            headers: { origin: "https://mail.example.com", host: "auth.example.com" },
        });
        expect(() => verifyCsrfRequest(req, { allowedOrigins: ["https://mail.example.com"] })).not.toThrow();
    });

    it("rejects a cross-origin request when no allow-list is configured at all (fail closed)", () => {
        const req = makeReq({ cookies: {}, headers: { origin: "https://mail.example.com", host: "auth.example.com" } });
        expect(() => verifyCsrfRequest(req)).toThrow(ApiError);
    });

    it("treats an unparseable Origin header as same-origin (falls through to the double-submit check)", () => {
        const req = makeReq({
            cookies: { csrf: "tok-abc" },
            headers: { "x-csrf-token": "tok-abc", origin: "not a url", host: "mail.example.com" },
        });
        expect(() => verifyCsrfRequest(req)).not.toThrow();
    });

    it("ignores a scheme mismatch between Origin and Host (TLS-terminating proxy) when checking cross-origin-ness", () => {
        const req = makeReq({
            cookies: { csrf: "tok-abc" },
            headers: { "x-csrf-token": "tok-abc", origin: "https://mail.example.com", host: "mail.example.com" },
        });
        // Host has no scheme at all — still resolves to the same-origin path and requires the double-submit pair.
        expect(() => verifyCsrfRequest(req)).not.toThrow();
    });

    it("logs a warning with the rejection reason but never the token values", () => {
        const warn = vi.fn();
        const req = makeReq({ cookies: {}, headers: {} });
        expect(() => verifyCsrfRequest(req, { logger: { warn } })).toThrow();
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("Rejected"));
    });
});

describe("createCsrfMiddleware", () => {
    it("lazily issues a cookie and calls next() for a request with no cookie-sourced auth", async () => {
        const middleware = createCsrfMiddleware();
        const req = makeReq({ cookies: {}, auth: undefined });
        const res = makeRes();
        const next = vi.fn();
        await middleware(req, res, next);
        expect(res.appendHeader).toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith();
    });

    it("calls next() with no error for a valid cookie-authenticated request with a matching token", async () => {
        const middleware = createCsrfMiddleware();
        const req = makeReq({
            cookies: { csrf: "tok-abc" },
            headers: { "x-csrf-token": "tok-abc" },
            auth: { source: "cookie" },
        });
        const res = makeRes();
        const next = vi.fn();
        await middleware(req, res, next);
        expect(next).toHaveBeenCalledWith();
    });

    it("calls next(err) for a cookie-authenticated request missing a valid CSRF token", async () => {
        const middleware = createCsrfMiddleware();
        const req = makeReq({ cookies: { csrf: "tok-abc" }, headers: {}, auth: { source: "cookie" } });
        const res = makeRes();
        const next = vi.fn();
        await middleware(req, res, next);
        expect(next).toHaveBeenCalledWith(expect.any(ApiError));
    });

    it("issues no cookie and enforces nothing when enabled: false", async () => {
        const middleware = createCsrfMiddleware({ enabled: false });
        const req = makeReq({ cookies: {}, headers: {}, auth: { source: "cookie" } });
        const res = makeRes();
        const next = vi.fn();
        await middleware(req, res, next);
        expect(res.appendHeader).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith();
    });

    it("never enforces the check for a bearer/header-sourced credential", async () => {
        const middleware = createCsrfMiddleware();
        const req = makeReq({ cookies: {}, headers: {}, auth: { source: "header" } });
        const res = makeRes();
        const next = vi.fn();
        await middleware(req, res, next);
        expect(next).toHaveBeenCalledWith();
    });
});

describe("DEFAULT_CSRF_COOKIE_NAME / DEFAULT_CSRF_HEADER_NAME", () => {
    it("are the documented defaults", () => {
        expect(DEFAULT_CSRF_COOKIE_NAME).toBe("csrf");
        expect(DEFAULT_CSRF_HEADER_NAME).toBe("x-csrf-token");
    });
});
