///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// General HttpRouter coverage, complementing Router.upgradeAuth.test.ts (which only covers
// ws()'s pre-upgrade auth branch). Uses the same fake-uwsApp/uwsReq/uwsRes approach: the
// closures built by get()/post()/options()/ws()/listen() are captured off a fake `uwsApp`
// stub and invoked directly with fake uWS request/response objects, without a real server.
import { HttpRouter } from "../../../src/http/uWS/Router";
import { DEFAULT_WS_OPTIONS } from "../../../src/http/types";

function makeUwsReq(
    overrides: Partial<{ method: string; url: string; headers: Record<string, string>; params: string[] }> = {},
) {
    const headers = overrides.headers ?? {};
    const params = overrides.params ?? [];
    return {
        getMethod: () => overrides.method ?? "get",
        getUrl: () => overrides.url ?? "/foo",
        getQuery: () => "",
        getHeader: (name: string) => headers[name] ?? "",
        getParameter: (i: number) => params[i] ?? "",
        forEach: (cb: (key: string, value: string) => void) => {
            for (const [k, v] of Object.entries(headers)) cb(k, v);
        },
    };
}

function makeUwsRes(remoteAddress: string = "127.0.0.1") {
    const calls: any = { statuses: [], headers: [], ended: [], endedWithoutBody: [] };
    let onAbortedCb: (() => void) | undefined;
    return {
        getRemoteAddressAsText: () => Buffer.from(remoteAddress),
        cork: (fn: () => void) => fn(),
        writeStatus: (s: string) => calls.statuses.push(s),
        writeHeader: (k: string, v: string) => calls.headers.push([k, v]),
        end: (data?: any) => calls.ended.push(data),
        endWithoutBody: (n?: number) => calls.endedWithoutBody.push(n),
        write: (_data: any) => {
            /* not used by these tests */
        },
        onAborted: (cb: () => void) => {
            onAbortedCb = cb;
        },
        onData: (cb: (chunk: ArrayBuffer, isLast: boolean) => void) => {
            // These tests only exercise GET/OPTIONS-style requests with no body.
            cb(new ArrayBuffer(0), true);
        },
        _calls: calls,
        _triggerAbort: () => onAbortedCb?.(),
    };
}

function makeFakeUwsApp() {
    const routes: Record<string, { path: string; handler: any }[]> = {
        get: [],
        post: [],
        put: [],
        delete: [],
        patch: [],
        head: [],
        options: [],
    };
    const wsBehaviors: any[] = [];
    let listenCb: ((socket: any) => void) | undefined;
    const makeRegistrar = (verb: string) => (path: string, handler: any) => routes[verb].push({ path, handler });
    return {
        get: makeRegistrar("get"),
        post: makeRegistrar("post"),
        put: makeRegistrar("put"),
        del: makeRegistrar("delete"),
        patch: makeRegistrar("patch"),
        head: makeRegistrar("head"),
        options: makeRegistrar("options"),
        ws: (_path: string, behavior: any) => wsBehaviors.push(behavior),
        listen: (_host: string, _port: number, cb: (socket: any) => void) => {
            listenCb = cb;
        },
        close: vi.fn(),
        _routes: routes,
        _wsBehaviors: wsBehaviors,
        _fireListen: (socket: any) => listenCb?.(socket),
    };
}

describe("HttpRouter", () => {
    it("registers an OPTIONS route whose handler defaults to 204 when nothing else responds", async () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        router.options("/foo", (_req, _res, next) => next());

        expect(fakeApp._routes.options).toHaveLength(1);
        const handler = fakeApp._routes.options[0].handler;
        const uwsRes = makeUwsRes();
        await handler(uwsRes, makeUwsReq({ method: "options" }));

        expect(uwsRes._calls.statuses).toEqual(["204 No Content"]);
    });

    describe("hasExplicitOptionsRoute", () => {
        it("returns true for a literal path registered via options(), false otherwise.", () => {
            const router = new HttpRouter(makeFakeUwsApp() as any);
            router.options("/capabilities", (_req, _res, next) => next());

            expect(router.hasExplicitOptionsRoute("/capabilities")).toBe(true);
            expect(router.hasExplicitOptionsRoute("/other")).toBe(false);
        });

        it("does not treat the framework's own '/*' fallback registration as explicit.", () => {
            const router = new HttpRouter(makeFakeUwsApp() as any);
            router.options("/*", (_req, _res, next) => next());

            expect(router.hasExplicitOptionsRoute("/*")).toBe(false);
            expect(router.hasExplicitOptionsRoute("/anything")).toBe(false);
        });

        it("matches regardless of a trailing slash on either side.", () => {
            const router = new HttpRouter(makeFakeUwsApp() as any);
            router.options("/capabilities/", (_req, _res, next) => next());

            expect(router.hasExplicitOptionsRoute("/capabilities")).toBe(true);
            expect(router.hasExplicitOptionsRoute("/capabilities/")).toBe(true);
        });
    });

    it("registers PUT, DELETE and PATCH routes with their route pattern", async () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        const seen: string[] = [];
        const handler = (req: any, res: any) => {
            seen.push(req.routePattern);
            res.status(200).send({});
        };
        router.put("/p/:id", handler);
        router.delete("/d/:id", handler);
        router.patch("/x/:id", handler);

        await fakeApp._routes.put[0].handler(makeUwsRes(), makeUwsReq({ method: "put", params: ["1"] }));
        await fakeApp._routes.delete[0].handler(makeUwsRes(), makeUwsReq({ method: "delete", params: ["1"] }));
        await fakeApp._routes.patch[0].handler(makeUwsRes(), makeUwsReq({ method: "patch", params: ["1"] }));
        expect(seen).toEqual(["/p/:id", "/d/:id", "/x/:id"]);
    });

    it("defaults an unhandled GET request to 204 when no handler ends the response", async () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        router.get("/foo", (_req, _res, next) => next());

        const handler = fakeApp._routes.get[0].handler;
        const uwsRes = makeUwsRes();
        await handler(uwsRes, makeUwsReq());

        expect(uwsRes._calls.statuses).toEqual(["204 No Content"]);
    });

    it("does not send a default 204 once a handler has already ended the response", async () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        router.get("/foo", (_req, res: any) => res.status(200).send({ ok: true }));

        const handler = fakeApp._routes.get[0].handler;
        const uwsRes = makeUwsRes();
        await handler(uwsRes, makeUwsReq());

        expect(uwsRes._calls.statuses).toEqual(["200 OK"]);
    });

    describe(":param decoding", () => {
        it("percent-decodes a path param — uWS's own getParameter() never does this itself, unlike query-string parsing", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            let captured: string | undefined;
            router.get("/mailboxes/:id", (req: any, res: any) => {
                captured = req.params.id;
                res.status(200).send({});
            });

            const handler = fakeApp._routes.get[0].handler;
            // A real caller building this URL via `encodeURIComponent("jdoe@example.com")` produces
            // exactly this percent-encoded segment on the wire.
            await handler(makeUwsRes(), makeUwsReq({ params: ["jdoe%40example.com"] }));

            expect(captured).toBe("jdoe@example.com");
        });

        it("falls back to the raw segment on malformed percent-encoding rather than throwing", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            let captured: string | undefined;
            router.get("/mailboxes/:id", (req: any, res: any) => {
                captured = req.params.id;
                res.status(200).send({});
            });

            const handler = fakeApp._routes.get[0].handler;
            await handler(makeUwsRes(), makeUwsReq({ params: ["bad%"] }));

            expect(captured).toBe("bad%");
        });
    });

    it("listen() resolves and stores the listen socket/port on a successful bind", async () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        const promise = router.listen("0.0.0.0", 4321);
        const fakeSocket = {};
        fakeApp._fireListen(fakeSocket);

        await expect(promise).resolves.toBeUndefined();
        expect(router.isListening).toBe(true);
        expect(router.listenPort).toBe(4321);
    });

    it("listen() rejects when uWS fails to bind (falsy socket)", async () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        const promise = router.listen("0.0.0.0", 4321);
        fakeApp._fireListen(null);

        await expect(promise).rejects.toThrow("Failed to listen on 0.0.0.0:4321");
        expect(router.isListening).toBe(false);
    });

    describe("ws() open handler", () => {
        it("swallows an error from ws.end() when the client disconnected while a handler was awaiting", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            // The handler never marks the connection as handled, so `open` will attempt to close it.
            router.ws("/chat", [(_req, _res, next) => next()]);
            const behavior = fakeApp._wsBehaviors[0];

            const fakeWs: any = {
                getUserData: () => userData,
                // Bare (no-error) fallback close uses `end()` — a proper WebSocket close handshake —
                // rather than uWS's abrupt `close()`. See Router.ts's open handler for why.
                end: () => {
                    throw new Error("Invalid access of closed uWS.WebSocket");
                },
            };
            const userData: any = { req: { headers: {} } };

            await expect(behavior.open(fakeWs)).resolves.toBeUndefined();
        });

        it("closes with 1002 and the error's code when a middleware rejects with no downstream handler to catch it", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            const err = {
                code: "api-102",
                status: 403,
                message: "User does not have permission to perform this action.",
            };
            router.ws("/chat", [(_req: any, _res: any, next: any) => next(err)]);
            const behavior = fakeApp._wsBehaviors[0];

            const fakeWs: any = {
                getUserData: () => userData,
                end: vi.fn(),
            };
            const userData: any = { req: { headers: {} } };

            await behavior.open(fakeWs);

            // The bare fallback close() must not also fire once the error path has already closed the socket.
            expect(fakeWs.end).toHaveBeenCalledTimes(1);
            expect(fakeWs.end).toHaveBeenCalledWith(1002, "api-102");
        });

        it("falls back to the error's message, then a generic message, when it has no code", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            router.ws("/chat-message-only", [(_req: any, _res: any, next: any) => next({ message: "boom" })]);
            router.ws("/chat-neither", [(_req: any, _res: any, next: any) => next({})]);

            // Each ws() registration pushes twice (bare path + trailing-slash variant), so the
            // second route's behavior lands at index 2, not 1.
            const withMessage = fakeApp._wsBehaviors[0];
            const withNeither = fakeApp._wsBehaviors[2];

            const wsA: any = { getUserData: () => ({ req: { headers: {} } }), end: vi.fn() };
            await withMessage.open(wsA);
            expect(wsA.end).toHaveBeenCalledWith(1002, "boom");

            const wsB: any = { getUserData: () => ({ req: { headers: {} } }), end: vi.fn() };
            await withNeither.open(wsB);
            expect(wsB.end).toHaveBeenCalledWith(1002, "Internal Server Error");
        });
    });
    describe("route pattern", () => {
        it("exposes the registered route pattern, not the raw path, as req.routePattern", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            let seen: any;
            router.get("/items/:id", (req: any, res: any) => {
                seen = { pattern: req.routePattern, path: req.path };
                res.status(200).send({});
            });

            await fakeApp._routes.get[0].handler(
                makeUwsRes(),
                makeUwsReq({ url: "/items/abc123", params: ["abc123"] }),
            );

            expect(seen).toEqual({ pattern: "/items/:id", path: "/items/abc123" });
        });

        it("leaves req.routePattern undefined for the not-found and CORS preflight fallbacks", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            const patterns: any[] = [];
            // Registering a route first makes the middleware below post-route, as in Server.ts.
            router.get("/known", (_req: any, res: any) => res.status(200).send({}));
            router.use(((err: any, req: any, res: any, next: any) => {
                patterns.push(req.routePattern);
                res.status(err.status).send({});
            }) as any);
            router.use((req: any, res: any) => {
                patterns.push(req.routePattern);
                res.status(204).send();
            });
            const promise = router.listen("127.0.0.1", 0);
            fakeApp._fireListen({});
            await promise;

            const notFound = fakeApp._routes.get.find((r: any) => r.path === "/*").handler;
            const uwsRes = makeUwsRes();
            await notFound(uwsRes, makeUwsReq({ url: "/random-1234" }));
            expect(uwsRes._calls.statuses).toEqual(["404 Not Found"]);

            const head = fakeApp._routes.head.find((r: any) => r.path === "/*").handler;
            const headRes = makeUwsRes();
            await head(headRes, makeUwsReq({ method: "head", url: "/random-5678" }));
            expect(headRes._calls.endedWithoutBody).toHaveLength(1);

            const preflight = fakeApp._routes.options.find((r: any) => r.path === "/*").handler;
            await preflight(makeUwsRes(), makeUwsReq({ method: "options", url: "/whatever" }));

            expect(patterns).toEqual([undefined, undefined, undefined]);
            // A HEAD/GET fallback registration must not be mistaken for an app-defined root wildcard.
            expect((router as any).rootWildcardVerbs.size).toBe(0);
        });

        it("sets req.routePattern on WebSocket upgrade requests", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            router.ws("/push/:channel", [(_req, _res, next) => next()]);
            const behavior = fakeApp._wsBehaviors[0];
            let upgraded: any;
            const uwsRes: any = {
                ...makeUwsRes(),
                upgrade: (data: any) => {
                    upgraded = data;
                },
            };

            behavior.upgrade(uwsRes, makeUwsReq({ url: "/push/abc" }), {});

            expect(upgraded.req.routePattern).toBe("/push/:channel");
        });
    });

    describe("remote address", () => {
        it("normalizes uWS's fully expanded IPv4-mapped address", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            let seen: string | undefined;
            router.get("/ip", (req: any, res: any) => {
                seen = req.socket.remoteAddress;
                res.status(200).send({});
            });

            await fakeApp._routes.get[0].handler(makeUwsRes("0000:0000:0000:0000:0000:ffff:7f00:0001"), makeUwsReq());
            expect(seen).toBe("127.0.0.1");

            await fakeApp._routes.get[0].handler(makeUwsRes("not-an-ip"), makeUwsReq());
            expect(seen).toBe("not-an-ip");
        });
    });

    describe("ws() options and messages", () => {
        it("applies explicit default WebSocket options that a route can override", () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            router.ws("/a", [], undefined);
            router.ws("/b", [], { maxPayloadLength: 1024, idleTimeout: 0 });

            const a = fakeApp._wsBehaviors[0];
            expect(a.maxPayloadLength).toBe(DEFAULT_WS_OPTIONS.maxPayloadLength);
            expect(a.idleTimeout).toBe(DEFAULT_WS_OPTIONS.idleTimeout);
            expect(a.maxBackpressure).toBe(DEFAULT_WS_OPTIONS.maxBackpressure);

            const b = fakeApp._wsBehaviors[2];
            expect(b.maxPayloadLength).toBe(1024);
            expect(b.idleTimeout).toBe(0);
            expect(b.maxBackpressure).toBe(DEFAULT_WS_OPTIONS.maxBackpressure);
        });

        it("copies a binary message so it stays valid after uWS neuters the ArrayBuffer", () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            router.ws("/bin", []);
            const behavior = fakeApp._wsBehaviors[0];
            const emitted: any[] = [];
            const ws: any = { getUserData: () => ({ shim: { emit: (...args: any[]) => emitted.push(args) } }) };

            const message = new Uint8Array([1, 2, 3, 4]).buffer;
            behavior.message(ws, message, true);
            // Detach the original ArrayBuffer, which is what uWS does once the callback returns.
            structuredClone(message, { transfer: [message] });
            expect(message.byteLength).toBe(0);

            const [event, data, isBinary] = emitted[0];
            expect(event).toBe("message");
            expect(isBinary).toBe(true);
            expect([...data]).toEqual([1, 2, 3, 4]);

            behavior.message(ws, new TextEncoder().encode("hi").buffer, false);
            expect(emitted[1][1]).toBe("hi");
        });
    });

    describe("shutdown", () => {
        it("waits for an in-flight request to finish, then closes every remaining connection", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            let release!: () => void;
            router.get("/slow", async (_req: any, res: any) => {
                await new Promise<void>((resolve) => {
                    release = resolve;
                });
                res.status(200).send({ done: true });
            });

            const uwsRes = makeUwsRes();
            const pending = fakeApp._routes.get[0].handler(uwsRes, makeUwsReq({ url: "/slow" }));
            await new Promise((resolve) => setImmediate(resolve));
            expect(router.inFlightRequests).toBe(1);

            let shutdownDone = false;
            const shutdown = router.shutdown(5000).then(() => {
                shutdownDone = true;
            });
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(shutdownDone).toBe(false);
            expect(fakeApp.close).not.toHaveBeenCalled();

            release();
            await pending;
            await shutdown;

            expect(uwsRes._calls.statuses).toEqual(["200 OK"]);
            expect(router.inFlightRequests).toBe(0);
            expect(fakeApp.close).toHaveBeenCalledTimes(1);
        });

        it("stops waiting once the drain timeout elapses", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp);
            router.get("/hang", () => new Promise<void>(() => undefined));

            void fakeApp._routes.get[0].handler(makeUwsRes(), makeUwsReq({ url: "/hang" }));
            await new Promise((resolve) => setImmediate(resolve));

            const started = Date.now();
            await router.shutdown(30);
            expect(Date.now() - started).toBeLessThan(1000);
            expect(router.inFlightRequests).toBe(1);
            expect(fakeApp.close).toHaveBeenCalledTimes(1);
        });

        it("tolerates the uWS app already being closed", async () => {
            const fakeApp: any = makeFakeUwsApp();
            fakeApp.close = vi.fn(() => {
                throw new Error("already closed");
            });
            const router = new HttpRouter(fakeApp);
            await expect(router.shutdown(0)).resolves.toBeUndefined();
        });

        it("counts a request rejected for an oversized body as finished", async () => {
            const fakeApp: any = makeFakeUwsApp();
            const router = new HttpRouter(fakeApp, 2);
            router.post("/upload", (_req: any, res: any) => res.status(200).send({}));
            const uwsRes: any = makeUwsRes();
            uwsRes.onData = (cb: (chunk: ArrayBuffer, isLast: boolean) => void) => cb(new ArrayBuffer(10), true);

            await fakeApp._routes.post[0].handler(uwsRes, makeUwsReq({ method: "post", url: "/upload" }));

            expect(uwsRes._calls.statuses).toEqual(["413 Payload Too Large"]);
            expect(router.inFlightRequests).toBe(0);
        });
    });
});
