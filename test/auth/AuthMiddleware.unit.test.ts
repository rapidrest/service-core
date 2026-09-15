///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import jwt from "jsonwebtoken";
import { AuthMiddleware } from "../../src/auth/AuthMiddleware";
import { JWTStrategy } from "../../src/auth/JWTStrategy";
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

/** Creates an AuthMiddleware with a real JWTStrategy registered under `jwt`, like `Server` does from config. */
function makeJwtMiddleware(): AuthMiddleware {
    const mw = new AuthMiddleware();
    (mw as any).authConfig = config.get("auth");
    const jwtStrategy: any = new JWTStrategy();
    jwtStrategy.config = config.get("auth");
    mw.register("jwt", jwtStrategy);
    return mw;
}

/** Lets pending promise callbacks (async strategy verification) run. */
async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await new Promise((resolve) => setImmediate(resolve));
    }
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
            "No authentication strategy has been registered with name: missing",
        );
    });

    it("throws when required and no strategy authenticates successfully", async () => {
        const mw = new AuthMiddleware();
        mw.register("test", makeStrategy());
        await expect(mw.authenticate(["test"], {} as any, undefined, true)).rejects.toThrow("Authentication failed.");
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

    it("falls through to the next strategy when an earlier one has no credential, even when required=true", async () => {
        // Mirrors the real AuthStrategy contract (see JWTStrategy): a strategy throws on failure only
        // when it itself receives required=true. If AuthMiddleware ever regresses to passing the
        // aggregate `required` straight through to each strategy, "first" would throw here and this
        // test would fail because "second" is never reached.
        const mw = new AuthMiddleware();
        const result: AuthResult = { method: "second", user: { uid: "u2" } as any };
        mw.register(
            "first",
            makeStrategy({
                authenticate: vi.fn(async (_req, _res, required) => {
                    if (required) throw new Error("first strategy: no credential");
                    return undefined;
                }),
            }),
        );
        mw.register("second", makeStrategy({ authenticate: vi.fn().mockResolvedValue(result) }));
        await expect(mw.authenticate(["first", "second"], {} as any, undefined, true)).resolves.toBe(result);
    });

    it("still throws when required=true and every strategy fails", async () => {
        const mw = new AuthMiddleware();
        mw.register("first", makeStrategy());
        mw.register("second", makeStrategy());
        await expect(mw.authenticate(["first", "second"], {} as any, undefined, true)).rejects.toThrow(
            "Authentication failed.",
        );
    });

    it("tries the next strategy when an earlier one throws, e.g. jwt rejecting an OAuth bearer token", async () => {
        const mw = makeJwtMiddleware();
        const result: AuthResult = { method: "oauth_bearer", user: { uid: "u2" } as any };
        mw.register("oauth_bearer", makeStrategy({ authenticate: vi.fn().mockResolvedValue(result) }));
        const req: any = { headers: { authorization: "Bearer opaque-oauth-access-token" }, query: {}, cookies: {} };
        await expect(mw.authenticate(["jwt", "oauth_bearer"], req, undefined, true)).resolves.toBe(result);
    });

    it("rethrows the first strategy error when every strategy fails, even when not required", async () => {
        const mw = new AuthMiddleware();
        const first = new Error("first");
        mw.register("first", makeStrategy({ authenticate: vi.fn().mockRejectedValue(first) }));
        mw.register("second", makeStrategy({ authenticate: vi.fn().mockRejectedValue(new Error("second")) }));
        mw.register("third", makeStrategy());
        await expect(mw.authenticate(["first", "second", "third"], {} as any)).rejects.toBe(first);
        await expect(mw.authenticate(["first", "third"], {} as any, undefined, true)).rejects.toBe(first);
    });

    it("still rejects a genuinely invalid bearer token when every strategy fails", async () => {
        const mw = makeJwtMiddleware();
        mw.register("oauth_bearer", makeStrategy());
        const req: any = { headers: { authorization: "Bearer not-a-valid-token" }, query: {}, cookies: {} };
        await expect(mw.authenticate(["jwt", "oauth_bearer"], req, undefined, true)).rejects.toThrow();
    });
});

describe("AuthMiddleware.authenticateSync", () => {
    it("throws when the strategy name is not registered", () => {
        const mw = new AuthMiddleware();
        expect(() => mw.authenticateSync(["missing"], {} as any)).toThrow(
            "No authentication strategy has been registered with name: missing",
        );
    });

    it("throws when required and no strategy authenticates successfully", () => {
        const mw = new AuthMiddleware();
        mw.register("test", makeStrategy());
        expect(() => mw.authenticateSync(["test"], {} as any, undefined, true)).toThrow("Authentication failed.");
    });

    it("returns the result from the first successful strategy", () => {
        const mw = new AuthMiddleware();
        const result: AuthResult = { method: "test", user: { uid: "u1" } as any };
        mw.register("test", makeStrategy({ authenticateSync: vi.fn().mockReturnValue(result) }));
        expect(mw.authenticateSync(["test"], {} as any)).toBe(result);
    });

    it("still throws when required=true and every strategy fails", () => {
        const mw = new AuthMiddleware();
        mw.register("first", makeStrategy());
        mw.register("second", makeStrategy());
        expect(() => mw.authenticateSync(["first", "second"], {} as any, undefined, true)).toThrow(
            "Authentication failed.",
        );
    });

    it("tries the next strategy when an earlier one throws", () => {
        const mw = new AuthMiddleware();
        const result: AuthResult = { method: "second", user: { uid: "u2" } as any };
        mw.register(
            "first",
            makeStrategy({
                authenticateSync: vi.fn(() => {
                    throw new Error("first");
                }),
            }),
        );
        mw.register("second", makeStrategy({ authenticateSync: vi.fn().mockReturnValue(result) }));
        expect(mw.authenticateSync(["first", "second"], {} as any, undefined, true)).toBe(result);
    });

    it("rethrows the first strategy error when every strategy fails", () => {
        const mw = new AuthMiddleware();
        mw.register(
            "first",
            makeStrategy({
                authenticateSync: vi.fn(() => {
                    throw new Error("first");
                }),
            }),
        );
        mw.register("second", makeStrategy());
        expect(() => mw.authenticateSync(["first", "second"], {} as any)).toThrow("first");
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

    it("completes the LOGIN handshake successfully", async () => {
        const mw = makeJwtMiddleware();
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        const token = JWTUtils.createTokenSync(config.get("auth"), { uid: "u1" });
        sock.emit("message", JSON.stringify({ id: 0, type: "LOGIN", data: token }), false);
        await flush();

        expect(sock.send).toHaveBeenCalledWith(JSON.stringify({ id: 0, type: "LOGIN_RESPONSE", success: true }));
        expect(req.user.uid).toBe("u1");
        expect(next).toHaveBeenCalledWith();
    });

    it("rejects an invalid LOGIN token when required", async () => {
        const mw = makeJwtMiddleware();
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "LOGIN", data: "not-a-real-token" }), false);
        await flush();

        expect(sock.close).toHaveBeenCalled();
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("rejects a LOGIN token that decodes but has no uid, when auth is required", async () => {
        const mw = makeJwtMiddleware();
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "LOGIN", data: makeNoUidToken() }), false);
        await flush();

        expect(sock.close).toHaveBeenCalled();
        expect(sock.send).toHaveBeenCalledWith(expect.stringContaining('"type":"LOGIN_RESPONSE"'));
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("responds without closing when a LOGIN token decodes but has no uid, and auth is not required", async () => {
        const mw = makeJwtMiddleware();
        const handler = mw.authWebSocket(false);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("message", JSON.stringify({ id: 0, type: "LOGIN", data: makeNoUidToken() }), false);
        await flush();

        expect(sock.close).not.toHaveBeenCalled();
        expect(sock.send).toHaveBeenCalledWith(
            JSON.stringify({
                id: 0,
                type: "LOGIN_RESPONSE",
                success: false,
                data: "Invalid authentication token.",
            }),
        );
        expect(next).toHaveBeenCalledWith();
    });

    it("closes the socket for a non-LOGIN message when required", () => {
        const mw = makeJwtMiddleware();
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
        const mw = makeJwtMiddleware();
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
        const mw = makeJwtMiddleware();
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
        const mw = makeJwtMiddleware();
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
        const mw = makeJwtMiddleware();
        const handler = mw.authWebSocket(true);
        const next = vi.fn();
        const sock = makeSocket();
        const req: any = makeReq({ websocket: sock });
        handler(req, {} as any, next);

        sock.emit("close");

        expect(next).toHaveBeenCalledWith();
    });

    it("ignores a second settle trigger after the first one (e.g. close after message)", () => {
        const mw = makeJwtMiddleware();
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
        const mw = makeJwtMiddleware();
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
            const mw = makeJwtMiddleware();
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
            const mw = makeJwtMiddleware();
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

    describe("route strategies", () => {
        /** An async-only strategy like `@rapidrest/auth`'s OAuthBearerStrategy. */
        function makeBearerStrategy(validTokens: string[]): AuthStrategy {
            return {
                name: "oauth_bearer",
                authenticate: vi.fn(async (req: any) => {
                    const header: string | undefined = req.headers?.authorization;
                    const token = header?.startsWith("Bearer ") ? header.substring(7) : undefined;
                    return token && validTokens.includes(token)
                        ? { method: "oauth_bearer", data: token, user: { uid: "bearer-user" } as any }
                        : undefined;
                }),
                authenticateSync: vi.fn(() => {
                    throw new Error("Not supported. This auth strategy must be used asynchronously.");
                }),
            };
        }

        it("verifies a LOGIN token through the route's async-only strategy", async () => {
            const mw = makeJwtMiddleware();
            mw.register("oauth_bearer", makeBearerStrategy(["good-token"]));
            const handler = mw.authWebSocket(true, ["oauth_bearer"]);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock });
            handler(req, {} as any, next);
            await flush();

            sock.emit("message", JSON.stringify({ id: 1, type: "LOGIN", data: "good-token" }), false);
            await flush();

            expect(sock.send).toHaveBeenCalledWith(JSON.stringify({ id: 1, type: "LOGIN_RESPONSE", success: true }));
            expect(req.user.uid).toBe("bearer-user");
            expect(req.auth.method).toBe("oauth_bearer");
            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith();
        });

        it("does not accept a token that is only valid for the raw auth config on an oauth_bearer route", async () => {
            // The old LOGIN path decoded the token with the `auth` config directly, bypassing the route's
            // strategy (and so e.g. its revocation denylist) whenever auth was optional.
            const mw = makeJwtMiddleware();
            mw.register("oauth_bearer", makeBearerStrategy([]));
            const handler = mw.authWebSocket(false, ["oauth_bearer"]);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock });
            handler(req, {} as any, next);

            const token = JWTUtils.createTokenSync(config.get("auth"), { uid: "u1" });
            sock.emit("message", JSON.stringify({ id: 2, type: "LOGIN", data: token }), false);
            await flush();

            expect(req.user).toBeUndefined();
            expect(sock.close).not.toHaveBeenCalled();
            expect(sock.send).toHaveBeenCalledWith(expect.stringContaining('"success":false'));
            expect(next).toHaveBeenCalledWith();
        });

        it("authenticates the upgrade request's own header with an async-only strategy, without a LOGIN", async () => {
            const mw = new AuthMiddleware();
            mw.register("oauth_bearer", makeBearerStrategy(["header-token"]));
            const handler = mw.authWebSocket(true, ["oauth_bearer"]);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock, headers: { authorization: "Bearer header-token" } });
            handler(req, {} as any, next);
            await flush();

            expect(req.user.uid).toBe("bearer-user");
            expect(sock.close).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith();
        });

        it("closes the connection when the upgrade request's credential is invalid and auth is required", async () => {
            const mw = makeJwtMiddleware();
            const handler = mw.authWebSocket(true, ["jwt"]);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock, headers: { authorization: "Bearer not-a-real-token" } });
            handler(req, {} as any, next);
            await flush();

            expect(sock.close).toHaveBeenCalledWith(1002, expect.any(String));
            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });

        it("keeps waiting for a message when the upgrade request's credential is invalid and auth is optional", async () => {
            const mw = makeJwtMiddleware();
            const handler = mw.authWebSocket(false, ["jwt"]);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock, headers: { authorization: "Bearer not-a-real-token" } });
            handler(req, {} as any, next);
            await flush();
            expect(next).not.toHaveBeenCalled();

            sock.emit("message", JSON.stringify({ id: 0, type: "PING" }), false);
            expect(sock.close).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith();
        });

        it("verifies only the LOGIN token, not a query token from the upgrade request", async () => {
            const mw = makeJwtMiddleware();
            const handler = mw.authWebSocket(true, ["jwt"]);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock, cookies: {}, query: {} });
            handler(req, {} as any, next);
            await flush();

            // The test config sets `allowQueryParam`, and a query token takes precedence over the Authorization
            // header in JWTStrategy. It must not be used in place of the LOGIN message's token.
            req.query = { auth_token: JWTUtils.createTokenSync(config.get("auth"), { uid: "query-user" }) };
            sock.emit("message", JSON.stringify({ id: 3, type: "LOGIN", data: "not-a-real-token" }), false);
            await flush();

            expect(req.user).toBeUndefined();
            expect(sock.close).toHaveBeenCalled();
            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });

        it("proceeds anonymously without closing when a LOGIN token is malformed and auth is optional", async () => {
            const mw = makeJwtMiddleware();
            const handler = mw.authWebSocket(false, ["jwt"]);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock });
            handler(req, {} as any, next);

            sock.emit("message", JSON.stringify({ id: 6, type: "LOGIN", data: "not-a-real-token" }), false);
            await flush();

            expect(req.user).toBeUndefined();
            expect(sock.close).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith();
        });

        it("closes with INVALID_REQUEST when a LOGIN token is malformed and auth is required", async () => {
            const mw = makeJwtMiddleware();
            const handler = mw.authWebSocket(true, ["jwt"]);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock });
            handler(req, {} as any, next);

            sock.emit("message", JSON.stringify({ id: 7, type: "LOGIN", data: "not-a-real-token" }), false);
            await flush();

            expect(sock.close).toHaveBeenCalledWith(1002, "api-003");
            expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 400 }));
        });

        it("rejects a LOGIN message whose data is not a string when auth is required", async () => {
            const mw = makeJwtMiddleware();
            const handler = mw.authWebSocket(true);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock });
            handler(req, {} as any, next);

            sock.emit("message", JSON.stringify({ id: 4, type: "LOGIN", data: { uid: "forged" } }), false);
            await flush();

            expect(req.user).toBeUndefined();
            expect(sock.close).toHaveBeenCalled();
            expect(next).toHaveBeenCalledTimes(1);
            expect(next).toHaveBeenCalledWith(expect.any(Error));
        });

        it("ignores a LOGIN verification that finishes after the socket already closed", async () => {
            const mw = new AuthMiddleware();
            let resolveAuth: (value: any) => void = () => undefined;
            mw.register(
                "slow",
                makeStrategy({
                    authenticate: vi.fn((req: any) =>
                        req.headers?.authorization
                            ? new Promise<any>((resolve) => {
                                  resolveAuth = resolve;
                              })
                            : Promise.resolve(undefined),
                    ),
                }),
            );
            const handler = mw.authWebSocket(true, ["slow"]);
            const next = vi.fn();
            const sock = makeSocket();
            const req: any = makeReq({ websocket: sock });
            handler(req, {} as any, next);
            await flush();

            sock.emit("message", JSON.stringify({ id: 5, type: "LOGIN", data: "token" }), false);
            await flush();
            sock.emit("close");
            resolveAuth({ method: "slow", user: { uid: "late" } });
            await flush();

            expect(req.user).toBeUndefined();
            expect(sock.send).not.toHaveBeenCalled();
            expect(next).toHaveBeenCalledTimes(1);
        });
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
