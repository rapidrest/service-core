///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import * as crypto from "crypto";
import { ApiError } from "@rapidrest/core";
import { ApiErrorMessages, ApiErrors } from "../../ApiErrors.js";
import type { HttpRequest, HttpResponse, RequestHandler } from "../types.js";

/**
 * Double-submit CSRF protection for the `jwt` cookie that `@rapidrest/auth`'s `TokenUtils` issues (see
 * that library's `CsrfUtils`, which rotates this same cookie at login/elevation/logout). This module is
 * the shared, framework-agnostic core: `RouteUtils.checkCsrf()` wires it into every route's middleware
 * chain automatically, and `createCsrfMiddleware()` below offers the same check as a standalone global
 * middleware for a service that doesn't go through `RouteUtils` (or wants it registered once instead of
 * per-route). `auth`'s route handlers that read `req.session` directly instead of going through the
 * `jwt`-cookie auth path (e.g. the OAuth `/authorize/consent` route) call `verifyCsrfRequest()` by hand —
 * see that route's own doc comment for why it can't rely on the automatic, `req.auth`-keyed gate.
 *
 * ## Why this is a host-only cookie, not a naive double-submit
 *
 * The `jwt`/`refresh` cookies `TokenUtils` issues are commonly configured with a wildcard `Domain`
 * (e.g. `.example.com`) so a single sign-in is shared across sibling subdomains (`mail.example.com`,
 * `auth.example.com`, ...) — that's the whole point of a shared SSO cookie. A *naive* double-submit CSRF
 * cookie sharing that same wildcard `Domain` would defeat itself: `document.cookie` on *any* sibling
 * subdomain can read a wildcard-domain cookie, so a same-site page that isn't the app itself (a
 * compromised or merely less-trusted subdomain, a multi-tenant customer subdomain, ...) could read the
 * "secret" double-submit value and echo it right back — exactly the value this scheme exists to keep
 * out of an attacker's hands. `SameSite=Lax` doesn't help here either: it blocks genuine cross-*site*
 * forgery, but `auth.example.com` and `mail.example.com` are cross-*origin*, same-*site* — Lax cookies
 * are still attached.
 *
 * `buildCsrfCookie()` below therefore never emits a `Domain` attribute: the cookie this module issues is
 * always host-only, readable only by script running on the exact host that set it. That closes the
 * sibling-subdomain-reads-the-cookie hole, but it also means a *legitimately* cross-origin caller (e.g.
 * `react-shared`'s `authApiFetch()`, used by an admin console on `mail.example.com` to drive
 * impersonation on `auth.example.com`) can never read this cookie either — there is no way for it to
 * supply a matching header. `verifyCsrfRequest()` handles that case by falling back to an Origin/Referer
 * allow-list check for any request whose Origin doesn't match the host it arrived on: the browser only
 * ever sends such a request in the first place because the target's CORS policy already named that exact
 * origin as trusted (see `Server.ts`'s CORS middleware, which reflects `Access-Control-Allow-Origin` only
 * for an exact, explicitly configured match — never a wildcard-with-credentials), so re-checking the same
 * allow-list server-side is a legitimate, independent proof for a cross-origin request in a way that
 * would not exist for a same-origin one.
 */

/** Default name of the double-submit CSRF cookie. */
export const DEFAULT_CSRF_COOKIE_NAME = "csrf";

/** Default name of the request header a caller echoes the CSRF cookie's value back on. */
export const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";

/** HTTP methods exempt from CSRF checks — by definition never supposed to mutate state. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Cookie-shape options accepted by `buildCsrfCookie()`. */
export interface CsrfCookieOptions {
    /** The cookie's name. Default `"csrf"` (`DEFAULT_CSRF_COOKIE_NAME`). */
    name?: string;
    /** The `Path` attribute. Default `/`. */
    path?: string;
    /** The `Max-Age` attribute, in seconds. Omitted (session cookie) if not set. */
    maxAge?: number;
    /** The `SameSite` attribute. Default `Lax`. */
    sameSite?: "Strict" | "Lax" | "None";
    /** Set to `false` to omit the `Secure` (HTTPS-only) attribute — only for plain-HTTP local dev. Default `true`. */
    secure?: boolean;
}

/** Generates a new, cryptographically random CSRF token, matching `OIDCStrategy`'s own `state`-token style. */
export function generateCsrfToken(): string {
    return crypto.randomBytes(32).toString("base64url");
}

/**
 * Builds the `Set-Cookie` header value for the CSRF cookie. Pass an empty string for `token` to build a
 * header that immediately clears the cookie instead (mirrors `TokenUtils.buildCookie()`'s own clearing
 * convention in `@rapidrest/auth`).
 *
 * Deliberately never emits a `Domain` attribute, even though the sibling `jwt`/`refresh` cookies often do
 * — see this module's doc comment for why a wide-open `Domain` here would defeat the whole scheme.
 * Deliberately never emits `HttpOnly` either: browser JavaScript reading this cookie and echoing it back
 * as a header is the entire mechanism.
 */
export function buildCsrfCookie(token: string, options: CsrfCookieOptions = {}): string {
    const clearing = token === "";
    const parts: string[] = [`${options.name ?? DEFAULT_CSRF_COOKIE_NAME}=${token}`, `Path=${options.path ?? "/"}`];
    parts.push(`SameSite=${options.sameSite ?? "Lax"}`);
    if (clearing) {
        parts.push("Max-Age=0");
    } else if (options.maxAge !== undefined) {
        parts.push(`Max-Age=${options.maxAge}`);
    }
    if (options.secure !== false) {
        parts.push("Secure");
    }
    return parts.join("; ");
}

/** Constant-time string comparison. Rejects a length mismatch up front — `crypto.timingSafeEqual()` throws on one
 * rather than returning `false`, and comparing lengths first is itself safe (a token's length isn't a secret). */
function timingSafeEqualStr(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length > 0 && bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
    return Array.isArray(value) ? value[0] : value;
}

/** Extracts `scheme://host` from a full URL string (e.g. a `Referer` header), or `undefined` if unparseable. */
function originOf(url: string | undefined): string | undefined {
    if (!url) {
        return undefined;
    }
    try {
        const parsed = new URL(url);
        return `${parsed.protocol}//${parsed.host}`;
    } catch {
        return undefined;
    }
}

/** Extracts just the `host` (hostname[:port], no scheme) portion of an origin string, or `undefined` if unparseable. */
function hostOf(origin: string | undefined): string | undefined {
    if (!origin) {
        return undefined;
    }
    try {
        return new URL(origin).host;
    } catch {
        return undefined;
    }
}

/** Options shared by `ensureCsrfCookie()`/`verifyCsrfRequest()`/`createCsrfMiddleware()`. */
export interface CsrfCheckOptions {
    /** Set to `false` to disable the check entirely (still leaves lazy cookie issuance in place). Default `true`. */
    enabled?: boolean;
    /** The CSRF cookie's name. Default `"csrf"`. */
    cookieName?: string;
    /** The header a caller must echo the cookie's value on. Default `"x-csrf-token"`. */
    headerName?: string;
    /** `Max-Age` (seconds) for a lazily-issued cookie. Omitted (session cookie) if not set. */
    maxAge?: number;
    /** Set to `false` to omit `Secure` from a lazily-issued cookie — plain-HTTP local dev only. Default `true`. */
    secure?: boolean;
    /**
     * Explicit allow-list of trusted browser origins (e.g. `["https://mail.example.com"]`), used for the
     * Origin/Referer check described in this module's doc comment. Typically the same list already
     * configured for CORS (`cors:origins`) — callers default to that when this is left unset.
     */
    allowedOrigins?: string[];
    /** Optional logger for a rejected request's reason — never logs the token values themselves. */
    logger?: { warn?: (msg: string) => void };
}

/**
 * Ensures the caller holds a CSRF cookie, issuing one via `Set-Cookie` if it doesn't already have a valid
 * one — the standard "set on first visit" double-submit pattern (matches Django/Rails), and what lets a
 * service that never itself issues auth cookies (e.g. `server`/`restapi`, which only ever verify a `jwt`
 * cookie someone else set) still adopt this mechanism on its own. Returns the (possibly freshly-generated)
 * token value.
 */
export function ensureCsrfCookie(req: HttpRequest, res: HttpResponse, options: CsrfCheckOptions = {}): string {
    const cookieName = options.cookieName ?? DEFAULT_CSRF_COOKIE_NAME;
    const existing = req.cookies?.[cookieName];
    if (existing) {
        return existing;
    }
    const token = generateCsrfToken();
    res.appendHeader(
        "Set-Cookie",
        buildCsrfCookie(token, { name: cookieName, maxAge: options.maxAge, secure: options.secure }),
    );
    return token;
}

/**
 * Verifies `req` against the double-submit CSRF cookie plus Origin/Referer allow-list, per the scheme
 * documented at the top of this module. Throws an `ApiError` (`AUTH_CSRF_FAILURE`, 403) on failure. A safe
 * method (`GET`/`HEAD`/`OPTIONS`) or `options.enabled === false` always passes without throwing.
 *
 * This does *not* check `req.auth?.source` — that gate belongs to the caller (see `RouteUtils.checkCsrf()`,
 * which only calls this when `req.auth?.source === "cookie"`). A caller like `BaseOAuthAuthorizeRoute`'s
 * `decideConsent()`, which authenticates via `req.session` instead of a JWT, calls this unconditionally
 * for exactly that reason.
 */
export function verifyCsrfRequest(req: HttpRequest, options: CsrfCheckOptions = {}): void {
    if (options.enabled === false) {
        return;
    }
    const method = (req.method || "GET").toUpperCase();
    if (SAFE_METHODS.has(method)) {
        return;
    }

    const cookieName = options.cookieName ?? DEFAULT_CSRF_COOKIE_NAME;
    const headerName = (options.headerName ?? DEFAULT_CSRF_HEADER_NAME).toLowerCase();
    const allowedOrigins = options.allowedOrigins ?? [];

    const originHeader = firstHeaderValue(req.headers["origin"]);
    const refererHeader = firstHeaderValue(req.headers["referer"] ?? req.headers["referrer"]);
    const effectiveOrigin = originHeader ?? originOf(refererHeader);

    const hostHeader = firstHeaderValue(req.headers["host"]);
    const originHost = hostOf(effectiveOrigin);
    // Scheme is deliberately not part of this comparison: a TLS-terminating proxy commonly forwards a
    // plain-HTTP request to this process for an origin the browser saw as `https://`, and that mismatch
    // alone must never be treated as cross-origin.
    const crossOrigin = !!originHost && !!hostHeader && originHost !== hostHeader;

    // Defense in depth, checked regardless of same/cross-origin whenever an Origin (or Referer fallback)
    // is present and an allow-list is configured: a same-origin request forging its own Origin header is
    // not something a browser lets a page do, so this mainly guards against a misconfigured proxy or a
    // non-browser replay of a stolen cookie pair.
    if (effectiveOrigin && allowedOrigins.length > 0 && !allowedOrigins.includes(effectiveOrigin)) {
        options.logger?.warn?.(`[CSRF] Rejected ${method} ${req.path} — origin '${effectiveOrigin}' is not allow-listed.`);
        throw new ApiError(ApiErrors.AUTH_CSRF_FAILURE, 403, ApiErrorMessages.AUTH_CSRF_FAILURE);
    }

    if (crossOrigin) {
        // A cross-origin caller's own JavaScript cannot read this host's host-only CSRF cookie (see this
        // module's doc comment), so the double-submit check below is structurally unsatisfiable for it —
        // the Origin allow-list check above is this request's only available CSRF defense. Fail closed if
        // there's no allow-list configured at all: nothing here proved the request legitimate.
        if (allowedOrigins.length === 0) {
            options.logger?.warn?.(`[CSRF] Rejected cross-origin ${method} ${req.path} — no CSRF allow-list configured.`);
            throw new ApiError(ApiErrors.AUTH_CSRF_FAILURE, 403, ApiErrorMessages.AUTH_CSRF_FAILURE);
        }
        return;
    }

    const cookieToken = req.cookies?.[cookieName];
    const headerToken = firstHeaderValue(req.headers[headerName]);
    if (!cookieToken || !headerToken || !timingSafeEqualStr(cookieToken, headerToken)) {
        options.logger?.warn?.(`[CSRF] Rejected ${method} ${req.path} — missing or mismatched '${headerName}' header.`);
        throw new ApiError(ApiErrors.AUTH_CSRF_FAILURE, 403, ApiErrorMessages.AUTH_CSRF_FAILURE);
    }
}

/**
 * Standalone global-middleware form of the same check `RouteUtils.checkCsrf()` installs automatically on
 * every route. Useful for a service that registers its own middleware chain directly instead of going
 * through `RouteUtils` (or that wants a single global registration instead of a per-route one). Always
 * lazily issues the cookie first (see `ensureCsrfCookie()`), then enforces the check only when
 * `req.auth?.source === "cookie"` — the same gate `RouteUtils.checkCsrf()` uses.
 */
export function createCsrfMiddleware(options: CsrfCheckOptions = {}): RequestHandler {
    return (req: HttpRequest, res: HttpResponse, next) => {
        if (options.enabled !== false) {
            ensureCsrfCookie(req, res, options);
        }
        if (req.auth?.source !== "cookie") {
            next();
            return;
        }
        try {
            verifyCsrfRequest(req, options);
            next();
        } catch (err) {
            next(err);
        }
    };
}
