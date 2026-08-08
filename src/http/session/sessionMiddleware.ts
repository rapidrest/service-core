///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
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
 * Lazily loads-or-creates `req.session` and persists any mutations back to the store once the
 * response finishes. Cheap for requests that never touch sessions: no store round-trip unless a
 * valid session cookie was actually sent, and no `Set-Cookie`/store write for sessions that end up
 * empty.
 */
export function createSessionMiddleware(mgr: SessionManager): RequestHandler {
    return async (req, res, next) => {
        const raw = req.cookies?.[mgr.cookieName];
        const verifiedId = raw ? mgr.verifyId(raw) : undefined;

        let sessionId = verifiedId;
        let data = sessionId ? await mgr.load(sessionId) : undefined;

        if (!sessionId || !data) {
            sessionId = mgr.generateId();
            data = {};
            res.appendHeader("Set-Cookie", buildSessionCookie(mgr, sessionId));
        }

        req.session = data;

        const finalSessionId = sessionId;
        res.onFinish(async () => {
            if (req.session && Object.keys(req.session).length > 0) {
                await mgr.save(finalSessionId, req.session);
            }
        });

        next();
    };
}
