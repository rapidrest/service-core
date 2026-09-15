///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { RequestHandler } from "../types.js";
import type { SessionManager } from "./SessionManager.js";

/** Builds the `Set-Cookie` header value for a newly-created session ID. */
function buildSessionCookie(mgr: SessionManager, sessionId: string): string {
    const parts = [
        `${mgr.cookieName}=${mgr.signId(sessionId)}`,
        `Path=${mgr.cookiePath}`,
        `Max-Age=${mgr.ttlSeconds}`,
        `SameSite=${mgr.cookieSameSite}`,
        "HttpOnly",
    ];
    if (mgr.cookieSecure) parts.push("Secure");
    return parts.join("; ");
}

/**
 * Builds a global, framework-agnostic session middleware backed by the given `SessionManager`.
 *
 * `req.session` is always an object, and `req.sessionIsNew` tells whether it is backed by a stored session:
 *
 * - When the request carries a validly signed session cookie whose session still exists, `req.session` holds that
 * session's data (`req.sessionIsNew === false`) and any non-empty data is saved back once the response finishes.
 * - Otherwise `req.session` starts out as an empty, unsaved object (`req.sessionIsNew === true`). Nothing is stored
 * and no cookie is sent unless a handler explicitly asks for a session by writing to it (setting, defining or
 * deleting a property, or assigning a new object to `req.session`). The first such write issues a fresh session ID
 * via `Set-Cookie`, and the data is saved once the response finishes. A write after the response headers were sent
 * can no longer deliver the cookie, so it isn't saved.
 *
 * This keeps clients that never send cookies (e.g. API clients authenticating with a bearer token) from creating a
 * new stored session on every request. Middleware that only records bookkeeping about the caller (last access time,
 * IP address, ...) should skip `req.session` when `req.sessionIsNew` is `true`.
 */
export function createSessionMiddleware(mgr: SessionManager): RequestHandler {
    return async (req, res, next) => {
        const raw = req.cookies?.[mgr.cookieName];
        const verifiedId = raw ? mgr.verifyId(raw) : undefined;
        const loaded = verifiedId ? await mgr.load(verifiedId) : undefined;

        if (verifiedId && loaded) {
            req.session = loaded;
            req.sessionIsNew = false;
            res.onFinish(async () => {
                if (req.session && Object.keys(req.session).length > 0) {
                    await mgr.save(verifiedId, req.session);
                }
            });
            next();
            return;
        }

        // No usable session. A stale or tampered cookie is ignored as well, and never reused: a new ID is issued, so
        // a planted cookie can't fix the session ID.
        const sessionId: string = mgr.generateId();
        let requested: boolean = false;
        const requestSession = (): void => {
            if (requested || res.headersSent) {
                return;
            }
            requested = true;
            res.appendHeader("Set-Cookie", buildSessionCookie(mgr, sessionId));
        };

        let current: Record<string, any> = new Proxy<Record<string, any>>(
            {},
            {
                set(target, key, value) {
                    requestSession();
                    return Reflect.set(target, key, value);
                },
                defineProperty(target, key, descriptor) {
                    requestSession();
                    return Reflect.defineProperty(target, key, descriptor);
                },
                deleteProperty(target, key) {
                    requestSession();
                    return Reflect.deleteProperty(target, key);
                },
            },
        );
        Object.defineProperty(req, "session", {
            configurable: true,
            enumerable: true,
            get: () => current,
            set: (value: Record<string, any>) => {
                requestSession();
                current = value;
            },
        });
        req.sessionIsNew = true;

        res.onFinish(async () => {
            if (requested && current && Object.keys(current).length > 0) {
                await mgr.save(sessionId, { ...current });
            }
        });

        next();
    };
}
