///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import jwt from "jsonwebtoken";
import { AuthMiddleware } from "../../src/auth/AuthMiddleware";
import type { AuthResult, AuthStrategy } from "../../src/auth/AuthStrategy";
import { JWTUtils } from "@rapidrest/core";
import config from "../config";

// A token that decodes successfully (valid signature/claims) but whose profile has no `uid` — this
// is the only way to reach the "loginUser && loginUser.uid" false branch without JWTUtils.decodeTokenSync
// throwing first (a malformed/garbage token throws before that check is ever reached).
function makeNoUidToken(): string {
    const authConfig = config.get("auth");
    return jwt.sign({ profile: JSON.stringify({ name: "no-uid" }) }, authConfig.secret, authConfig.options);
}

function makeStrategy(overrides: Partial<AuthStrategy> = {}): AuthStrategy {
    return {
        name: "test",
        authenticate: vi.fn().mockResolvedValue(undefined),
        authenticateSync: vi.fn().mockReturnValue(undefined),
        ...overrides,
    };
}

function makeSocket() {
    const handlers: Record<string, Function[]> = {};
    // Keeps a reference to every callback ever registered, even after `removeListener` has
    // unregistered it from `handlers` — needed to simulate a listener firing concurrently with
    // its own removal (e.g. two events racing to settle the same auth attempt).
    const everRegistered: Record<string, Function[]> = {};
    return {
        once(event: string, cb: Function) {
            handlers[event] = handlers[event] || [];
            handlers[event].push(cb);
            everRegistered[event] = everRegistered[event] || [];
            everRegistered[event].push(cb);
        },
        removeListener(event: string, cb: Function) {
            handlers[event] = (handlers[event] || []).filter((h) => h !== cb);
        },
        emit(event: string, ...args: any[]) {
            for (const cb of [...(handlers[event] || [])]) cb(...args);
        },
        emitRaw(event: string, ...args: any[]) {
            for (const cb of [...(everRegistered[event] || [])]) cb(...args);
        },
        close: vi.fn(),
        send: vi.fn(),
    };
}

describe("AuthMiddleware.authenticate (async)", () => {
    it("throws when the strategy name is not registered", async () => {
        const mw = new AuthMiddleware();
        await expect(mw.authenticate(["missing"], {} as any)).rejects.toThrow(
            "No authentication strategy has been registered with name: missing"
        );
    });

    it("throws when required and no strategy authenticates successfully", async () => {
        const mw = new AuthMiddleware();
        mw.register("test", makeStrategy());
        await expect(mw.authenticate(["test"], {} as any, undefined, true)).rejects.toThrow(
            "Authentication failed but is required to proceed."
        );
    });

    it("returns undefined when not required and no strategy authenticates", async () => {
        const mw = new AuthMiddleware();
        mw.register("test", makeStrategy());
        await expect(mw.authenticate(["test"], {} as any)).resolves.toBeUndefined();
    });

    it("returns the result from the first successful strategy", async () => {
        const mw = new AuthMiddleware();
        const result: AuthResult = { method: "test", user: { uid: "u1" } as any };
        mw.register("test", makeStrategy({ authenticate: vi.fn().mockResolvedValue(result) }));
        await expect(mw.authenticate(["test"], {} as any)).resolves.toBe(result);
    });
});

describe("AuthMiddleware.authenticateSync", () => {
    it("throws when the strategy name is not registered", () => {
        const mw = new AuthMiddleware();
        expect(() => mw.authenticateSync(["missing"], {} as any)).toThrow(
            "No authentication strategy has been registered with name: missing"
        );
    });

    it("throws when required and no strategy authenticates successfully", () => {
        const mw = new AuthMiddleware();
        mw.register("test", makeStrategy());
        expect(() => mw.authenticateSync(["test"], {} as any, undefined, true)).toThrow(
            "Authentication failed but is required to proceed."
        );
    });

    it("returns the result from the first successful strategy", () => {
        const mw = new AuthMiddleware();
        const result: AuthResult = { method: "test", user: { uid: "u1" } as any };
        mw.register("test", makeStrategy({ authenticateSync: vi.fn().mockReturnValue(result) }));
        expect(mw.authenticateSync(["test"], {} as any)).toBe(result);
    });
});

describe("AuthMiddleware.authWebSocket", () => {
    function makeReq(overrides: any = {}) {
        return { headers: {}, socket: {}, websocket: undefined, ...overrides };
    }

    it("calls next() immediately when req.user is already set (pre-authenticated)", () => {
        const mw = new AuthMiddleware();
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const req = makeReq({ websocket: makeSocket(), user: { uid: "u1" } });
        handler(req, {} as any, next);
        expect(next).toHaveBeenCalledWith();
    });

    it("closes the socket with an error for a binary message when required", () => {
        const mw = new AuthMiddleware();
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", Buffer.from([1, 2, 3]), true);

        expect(sock.close).toHaveBeenCalledWith(1002, expect.any(String));
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls next() for a binary message when not required", () => {
        const mw = new AuthMiddleware();
        const handler = mw.authWebSocket(false);
        const next = vi.fn();
        const sock = makeSocket();
        const req = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", Buffer.from([1, 2, 3]), true);

        expect(sock.close).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith();
    });

    it("completes the LOGIN handshake successfully", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        const token = JWTUtils.createTokenSync(config.get("auth"), { uid: "u1" });
        sock.emit("message", JSON.stringify({ id: 0, type: "LOGIN", data: token }), false);

        expect(sock.send).toHaveBeenCalledWith(
            JSON.stringify({ id: 0, type: "LOGIN_RESPONSE", success: true })
        );
        expect(req.user.uid).toBe("u1");
        expect(next).toHaveBeenCalledWith();
    });

    it("rejects an invalid LOGIN token when required", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "LOGIN", data: "not-a-real-token" }), false);

        expect(sock.close).toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("rejects a LOGIN token that decodes but has no uid, when auth is required", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "LOGIN", data: makeNoUidToken() }), false);

        expect(sock.close).toHaveBeenCalled();
        expect(sock.send).toHaveBeenCalledWith(
            expect.stringContaining('"type":"LOGIN_RESPONSE"')
        );
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("responds without closing when a LOGIN token decodes but has no uid, and auth is not required", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(false);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "LOGIN", data: makeNoUidToken() }), false);

        expect(sock.close).not.toHaveBeenCalled();
        expect(sock.send).toHaveBeenCalledWith(
            JSON.stringify({
                id: 0,
                type: "LOGIN_RESPONSE",
                success: false,
                data: "Invalid authentication token.",
            })
        );
        expect(next).toHaveBeenCalledWith();
    });

    it("closes the socket for a non-LOGIN message when required", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "PING" }), false);

        expect(sock.close).toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls next() for a non-LOGIN message when not required", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(false);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "PING" }), false);

        expect(sock.close).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith();
    });

    it("closes the socket when the incoming message is not valid JSON and auth is required", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", "not-json", false);

        expect(sock.close).toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls next() when the incoming message is not valid JSON and auth is not required", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(false);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", "not-json", false);

        expect(sock.close).not.toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith();
    });

    it("resolves via next() when the socket closes before authentication completes", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("close");

        expect(next).toHaveBeenCalledWith();
    });

    it("ignores a second settle trigger after the first one (e.g. close after message)", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(false);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "PING" }), false);
        // `settle()` already removed the "close" listener via `removeListener`, but calling the
        // captured reference directly simulates a close event that was already in flight — it must
        // still be a no-op (the `if (settled) return;` guard) rather than firing next() again.
        sock.emitRaw("close");

        expect(next).toHaveBeenCalledTimes(1);
    });

    it("falls back to req.socket when req.websocket is not set", () => {
        const mw = new AuthMiddleware();
        (mw as any).authConfig = config.get("auth");
        const handler = mw.authWebSocket(false);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = { headers: {}, socket: sock };
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "PING" }), false);

        expect(next).toHaveBeenCalledWith();
    });

    it("times out and calls next() with an error when required and no message arrives", async () => {
        vi.useFakeTimers();
        try {
            const mw = new AuthMiddleware();
            (mw as any).authConfig = config.get("auth");
            (mw as any).authSocketTimeout = 10;
            const handler = mw.authWebSocket(true);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock });
            handler(req, {} as any, next);

            vi.advanceTimersByTime(10);

            expect(sock.close).toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith(expect.any(Error));
        } finally {
            vi.useRealTimers();
        }
    });

    it("times out and calls next() with no error when not required", async () => {
        vi.useFakeTimers();
        try {
            const mw = new AuthMiddleware();
            (mw as any).authConfig = config.get("auth");
            (mw as any).authSocketTimeout = 10;
            const handler = mw.authWebSocket(false);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock });
            handler(req, {} as any, next);

            vi.advanceTimersByTime(10);

            expect(sock.close).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith();
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("AuthMiddleware.register", () => {
    it("adds the strategy under the given name", () => {
        const mw = new AuthMiddleware();
        const strategy = makeStrategy();
        mw.register("test", strategy);
        expect(mw.strategies.get("test")).toBe(strategy);
    });
});
