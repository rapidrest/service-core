///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Covers HttpRouter.ws()'s pre-upgrade auth handling directly, without a real uWS server: the
// `behavior.upgrade` closure built by `.ws()` is captured off a fake `uwsApp` stub (mirroring
// test/http/uWS/Adapters.test.ts's makeUwsReq/makeUwsRes helpers) and invoked with fake uWS
// request/response objects. This is the one branch (upgradeAuth rejecting with a 401) that no
// other WS integration test exercises — everything else about WS routing goes through a real
// uWS server elsewhere in the suite.
import { HttpRouter } from "../../../src/http/uWS/Router";

function makeUwsReq(headers: Record<string, string> = {}) {
    return {
        getMethod: () => "get",
        getUrl: () => "/chat",
        getQuery: () => "",
        getHeader: (name: string) => headers[name] ?? "",
        forEach: (cb: (key: string, value: string) => void) => {
            for (const [k, v] of Object.entries(headers)) cb(k, v);
        },
    };
}

function makeUwsRes() {
    const calls: any = { statuses: [], headers: [], ended: [], upgraded: [] };
    return {
        getRemoteAddressAsText: () => Buffer.from("127.0.0.1"),
        cork: (fn: () => void) => fn(),
        writeStatus: (s: string) => calls.statuses.push(s),
        writeHeader: (k: string, v: string) => calls.headers.push([k, v]),
        end: (data?: any) => calls.ended.push(data),
        upgrade: (userData: any, secKey: string, secProtocol: string, secExtensions: string, context: any) =>
            calls.upgraded.push({ userData, secKey, secProtocol, secExtensions, context }),
        _calls: calls,
    };
}

function captureWsBehavior(router: HttpRouter): any {
    return (router as any).uwsApp._wsBehaviors[0];
}

function makeFakeUwsApp() {
    const wsBehaviors: any[] = [];
    return {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
        patch: vi.fn(),
        head: vi.fn(),
        options: vi.fn(),
        ws: (_path: string, behavior: any) => wsBehaviors.push(behavior),
        _wsBehaviors: wsBehaviors,
    };
}

describe("HttpRouter.ws() upgradeAuth handling", () => {
    it("rejects the upgrade with a 401 JSON response and never calls uwsRes.upgrade()", () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        router.ws("/chat", [(_req, _res, next) => next()], undefined, () => ({ reject: true }));
        const behavior = captureWsBehavior(router);

        const uwsRes = makeUwsRes();
        behavior.upgrade(uwsRes, makeUwsReq(), {});

        expect(uwsRes._calls.statuses).toEqual(["401 Unauthorized"]);
        expect(uwsRes._calls.headers).toEqual([["content-type", "application/json"]]);
        expect(JSON.parse(uwsRes._calls.ended[0])).toEqual({ status: 401, message: "Unauthorized" });
        expect(uwsRes._calls.upgraded).toEqual([]);
    });

    it("attaches user/auth info to the upgraded userData when upgradeAuth accepts", () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        router.ws("/chat", [(_req, _res, next) => next()], undefined, () => ({
            user: { uid: "u1" },
            authPayload: { p: 1 },
            authToken: "tok",
        }));
        const behavior = captureWsBehavior(router);

        const uwsRes = makeUwsRes();
        behavior.upgrade(uwsRes, makeUwsReq({ "sec-websocket-key": "key123" }), {});

        expect(uwsRes._calls.upgraded).toHaveLength(1);
        const { userData, secKey } = uwsRes._calls.upgraded[0];
        expect(secKey).toBe("key123");
        expect(userData.req.user).toEqual({ uid: "u1" });
        expect(userData.req.auth).toEqual({ user: { uid: "u1" }, authPayload: { p: 1 }, authToken: "tok" });
        expect(userData.req.authPayload).toEqual({ p: 1 });
        expect(userData.req.authToken).toBe("tok");
    });

    it("upgrades without attaching a user when upgradeAuth falls through with {}", () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        router.ws("/chat", [(_req, _res, next) => next()], undefined, () => ({}));
        const behavior = captureWsBehavior(router);

        const uwsRes = makeUwsRes();
        behavior.upgrade(uwsRes, makeUwsReq(), {});

        expect(uwsRes._calls.upgraded).toHaveLength(1);
        expect(uwsRes._calls.upgraded[0].userData.req.user).toBeUndefined();
    });

    it("upgrades directly when no upgradeAuth function is provided at all", () => {
        const fakeApp: any = makeFakeUwsApp();
        const router = new HttpRouter(fakeApp);
        router.ws("/chat", [(_req, _res, next) => next()]);
        const behavior = captureWsBehavior(router);

        const uwsRes = makeUwsRes();
        behavior.upgrade(uwsRes, makeUwsReq(), {});

        expect(uwsRes._calls.upgraded).toHaveLength(1);
        expect(uwsRes._calls.statuses).toEqual([]);
    });
});
