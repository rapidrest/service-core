///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// General HttpRouter coverage, complementing Router.upgradeAuth.test.ts (which only covers
// ws()'s pre-upgrade auth branch). Uses the same fake-uwsApp/uwsReq/uwsRes approach: the
// closures built by get()/post()/options()/ws()/listen() are captured off a fake `uwsApp`
// stub and invoked directly with fake uWS request/response objects, without a real server.
import { HttpRouter } from "../../../src/http/uWS/Router";

function makeUwsReq(overrides: Partial<{ method: string; url: string; headers: Record<string, string> }> = {}) {
    const headers = overrides.headers ?? {};
    return {
        getMethod: () => overrides.method ?? "get",
        getUrl: () => overrides.url ?? "/foo",
        getQuery: () => "",
        getHeader: (name: string) => headers[name] ?? "",
        getParameter: () => "",
        forEach: (cb: (key: string, value: string) => void) => {
            for (const [k, v] of Object.entries(headers)) cb(k, v);
        },
    };
}

function makeUwsRes() {
    const calls: any = { statuses: [], headers: [], ended: [], endedWithoutBody: [] };
    let onAbortedCb: (() => void) | undefined;
    return {
        getRemoteAddressAsText: () => Buffer.from("127.0.0.1"),
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
});
