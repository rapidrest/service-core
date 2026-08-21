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
    it("creates a new session and sets a cookie when none was sent", async () => {
        const mgr = makeManager();
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes();
        const next = vi.fn();

        await middleware(req, res, next);

        expect(mgr.generateId).toHaveBeenCalled();
        expect(res.appendHeader).toHaveBeenCalledWith(
            "Set-Cookie",
            expect.stringContaining("rrst.sid=new-session-id.sig"),
        );
        expect(req.session).toEqual({});
        expect(next).toHaveBeenCalled();
    });

    it("includes Secure in the cookie when cookieSecure is true", async () => {
        const mgr = makeManager({ cookieSecure: true });
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes();

        await middleware(req, res, vi.fn());

        expect(res.appendHeader).toHaveBeenCalledWith("Set-Cookie", expect.stringContaining("Secure"));
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
        expect(res.appendHeader).not.toHaveBeenCalled();
    });

    it("creates a new session when the cookie signature is invalid", async () => {
        const mgr = makeManager({ verifyId: vi.fn(() => undefined) });
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes({ "rrst.sid": "tampered.sig" });

        await middleware(req, res, vi.fn());

        expect(mgr.load).not.toHaveBeenCalled();
        expect(res.appendHeader).toHaveBeenCalled();
    });

    it("creates a new session when the verified ID has no stored data", async () => {
        const mgr = makeManager({
            verifyId: vi.fn(() => "missing-id"),
            load: vi.fn().mockResolvedValue(undefined),
        });
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes({ "rrst.sid": "missing-id.sig" });

        await middleware(req, res, vi.fn());

        expect(mgr.generateId).toHaveBeenCalled();
        expect(res.appendHeader).toHaveBeenCalled();
    });

    it("saves the session on finish when it has data", async () => {
        const mgr = makeManager();
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes();

        await middleware(req, res, vi.fn());
        req.session.uid = "user-1";
        await res.runFinish();

        expect(mgr.save).toHaveBeenCalledWith("new-session-id", { uid: "user-1" });
    });

    it("does not save the session on finish when it is empty", async () => {
        const mgr = makeManager();
        const middleware = createSessionMiddleware(mgr);
        const { req, res } = makeReqRes();

        await middleware(req, res, vi.fn());
        await res.runFinish();

        expect(mgr.save).not.toHaveBeenCalled();
    });
});
