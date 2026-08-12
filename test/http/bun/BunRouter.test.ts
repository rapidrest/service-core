///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { ApiErrorMessages, ApiErrors } from "../../../src/ApiErrors";
import { DEFAULT_MAX_BODY_SIZE } from "../../../src/http/uWS/Adapters";
import { BunRouter } from "../../../src/http/bun/BunRouter";
import { BunResponse } from "../../../src/http/bun/BunAdapters";
import type { RequestHandler } from "../../../src/http/types";

function makeServer(overrides: Partial<{ requestIP: any; upgrade: any }> = {}) {
    return {
        requestIP: vi.fn().mockReturnValue({ address: "127.0.0.1" }),
        upgrade: vi.fn().mockReturnValue(true),
        ...overrides,
    };
}

async function dispatch(router: BunRouter, req: Request, server: any = makeServer()): Promise<Response | undefined> {
    return (router as any).fetchHandler(req, server);
}

function jsonHandler(body: any): RequestHandler {
    return (_req, res) => res.json(body);
}

describe("BunRouter HTTP dispatch", () => {
    it("matches a static route", async () => {
        const router = new BunRouter();
        router.get("/hello", jsonHandler({ from: "static" }));
        const res = await dispatch(router, new Request("http://localhost/hello"));
        expect(res!.status).toBe(200);
        expect(await res!.json()).toEqual({ from: "static" });
    });

    it("extracts :param values without percent-decoding", async () => {
        const router = new BunRouter();
        let captured: string | undefined;
        router.get("/users/:id", (req, res) => {
            captured = req.params.id;
            res.json({});
        });
        await dispatch(router, new Request("http://localhost/users/a%20b"));
        expect(captured).toBe("a%20b");
    });

    it("prefers a static route over a :param route for the same request", async () => {
        const router = new BunRouter();
        router.get("/users/:id", jsonHandler({ which: "param" }));
        router.get("/users/me", jsonHandler({ which: "static" }));
        const res = await dispatch(router, new Request("http://localhost/users/me"));
        expect(await res!.json()).toEqual({ which: "static" });
    });

    it("a /prefix/* route matches /prefix/ and nested paths but not the bare /prefix", async () => {
        const router = new BunRouter();
        router.get("/static/*", jsonHandler({ from: "wildcard" }));

        const bare = await dispatch(router, new Request("http://localhost/static"));
        expect(bare!.status).toBe(404);

        const withSlash = await dispatch(router, new Request("http://localhost/static/"));
        expect(withSlash!.status).toBe(200);

        const nested = await dispatch(router, new Request("http://localhost/static/foo/bar"));
        expect(nested!.status).toBe(200);
    });

    it("a bare /* route matches the root path \"/\" itself, not just nested paths", async () => {
        const router = new BunRouter();
        router.get("/*", jsonHandler({ from: "root-wildcard" }));

        const root = await dispatch(router, new Request("http://localhost/"));
        expect(root!.status).toBe(200);
        expect(await root!.json()).toEqual({ from: "root-wildcard" });

        const nested = await dispatch(router, new Request("http://localhost/anything"));
        expect(nested!.status).toBe(200);
    });

    it("picks the longest-prefix wildcard among multiple matching wildcards", async () => {
        const router = new BunRouter();
        router.get("/*", jsonHandler({ which: "root" }));
        router.get("/static/*", jsonHandler({ which: "static" }));
        const res = await dispatch(router, new Request("http://localhost/static/foo"));
        expect(await res!.json()).toEqual({ which: "static" });
    });

    it("an exact-length route always outranks a matching wildcard", async () => {
        const router = new BunRouter();
        router.get("/a/*", jsonHandler({ which: "wildcard" }));
        router.get("/a/b", jsonHandler({ which: "exact" }));
        const res = await dispatch(router, new Request("http://localhost/a/b"));
        expect(await res!.json()).toEqual({ which: "exact" });
    });

    it("returns a raw 404 JSON response when nothing matches", async () => {
        const router = new BunRouter();
        const res = await dispatch(router, new Request("http://localhost/nope"));
        expect(res!.status).toBe(404);
        expect(await res!.json()).toEqual({
            code: ApiErrors.NOT_FOUND,
            status: 404,
            message: ApiErrorMessages.NOT_FOUND,
        });
    });

    it("normalizes a trailing slash so /users and /users/ both match a route registered as /users", async () => {
        const router = new BunRouter();
        router.get("/users", jsonHandler({}));
        expect((await dispatch(router, new Request("http://localhost/users"))).status).toBe(200);
        expect((await dispatch(router, new Request("http://localhost/users/"))).status).toBe(200);
    });

    it("matches the root path", async () => {
        const router = new BunRouter();
        router.get("/", jsonHandler({ root: true }));
        const res = await dispatch(router, new Request("http://localhost/"));
        expect(res!.status).toBe(200);
    });

    it("isolates routes by HTTP method", async () => {
        const router = new BunRouter();
        router.get("/x", jsonHandler({}));
        const res = await dispatch(router, new Request("http://localhost/x", { method: "POST" }));
        expect(res!.status).toBe(404);
    });

    it("a HEAD route strips the body but keeps headers/status", async () => {
        const router = new BunRouter();
        router.head("/x", (_req, res) => res.send({ a: 1 }));
        const res = await dispatch(router, new Request("http://localhost/x", { method: "HEAD" }));
        expect(res!.headers.get("content-type")).toBe("application/json");
        expect(await res!.text()).toBe("");
    });

    it("runs global middleware in pre/post-route order around the matched handler", async () => {
        // The route handler must call next() rather than ending the response itself — runChain stops
        // the chain as soon as a handler ends the response, so post-route middleware (mwB) only gets a
        // turn if something later in the chain is left to finalize the response.
        const router = new BunRouter();
        const order: string[] = [];
        router.use((_req, _res, next) => {
            order.push("mwA");
            next();
        });
        router.get("/x", (_req, _res, next) => {
            order.push("handler");
            next();
        });
        router.use((_req, res) => {
            order.push("mwB");
            res.json({});
        });
        await dispatch(router, new Request("http://localhost/x"));
        expect(order).toEqual(["mwA", "handler", "mwB"]);
    });

    it("freezes the pre-route middleware count at the first route registration, not per-route", async () => {
        // mwB is registered AFTER /x but BEFORE /y. Even though /y is registered after mwB exists,
        // /y still inherits the SAME preLength (1) captured at /x's registration — so mwB remains
        // "post-route" middleware for /y too, not pre-route.
        const router = new BunRouter();
        const order: string[] = [];
        router.use((_req, _res, next) => {
            order.push("mwA");
            next();
        });
        router.get("/x", (_req, _res, next) => next());
        router.use((_req, _res, next) => {
            order.push("mwB");
            next();
        });
        router.get("/y", (_req, _res, next) => {
            order.push("handlerY");
            next();
        });
        router.use((_req, res) => res.json({}));
        await dispatch(router, new Request("http://localhost/y"));
        expect(order).toEqual(["mwA", "handlerY", "mwB"]);
    });

    it("parses a JSON POST body and makes it available to the handler", async () => {
        const router = new BunRouter();
        let captured: any;
        router.post("/echo", (req, res) => {
            captured = req.body;
            res.status(201).json(req.body);
        });
        const res = await dispatch(
            router,
            new Request("http://localhost/echo", {
                method: "POST",
                body: JSON.stringify({ x: 1 }),
                headers: { "content-type": "application/json" },
            }),
        );
        expect(res!.status).toBe(201);
        expect(captured).toEqual({ x: 1 });
    });

    it("rejects an oversized POST body with 413 before the handler runs", async () => {
        const router = new BunRouter(10);
        const handler = vi.fn((_req, res) => res.json({}));
        router.post("/echo", handler as any);
        const res = await dispatch(
            router,
            new Request("http://localhost/echo", {
                method: "POST",
                body: "x".repeat(20),
                headers: { "content-length": "1000" },
            }),
        );
        expect(res!.status).toBe(413);
        expect(handler).not.toHaveBeenCalled();
    });

    it("a handler that throws after flushHeaders() does not crash dispatch or overwrite the started response", async () => {
        const router = new BunRouter();
        router.get("/stream", (_req, res) => {
            res.setHeader("x-a", "1");
            res.flushHeaders();
            throw new Error("mid-stream boom");
        });
        const res = await dispatch(router, new Request("http://localhost/stream"));
        expect(res!.status).toBe(200);
        expect(res!.headers.get("x-a")).toBe("1");
    });

    it("defaults to 204 when the handler chain completes without ending the response", async () => {
        const router = new BunRouter();
        router.get("/x", (_req, _res, next) => next());
        const res = await dispatch(router, new Request("http://localhost/x"));
        expect(res!.status).toBe(204);
    });

    it("extracts only the prefix params for a wildcard-suffixed route", async () => {
        const router = new BunRouter();
        let captured: Record<string, string> | undefined;
        router.get("/static/:bucket/*", (req, res) => {
            captured = req.params;
            res.json({});
        });
        await dispatch(router, new Request("http://localhost/static/images/a/b/c"));
        expect(captured).toEqual({ bucket: "images" });
    });

    it("registers and matches an OPTIONS route", async () => {
        const router = new BunRouter();
        router.options("/x", jsonHandler({ ok: true }));
        const res = await dispatch(router, new Request("http://localhost/x", { method: "OPTIONS" }));
        expect(res!.status).toBe(200);
        expect(await res!.json()).toEqual({ ok: true });
    });

    it("skips a non-wildcard candidate whose segment count differs from the request", async () => {
        // matchSegments' length guard (routeSegments.length !== reqSegments.length) must reject the
        // longer /a/b/c route as a candidate for a request to /a, leaving the shorter route to match.
        const router = new BunRouter();
        router.get("/a", jsonHandler({ which: "short" }));
        router.get("/a/b/c", jsonHandler({ which: "long" }));
        const res = await dispatch(router, new Request("http://localhost/a"));
        expect(await res!.json()).toEqual({ which: "short" });
    });

    it("skips a wildcard candidate whose static prefix does not match the request", async () => {
        // /other/* has content after its prefix (so it isn't skipped by hasContentAfterPrefix), but
        // its prefix segment doesn't statically match "static" — matchSegments returns null for it
        // and matchRoute must continue past it rather than picking it.
        const router = new BunRouter();
        router.get("/other/*", jsonHandler({ which: "other" }));
        router.get("/static/*", jsonHandler({ which: "static" }));
        const res = await dispatch(router, new Request("http://localhost/static/foo"));
        expect(await res!.json()).toEqual({ which: "static" });
    });

    it("keeps the earlier, more specific wildcard match when a lower-specificity wildcard is registered afterward", async () => {
        const router = new BunRouter();
        router.get("/static/*", jsonHandler({ which: "static" }));
        router.get("/*", jsonHandler({ which: "root" }));
        const res = await dispatch(router, new Request("http://localhost/static/foo"));
        expect(await res!.json()).toEqual({ which: "static" });
    });

    it("keeps the earlier, higher-scoring static match when a lower-scoring param route is registered afterward", async () => {
        const router = new BunRouter();
        router.get("/users/me", jsonHandler({ which: "static" }));
        router.get("/users/:id", jsonHandler({ which: "param" }));
        const res = await dispatch(router, new Request("http://localhost/users/me"));
        expect(await res!.json()).toEqual({ which: "static" });
    });

    it("calls res.abortStream() when the middleware chain's own promise rejects (not a per-handler catch)", async () => {
        // runChain() only rejects its returned promise when something throws OUTSIDE the
        // per-handler try/catch — specifically the end-of-chain `res.status(500).json({ message:
        // currentError?.message, ... })` fallback. A handler passing an error object whose `message`
        // getter throws triggers exactly that, exercising fetchHandler's own `.catch()` (not the
        // in-chain error handling already covered by the "throws after flushHeaders()" test above).
        const router = new BunRouter();
        const abortSpy = vi.spyOn(BunResponse.prototype, "abortStream");
        const evilError: any = {};
        Object.defineProperty(evilError, "message", {
            get() {
                throw new Error("getter boom");
            },
        });
        router.get("/x", (_req, _res, next) => next(evilError));

        // Deliberately not awaited: res.json() never actually gets called on this path (the throw
        // happens while building its argument), so responseReady never resolves. We only need to
        // observe that the rejection was funneled into abortStream() without crashing the process.
        void (router as any).fetchHandler(new Request("http://localhost/x"), makeServer());
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));

        expect(abortSpy).toHaveBeenCalledWith(expect.any(Error));
        abortSpy.mockRestore();
    });
});

describe("BunRouter WebSocket upgrade dispatch", () => {
    function upgradeRequest(path: string, headerValue: string = "websocket"): Request {
        return new Request(`http://localhost${path}`, { headers: { upgrade: headerValue } });
    }

    it("matches a ws route and upgrades, returning undefined", async () => {
        const router = new BunRouter();
        router.ws("/chat", [(_req, _res, next) => next()]);
        const server = makeServer();
        const result = await dispatch(router, upgradeRequest("/chat"), server);
        expect(result).toBeUndefined();
        expect(server.upgrade).toHaveBeenCalledTimes(1);
        const [rawReq, opts] = server.upgrade.mock.calls[0];
        expect(rawReq).toBeInstanceOf(Request);
        expect(opts.data.handlers).toHaveLength(1);
        expect(opts.data.req).toBeDefined();
    });

    it("returns 400 when server.upgrade() fails", async () => {
        const router = new BunRouter();
        router.ws("/chat", [(_req, _res, next) => next()]);
        const server = makeServer({ upgrade: vi.fn().mockReturnValue(false) });
        const res = await dispatch(router, upgradeRequest("/chat"), server);
        expect(res!.status).toBe(400);
    });

    it("falls through to normal HTTP handling (404) when no ws route matches the upgrade request", async () => {
        const router = new BunRouter();
        const res = await dispatch(router, upgradeRequest("/nope"));
        expect(res!.status).toBe(404);
    });

    it("rejects with 401 and never calls server.upgrade() when upgradeAuth rejects", async () => {
        const router = new BunRouter();
        router.ws("/chat", [(_req, _res, next) => next()], undefined, () => ({ reject: true }));
        const server = makeServer();
        const res = await dispatch(router, upgradeRequest("/chat"), server);
        expect(res!.status).toBe(401);
        expect(await res!.json()).toEqual({ status: 401, message: "Unauthorized" });
        expect(server.upgrade).not.toHaveBeenCalled();
    });

    it("attaches user/auth info from upgradeAuth before upgrading", async () => {
        const router = new BunRouter();
        router.ws("/chat", [(_req, _res, next) => next()], undefined, () => ({
            user: { uid: "u1" },
            authPayload: { p: 1 },
            authToken: "tok",
        }));
        const server = makeServer();
        await dispatch(router, upgradeRequest("/chat"), server);
        const opts = server.upgrade.mock.calls[0][1];
        expect(opts.data.req.user).toEqual({ uid: "u1" });
        expect(opts.data.req.auth).toEqual({ user: { uid: "u1" }, authPayload: { p: 1 }, authToken: "tok" });
        expect(opts.data.req.authPayload).toEqual({ p: 1 });
        expect(opts.data.req.authToken).toBe("tok");
    });

    it("falls through to the post-upgrade LOGIN flow when upgradeAuth returns {}", async () => {
        const router = new BunRouter();
        router.ws("/chat", [(_req, _res, next) => next()], undefined, () => ({}));
        const server = makeServer();
        await dispatch(router, upgradeRequest("/chat"), server);
        const opts = server.upgrade.mock.calls[0][1];
        expect(opts.data.req.user).toBeUndefined();
    });

    it("extracts :param values on ws routes", async () => {
        const router = new BunRouter();
        router.ws("/rooms/:roomId", [(_req, _res, next) => next()]);
        const server = makeServer();
        await dispatch(router, upgradeRequest("/rooms/42"), server);
        const opts = server.upgrade.mock.calls[0][1];
        expect(opts.data.req.params).toEqual({ roomId: "42" });
    });

    it("matches the upgrade header case-insensitively", async () => {
        const router = new BunRouter();
        router.ws("/chat", [(_req, _res, next) => next()]);
        const server = makeServer();
        const result = await dispatch(router, upgradeRequest("/chat", "WebSocket"), server);
        expect(result).toBeUndefined();
        expect(server.upgrade).toHaveBeenCalledTimes(1);
    });

    it("skips a ws candidate whose segment count differs from the request", async () => {
        // matchWsRoute's matchSegments call returns null for /chat/deep/path against a 1-segment
        // request; the loop must continue past it rather than accepting the null score.
        const router = new BunRouter();
        router.ws("/chat/deep/path", [(_req, _res, next) => next()]);
        router.ws("/chat", [(_req, _res, next) => next()]);
        const server = makeServer();
        const result = await dispatch(router, upgradeRequest("/chat"), server);
        expect(result).toBeUndefined();
        expect(server.upgrade).toHaveBeenCalledTimes(1);
    });

    it("keeps the earlier, higher-scoring ws match when a lower-scoring param route is registered afterward", async () => {
        // Registration order: static (higher score) first, :param (lower score) second. matchWsRoute
        // must not let the later, lower-scoring candidate override the already-found best match —
        // exercising the `score > bestScore` false branch.
        const router = new BunRouter();
        router.ws("/rooms/general", [(_req, _res, next) => next()]);
        router.ws("/rooms/:roomId", [(_req, _res, next) => next()]);
        const server = makeServer();
        await dispatch(router, upgradeRequest("/rooms/general"), server);
        const opts = server.upgrade.mock.calls[0][1];
        // An empty params object proves the static route matched, not the :roomId param route.
        expect(opts.data.req.params).toEqual({});
    });
});

describe("BunRouter websocketConfig lifecycle", () => {
    function makeFakeWs(overrides: Partial<{ data: any; send: any; close: any }> = {}) {
        return {
            data: { req: {}, handlers: [] },
            send: vi.fn().mockReturnValue(1),
            close: vi.fn(),
            ...overrides,
        };
    }

    describe("open", () => {
        it("closes the socket when the handler chain completes without wsHandled and the socket is still open", async () => {
            const router = new BunRouter();
            const ws = makeFakeWs({ data: { req: {}, handlers: [(_req: any, _res: any, next: any) => next()] } });
            await (router as any).websocketConfig.open(ws);
            expect(ws.data.shim).toBeDefined();
            expect(ws.data.req.websocket).toBe(ws.data.shim);
            expect(ws.close).toHaveBeenCalledTimes(1);
        });

        it("does not close the socket when the handler chain sets req.wsHandled", async () => {
            const router = new BunRouter();
            const ws = makeFakeWs({
                data: {
                    req: {},
                    handlers: [
                        (req: any, _res: any, next: any) => {
                            req.wsHandled = true;
                            next();
                        },
                    ],
                },
            });
            await (router as any).websocketConfig.open(ws);
            expect(ws.close).not.toHaveBeenCalled();
        });

        it("does not close the socket when the client already disconnected (readyState === 3) while the handler awaited", async () => {
            const router = new BunRouter();
            const ws = makeFakeWs({
                data: {
                    req: {},
                    handlers: [
                        (req: any, _res: any, next: any) => {
                            req.websocket.readyState = 3;
                            next();
                        },
                    ],
                },
            });
            await (router as any).websocketConfig.open(ws);
            expect(ws.close).not.toHaveBeenCalled();
        });

        it("does not throw when ws.close() itself throws", async () => {
            const router = new BunRouter();
            const ws = makeFakeWs({
                data: { req: {}, handlers: [(_req: any, _res: any, next: any) => next()] },
                close: vi.fn(() => {
                    throw new Error("already gone");
                }),
            });
            await expect((router as any).websocketConfig.open(ws)).resolves.toBeUndefined();
        });

        it("closes with 1002 and the error's code when a middleware rejects with no downstream handler to catch it", async () => {
            const router = new BunRouter();
            const err = { code: "api-102", status: 403, message: "User does not have permission to perform this action." };
            const ws = makeFakeWs({
                data: {
                    req: {},
                    handlers: [(_req: any, _res: any, next: any) => next(err)],
                },
            });
            await (router as any).websocketConfig.open(ws);
            // The bare fallback close() must not also fire once the error path has already closed the socket.
            expect(ws.close).toHaveBeenCalledTimes(1);
            expect(ws.close).toHaveBeenCalledWith(1002, "api-102");
        });

        it("falls back to the error's message, then a generic message, when it has no code", async () => {
            const router = new BunRouter();

            const wsWithMessage = makeFakeWs({
                data: { req: {}, handlers: [(_req: any, _res: any, next: any) => next({ message: "boom" })] },
            });
            await (router as any).websocketConfig.open(wsWithMessage);
            expect(wsWithMessage.close).toHaveBeenCalledWith(1002, "boom");

            const wsWithNeither = makeFakeWs({
                data: { req: {}, handlers: [(_req: any, _res: any, next: any) => next({})] },
            });
            await (router as any).websocketConfig.open(wsWithNeither);
            expect(wsWithNeither.close).toHaveBeenCalledWith(1002, "Internal Server Error");
        });
    });

    describe("message", () => {
        it("emits a string message with isBinary=false", () => {
            const router = new BunRouter();
            const ws = makeFakeWs();
            const shim = { emit: vi.fn() };
            ws.data.shim = shim;
            (router as any).websocketConfig.message(ws, "hello");
            expect(shim.emit).toHaveBeenCalledWith("message", "hello", false);
        });

        it("wraps Buffer/ArrayBuffer messages and emits isBinary=true", () => {
            const router = new BunRouter();
            const ws = makeFakeWs();
            const shim = { emit: vi.fn() };
            ws.data.shim = shim;
            const buf = Buffer.from("abc");
            (router as any).websocketConfig.message(ws, buf);
            expect(shim.emit).toHaveBeenCalledWith("message", Buffer.from(buf), true);
        });

        it("does not throw when data.shim is unset", () => {
            const router = new BunRouter();
            const ws = makeFakeWs({ data: {} });
            expect(() => (router as any).websocketConfig.message(ws, "hello")).not.toThrow();
        });
    });

    describe("close", () => {
        it("sets readyState to CLOSED and emits close with (code, reason)", () => {
            const router = new BunRouter();
            const ws = makeFakeWs();
            const shim = { emit: vi.fn(), readyState: 1 };
            ws.data.shim = shim;
            (router as any).websocketConfig.close(ws, 1000, "bye");
            expect(shim.readyState).toBe(3);
            expect(shim.emit).toHaveBeenCalledWith("close", 1000, "bye");
        });

        it("does not throw when data.shim is unset", () => {
            const router = new BunRouter();
            const ws = makeFakeWs({ data: {} });
            expect(() => (router as any).websocketConfig.close(ws, 1000, "bye")).not.toThrow();
        });
    });
});

describe("BunRouter.listen / close / SSL mapping (globalThis.Bun stubbed)", () => {
    let originalBun: any;

    beforeEach(() => {
        originalBun = (globalThis as any).Bun;
    });

    afterEach(() => {
        (globalThis as any).Bun = originalBun;
    });

    function stubBun(serveImpl?: any) {
        const serveSpy = serveImpl ?? vi.fn().mockReturnValue({ port: 12345, stop: vi.fn() });
        const fileSpy = vi.fn((p: string) => ({ __bunFile: p }));
        (globalThis as any).Bun = { serve: serveSpy, file: fileSpy };
        return { serveSpy, fileSpy };
    }

    it("calls Bun.serve() with the expected shape and reports back the listening port from the server", async () => {
        const { serveSpy } = stubBun();
        const router = new BunRouter();
        await router.listen("127.0.0.1", 0);

        expect(serveSpy).toHaveBeenCalledTimes(1);
        const callArg = serveSpy.mock.calls[0][0];
        expect(callArg.hostname).toBe("127.0.0.1");
        expect(callArg.port).toBe(0);
        expect(typeof callArg.fetch).toBe("function");
        expect(typeof callArg.websocket).toBe("object");
        expect(callArg.tls).toBeUndefined();

        // listenPort comes from the mocked server's own .port, not the input port — this matters
        // because real Bun reports back an OS-assigned port when port: 0 is requested.
        expect(router.listenPort).toBe(12345);
        expect(router.isListening).toBe(true);
    });

    it("registers a catch-all fallback so an unmatched path (after listen()) reaches the app-level NOT_FOUND error path", async () => {
        stubBun();
        const router = new BunRouter();
        await router.listen("127.0.0.1", 0);

        // With no error-handling middleware registered, runChain's own unhandled-error fallback
        // reports the NOT_FOUND ApiError's own status/code — this is shared runChain behavior
        // (also used by the uWS router), not something specific to the Bun adapter.
        const res = await dispatch(router, new Request("http://localhost/nope"));
        expect(res!.status).toBe(404);
        const body = await res!.json();
        expect(body.message).toBe(ApiErrorMessages.NOT_FOUND);
    });

    it("suppresses the injected fallback for a verb that already has an app-defined root wildcard route", async () => {
        stubBun();
        const router = new BunRouter();
        router.get("/*", jsonHandler({ custom: true }));
        await router.listen("127.0.0.1", 0);

        const getRes = await dispatch(router, new Request("http://localhost/anything"));
        expect(await getRes!.json()).toEqual({ custom: true });

        // POST has no app-defined root wildcard, so it still gets the injected fallback.
        const postRes = await dispatch(router, new Request("http://localhost/anything", { method: "POST" }));
        expect(postRes!.status).toBe(404);
    });

    it("maps the ssl config to Bun's tls option via Bun.file()", async () => {
        const { serveSpy, fileSpy } = stubBun();
        const router = new BunRouter(DEFAULT_MAX_BODY_SIZE, {
            key: "k.pem",
            cert: "c.pem",
            ca: "ca.pem",
            passphrase: "pw",
        });
        await router.listen("127.0.0.1", 0);

        expect(fileSpy).toHaveBeenCalledWith("k.pem");
        expect(fileSpy).toHaveBeenCalledWith("c.pem");
        expect(fileSpy).toHaveBeenCalledWith("ca.pem");
        const tls = serveSpy.mock.calls[0][0].tls;
        expect(tls).toEqual({
            key: { __bunFile: "k.pem" },
            cert: { __bunFile: "c.pem" },
            ca: { __bunFile: "ca.pem" },
            passphrase: "pw",
        });
    });

    it("leaves ca/passphrase undefined when they are not provided", async () => {
        const { serveSpy } = stubBun();
        const router = new BunRouter(DEFAULT_MAX_BODY_SIZE, { key: "k.pem", cert: "c.pem" });
        await router.listen("127.0.0.1", 0);

        const tls = serveSpy.mock.calls[0][0].tls;
        expect(tls.ca).toBeUndefined();
        expect(tls.passphrase).toBeUndefined();
    });

    it("rejects when Bun.serve() throws a real Error", async () => {
        stubBun(
            vi.fn(() => {
                throw new Error("boom");
            }),
        );
        const router = new BunRouter();
        await expect(router.listen("h", 1)).rejects.toThrow("boom");
    });

    it("rejects with a generic message when Bun.serve() throws a non-Error value", async () => {
        stubBun(
            vi.fn(() => {
                // eslint-disable-next-line no-throw-literal -- deliberately testing a non-Error throw
                throw "stringy failure";
            }),
        );
        const router = new BunRouter();
        await expect(router.listen("h", 1)).rejects.toThrow("Failed to listen on h:1");
    });

    it("close() stops the server once and is idempotent", async () => {
        const stopSpy = vi.fn();
        stubBun(vi.fn().mockReturnValue({ port: 1, stop: stopSpy }));
        const router = new BunRouter();
        await router.listen("127.0.0.1", 0);

        router.close();
        expect(stopSpy).toHaveBeenCalledTimes(1);
        expect(router.isListening).toBe(false);

        router.close();
        expect(stopSpy).toHaveBeenCalledTimes(1);
    });

    it("falls back to the requested port when the mocked server does not report its own port", async () => {
        stubBun(vi.fn().mockReturnValue({ stop: vi.fn() })); // no .port property on the fake server
        const router = new BunRouter();
        await router.listen("127.0.0.1", 4321);
        expect(router.listenPort).toBe(4321);
    });

    it("close() is a no-op when the router was never listening", () => {
        const router = new BunRouter();
        expect(() => router.close()).not.toThrow();
        expect(router.isListening).toBe(false);
    });
});
