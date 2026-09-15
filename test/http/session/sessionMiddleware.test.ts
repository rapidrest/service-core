///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { createSessionMiddleware } from "../../../src/http/session/sessionMiddleware";
import type { SessionManager } from "../../../src/http/session/SessionManager";

function makeManager(overrides: Partial<SessionManager> = {}): SessionManager {
    return {
        cookieName: "rrst.sid",
        cookiePath: "/",
        ttlSeconds: 1800,
        cookieSameSite: "Lax",
        cookieSecure: false,
        signId: vi.fn((id: string) => `${id}.sig`),
        verifyId: vi.fn(() => undefined),
        generateId: vi.fn(() => "new-session-id"),
        load: vi.fn().mockResolvedValue(undefined),
        save: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    } as SessionManager;
}

function makeReqRes(cookies: Record<string, string> = {}) {
    let finishHandler: (() => Promise<void>) | undefined;
    const req: any = { cookies };
    const res: any = {
        headersSent: false,
        setHeader: vi.fn(),
        appendHeader: vi.fn(),
        onFinish: (fn: () => Promise<void>) => {
            finishHandler = fn;
        },
        runFinish: async () => finishHandler?.(),
    };
    return { req, res };
}

describe("createSessionMiddleware Tests", () => {
    it("gives a cookie-less request an empty, unsaved session without setting a cookie", async () => {
        const mgr = makeManager();
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes();
        const next = vi.fn();

        await middleware(req, res, next);

        expect(req.session).toEqual({});
        expect(req.sessionIsNew).toBe(true);
        expect(res.appendHeader).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalled();

        await res.runFinish();
        expect(mgr.save).not.toHaveBeenCalled();
    });

    it("never stores a session for repeated cookie-less requests that don't write to it", async () => {
        const mgr = makeManager();
        const middleware = createSessionMiddleware(mgr);
        for (let i = 0; i < 10; i++) {
            const { req, res } = makeReqRes();
            await middleware(req, res, vi.fn());
            // Reading the session, as auth bookkeeping guarded by `sessionIsNew` would, is not a request for one.
            expect(req.session.userUid).toBeUndefined();
            await res.runFinish();
        }
        expect(mgr.save).not.toHaveBeenCalled();
    });

    it("creates the session and sets the cookie once a handler writes to it", async () => {
        const mgr = makeManager();
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes();

        await middleware(req, res, vi.fn());
        req.session.uid = "user-1";
        req.session.role = "admin";

        expect(mgr.generateId).toHaveBeenCalledTimes(1);
        expect(res.appendHeader).toHaveBeenCalledTimes(1);
        expect(res.appendHeader).toHaveBeenCalledWith(
            "Set-Cookie",
            expect.stringContaining("rrst.sid=new-session-id.sig"),
        );

        await res.runFinish();
        expect(mgr.save).toHaveBeenCalledWith("new-session-id", { uid: "user-1", role: "admin" });
    });

    it("includes Secure in the cookie when cookieSecure is true", async () => {
        const mgr = makeManager({ cookieSecure: true });
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes();

        await middleware(req, res, vi.fn());
        req.session.uid = "user-1";

        expect(res.appendHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("Secure"));
    });

    it("treats defineProperty, delete and assigning a new object as requests for a session", async () => {
        const mgr = makeManager();
        const middleware = createSessionMiddleware(mgr);

        const defined = makeReqRes();
        await middleware(defined.req, defined.res, vi.fn());
        Object.defineProperty(defined.req.session, "uid", { value: "u1", enumerable: true });
        expect(defined.res.appendHeader).toHaveBeenCalledTimes(1);

        const deleted = makeReqRes();
        await middleware(deleted.req, deleted.res, vi.fn());
        delete deleted.req.session.uid;
        expect(deleted.res.appendHeader).toHaveBeenCalledTimes(1);
        await deleted.res.runFinish();
        // Requested, but still empty: nothing to save.
        expect(mgr.save).not.toHaveBeenCalled();

        const assigned = makeReqRes();
        await middleware(assigned.req, assigned.res, vi.fn());
        assigned.req.session = { uid: "u2" };
        expect(assigned.res.appendHeader).toHaveBeenCalledTimes(1);
        expect(assigned.req.session).toEqual({ uid: "u2" });
        await assigned.res.runFinish();
        expect(mgr.save).toHaveBeenCalledWith("new-session-id", { uid: "u2" });
    });

    it("does not save a new session first written after the response headers were sent", async () => {
        const mgr = makeManager();
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes();

        await middleware(req, res, vi.fn());
        res.headersSent = true;
        req.session.uid = "too-late";
        await res.runFinish();

        expect(res.appendHeader).not.toHaveBeenCalled();
        expect(mgr.save).not.toHaveBeenCalled();
    });

    it("loads an existing session when a valid cookie is present", async () => {
        const mgr = makeManager({
            verifyId: vi.fn(() => "existing-id"),
            load: vi.fn().mockResolvedValue({ uid: "user-1" }),
        });
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes({ "rrst.sid": "existing-id.sig" });

        await middleware(req, res, vi.fn());

        expect(mgr.load).toHaveBeenCalledWith("existing-id");
        expect(req.session).toEqual({ uid: "user-1" });
        expect(req.sessionIsNew).toBe(false);
        expect(res.appendHeader).not.toHaveBeenCalled();
    });

    it("saves an existing session on finish when it has data, and skips it when removed", async () => {
        const mgr = makeManager({
            verifyId: vi.fn(() => "existing-id"),
            load: vi.fn().mockImplementation(async () => ({ uid: "user-1" })),
        });
        const middleware = createSessionMiddleware(mgr);

        const kept = makeReqRes({ "rrst.sid": "existing-id.sig" });
        await middleware(kept.req, kept.res, vi.fn());
        kept.req.session.lastAccess = 1;
        await kept.res.runFinish();
        expect(mgr.save).toHaveBeenCalledWith("existing-id", { uid: "user-1", lastAccess: 1 });

        (mgr.save as any).mockClear();
        const removed = makeReqRes({ "rrst.sid": "existing-id.sig" });
        await middleware(removed.req, removed.res, vi.fn());
        removed.req.session = undefined;
        await removed.res.runFinish();
        expect(mgr.save).not.toHaveBeenCalled();
    });

    it("ignores a cookie with an invalid signature and only issues a new session on write", async () => {
        const mgr = makeManager({ verifyId: vi.fn(() => undefined) });
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes({ "rrst.sid": "tampered.sig" });

        await middleware(req, res, vi.fn());

        expect(mgr.load).not.toHaveBeenCalled();
        expect(req.sessionIsNew).toBe(true);
        expect(res.appendHeader).not.toHaveBeenCalled();
        req.session.uid = "u1";
        expect(res.appendHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("new-session-id"));
    });

    it("issues a new session ID (never reusing the stale one) when the verified ID has no stored data", async () => {
        const mgr = makeManager({
            verifyId: vi.fn(() => "missing-id"),
            load: vi.fn().mockResolvedValue(undefined),
        });
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes({ "rrst.sid": "missing-id.sig" });

        await middleware(req, res, vi.fn());
        expect(req.sessionIsNew).toBe(true);
        expect(res.appendHeader).not.toHaveBeenCalled();

        req.session.uid = "u1";
        await res.runFinish();
        expect(mgr.generateId).toHaveBeenCalled();
        expect(mgr.save).toHaveBeenCalledWith("new-session-id", { uid: "u1" });
    });
});
