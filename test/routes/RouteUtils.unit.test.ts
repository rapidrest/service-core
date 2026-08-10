///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// Unit-level tests for RouteUtils covering middleware factories and wrapMiddleware argument
// resolution branches that the full-server integration tests don't specifically exercise
// (disabled ACL fast-path, missing user scopes, the base64 "q" query buffer feature, etc).
import "reflect-metadata";
import { RouteUtils } from "../../src/routes/RouteUtils";
import {
    Auth,
    AuthResult as AuthResultDecorator,
    Get,
    Header,
    Protect,
    Query,
    RequiresElevation,
    RequiresRole,
    RequiresScope,
    Route,
    Socket,
    WebSocket,
} from "../../src/decorators/RouteDecorators";

function makeApp() {
    const registered: Record<string, any> = {};
    const verbStub =
        (verb: string) =>
        (path: string, ...handlers: any[]) => {
            registered[`${verb} ${path}`] = handlers;
        };
    return {
        get: verbStub("get"),
        post: verbStub("post"),
        put: verbStub("put"),
        delete: verbStub("delete"),
        patch: verbStub("patch"),
        head: verbStub("head"),
        options: verbStub("options"),
        ws: (path: string, middleware: any, _opts: any, upgradeAuth: any) => {
            registered[`ws ${path}`] = { middleware, upgradeAuth };
        },
        use: vi.fn(),
        _registered: registered,
    };
}

function makeLogger() {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeReq(overrides: any = {}): any {
    return { headers: {}, params: {}, query: {}, socket: {}, ...overrides };
}

function makeRes(): any {
    const headers: Record<string, string> = {};
    return {
        headersSent: false,
        status: vi.fn().mockReturnThis(),
        setHeader: vi.fn((k: string, v: string) => {
            headers[k] = v;
        }),
        getHeader: (k: string) => headers[k],
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
    };
}

describe("RouteUtils.checkElevation", () => {
    it("calls next() when the user is elevated", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkElevation();
        const next = vi.fn();
        handler(makeReq({ user: { uid: "u1", elevated: Date.now() - 1000 } }), makeRes(), next);
        expect(next).toHaveBeenCalledWith();
    });

    it("calls next() when the user is elevated within a valid start window", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkElevation(60);
        const next = vi.fn();
        handler(makeReq({ user: { uid: "u1", elevated: Date.now() } }), makeRes(), next);
        expect(next).toHaveBeenCalledWith();
    });

    it("calls next(err) when the user's elevated value is undefined", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkElevation();
        const next = vi.fn();
        handler(makeReq({ user: { uid: "u1" } }), makeRes(), next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls next(err) when the user's elevated value is invalid", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkElevation();
        const next = vi.fn();
        handler(makeReq({ user: { uid: "u1", elevated: -1 } }), makeRes(), next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls next(err) when the user's elevated value is outside the start window", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkElevation(60);
        const next = vi.fn();
        handler(makeReq({ user: { uid: "u1", elevated: Date.now() - 61000 } }), makeRes(), next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
});

describe("RouteUtils.checkRequiredPerms", () => {
    it("calls next() immediately when ACL enforcement is disabled", async () => {
        const routeUtils: any = new RouteUtils();
        routeUtils.aclUtils = { enabled: false };
        const handler = routeUtils.checkRequiredPerms("acl-uid");
        const next = vi.fn();
        await handler(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledWith();
    });

    it("calls next() when the user has the required permission", async () => {
        const routeUtils: any = new RouteUtils();
        routeUtils.aclUtils = { enabled: true, checkRequestPerms: vi.fn().mockResolvedValue(true) };
        const handler = routeUtils.checkRequiredPerms("acl-uid");
        const next = vi.fn();
        await handler(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledWith();
    });

    it("calls next(err) when the user lacks the required permission", async () => {
        const routeUtils: any = new RouteUtils();
        routeUtils.aclUtils = { enabled: true, checkRequestPerms: vi.fn().mockResolvedValue(false) };
        const handler = routeUtils.checkRequiredPerms("acl-uid");
        const next = vi.fn();
        await handler(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
});

describe("RouteUtils.checkRequiredRoles", () => {
    it("calls next() when the user has one of the required roles", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkRequiredRoles(["admin"]);
        const next = vi.fn();
        handler(makeReq({ user: { uid: "u1", roles: ["admin"] } }), makeRes(), next);
        expect(next).toHaveBeenCalledWith();
    });

    it("calls next(err) when the user lacks the required roles", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkRequiredRoles(["admin"]);
        const next = vi.fn();
        handler(makeReq({ user: { uid: "u1", roles: [] } }), makeRes(), next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
});

describe("RouteUtils.checkRequiredScopes", () => {
    it("calls next() when the user's token carries the FULL scope", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkRequiredScopes(["read:widgets"]);
        const next = vi.fn();
        handler(makeReq({ user: { scopes: ["*"] } }), makeRes(), next);
        expect(next).toHaveBeenCalledWith();
    });

    it("calls next() when the user's token carries one of the required scopes", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkRequiredScopes(["read:widgets"]);
        const next = vi.fn();
        handler(makeReq({ user: { scopes: ["read:widgets"] } }), makeRes(), next);
        expect(next).toHaveBeenCalledWith();
    });

    it("defaults to no scopes and calls next(err) when the user has none", () => {
        const routeUtils = new RouteUtils();
        const handler = routeUtils.checkRequiredScopes(["read:widgets"]);
        const next = vi.fn();
        handler(makeReq({ user: {} }), makeRes(), next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });
});

describe("RouteUtils.getFuncArray", () => {
    it("returns an empty array when funcs is undefined", () => {
        const routeUtils = new RouteUtils();
        expect(routeUtils.getFuncArray({}, undefined as any)).toEqual([]);
    });

    it("resolves a function by name from the route object", () => {
        const routeUtils = new RouteUtils();
        const route = { myFunc: () => "called" };
        const result = routeUtils.getFuncArray(route, ["myFunc"]);
        expect(result).toHaveLength(1);
    });

    it("wraps a directly-provided function reference", () => {
        const routeUtils = new RouteUtils();
        const route = {};
        const fn = function namedFn() {
            return "ok";
        };
        const result = routeUtils.getFuncArray(route, [fn]);
        expect(result).toHaveLength(1);
    });
});

describe("RouteUtils.wrapMiddleware argument resolution", () => {
    @Route("/test")
    class TestRoute {
        public lastArgs: any[] = [];

        @Get("/authresult")
        public withAuthResult(@AuthResultDecorator authResult: any) {
            this.lastArgs = [authResult];
            return { ok: true };
        }

        @Get("/header/:name")
        public withNamedHeader(@Header("x-custom") value: any) {
            this.lastArgs = [value];
            return { ok: true };
        }

        @Get("/headers")
        public withAllHeaders(@Header() headers: any) {
            this.lastArgs = [headers];
            return { ok: true };
        }

        @Get()
        public withQuery(@Query() query: any) {
            this.lastArgs = [query];
            return { ok: true };
        }

        @Get("/socket")
        public withSocket(@Socket socket: any) {
            this.lastArgs = [socket];
            return { ok: true };
        }

        @RequiresElevation()
        @Get("/elevation")
        public withElevation() {
            return { ok: true };
        }

        @RequiresRole("admin")
        @Get("/roles")
        public withRoles() {
            return { ok: true };
        }

        @RequiresScope("read:widgets")
        @Get("/scopes")
        public withScopes() {
            return { ok: true };
        }
    }

    it("resolves the @AuthResult decorator argument from req.auth", async () => {
        const routeUtils = new RouteUtils();
        const route = new TestRoute();
        const handler = routeUtils.wrapMiddleware(route, route.withAuthResult);
        const req = makeReq({ auth: { method: "jwt", user: { uid: "u1" } } });
        const res = makeRes();
        const next = vi.fn();
        await handler(req, res, next);
        expect(route.lastArgs[0]).toEqual({ method: "jwt", user: { uid: "u1" } });
    });

    it("resolves a named @Header argument", async () => {
        const routeUtils = new RouteUtils();
        const route = new TestRoute();
        const handler = routeUtils.wrapMiddleware(route, route.withNamedHeader);
        const req = makeReq({ headers: { "x-custom": "hello" } });
        await handler(req, makeRes(), vi.fn());
        expect(route.lastArgs[0]).toBe("hello");
    });

    it("resolves the full headers object for an unnamed @Header argument", async () => {
        const routeUtils = new RouteUtils();
        const route = new TestRoute();
        const handler = routeUtils.wrapMiddleware(route, route.withAllHeaders);
        const req = makeReq({ headers: { a: "1" } });
        await handler(req, makeRes(), vi.fn());
        expect(route.lastArgs[0]).toEqual({ a: "1" });
    });

    it("resolves the @Socket decorator to req.websocket when present, else req.socket", async () => {
        const routeUtils = new RouteUtils();
        const route = new TestRoute();
        const handler = routeUtils.wrapMiddleware(route, route.withSocket);
        const fakeSocket = { send: vi.fn() };
        const req = makeReq({ websocket: fakeSocket });
        await handler(req, makeRes(), vi.fn());
        expect(route.lastArgs[0]).toBe(fakeSocket);
    });

    it("decodes a base64-encoded 'q' query parameter into JSON", async () => {
        const routeUtils = new RouteUtils();
        const route = new TestRoute();
        const handler = routeUtils.wrapMiddleware(route, route.withQuery);
        const encoded = Buffer.from(JSON.stringify({ name: "widget" })).toString("base64");
        const req = makeReq({ query: { q: encoded } });
        await handler(req, makeRes(), vi.fn());
        expect(route.lastArgs[0]).toEqual({ name: "widget" });
    });

    it("rejects a 'q' query parameter that exceeds the maximum size", async () => {
        const routeUtils = new RouteUtils();
        const route = new TestRoute();
        const handler = routeUtils.wrapMiddleware(route, route.withQuery);
        const req = makeReq({ query: { q: "x".repeat(70_000) } });
        const next = vi.fn();
        await handler(req, makeRes(), next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls res.send() when no next callback is provided", async () => {
        const routeUtils = new RouteUtils();
        const route = new TestRoute();
        const handler = routeUtils.wrapMiddleware(route, route.withQuery, false);
        const req = makeReq();
        const res = makeRes();
        await (handler as any)(req, res, undefined);
        expect(res.send).toHaveBeenCalled();
    });
});

describe("RouteUtils.registerRoute", () => {
    it("throws when the route defines no path", async () => {
        class NoPathRoute {
            @Get()
            public find() {
                return {};
            }
        }
        const routeUtils = new RouteUtils();
        await expect(routeUtils.registerRoute(makeApp(), new NoPathRoute())).rejects.toThrow(
            "Route must specify a path",
        );
    });

    it("logs and rethrows when saving the class-level default ACL fails", async () => {
        @Route("/protected")
        @Protect()
        class ProtectedRoute {
            @Get()
            public find() {
                return {};
            }
        }
        const routeUtils: any = new RouteUtils();
        routeUtils.logger = makeLogger();
        routeUtils.aclUtils = {
            enabled: true,
            saveDefaultACL: vi.fn().mockRejectedValue(new Error("db unavailable")),
        };
        await expect(routeUtils.registerRoute(makeApp(), new ProtectedRoute())).rejects.toThrow("db unavailable");
        expect(routeUtils.logger.error).toHaveBeenCalled();
    });

    it("saves a per-route ACL parented to the class-level default ACL", async () => {
        @Route("/protected2")
        @Protect({ uid: "class-acl", records: [] })
        class ProtectedRoute2 {
            @Protect({ uid: "method-acl", records: [] })
            @Get()
            public find() {
                return {};
            }
        }
        const routeUtils: any = new RouteUtils();
        routeUtils.logger = makeLogger();
        const savedAcls: any[] = [];
        routeUtils.aclUtils = {
            enabled: true,
            saveDefaultACL: vi.fn(async (acl: any) => {
                savedAcls.push(acl);
                return acl;
            }),
            checkRequestPerms: vi.fn().mockResolvedValue(true),
        };
        const app = makeApp();
        await routeUtils.registerRoute(app, new ProtectedRoute2());
        expect(savedAcls.map((a) => a.uid)).toEqual(["class-acl", "method-acl"]);
        expect(savedAcls[1].parentUid).toBe("class-acl");
        expect(app._registered["get /protected2"]).toBeDefined();
    });

    it("registers a websocket route and wires up pre-upgrade auth", async () => {
        @Route("/ws-route")
        class WsRoute {
            @WebSocket("/connect")
            public connect() {
                return undefined;
            }
        }
        const routeUtils: any = new RouteUtils();
        routeUtils.logger = makeLogger();
        routeUtils.authMiddleware = {
            authenticateSync: vi.fn().mockReturnValue({ method: "jwt", user: { uid: "u1" } }),
            authWebSocket: vi.fn().mockReturnValue(vi.fn()),
        };
        const app = makeApp();
        await routeUtils.registerRoute(app, new WsRoute());
        const registered = app._registered["ws /ws-route/connect"];
        expect(registered).toBeDefined();
        const result = registered.upgradeAuth(makeReq());
        expect(result).toEqual({ method: "jwt", user: { uid: "u1" } });
    });

    it("rejects the pre-upgrade auth when authenticateSync throws", async () => {
        @Route("/ws-route2")
        class WsRoute2 {
            @WebSocket("/connect")
            public connect() {
                return undefined;
            }
        }
        const routeUtils: any = new RouteUtils();
        routeUtils.logger = makeLogger();
        routeUtils.authMiddleware = {
            authenticateSync: vi.fn().mockImplementation(() => {
                throw new Error("bad token");
            }),
            authWebSocket: vi.fn().mockReturnValue(vi.fn()),
        };
        const app = makeApp();
        await routeUtils.registerRoute(app, new WsRoute2());
        const registered = app._registered["ws /ws-route2/connect"];
        const result = registered.upgradeAuth(makeReq());
        expect(result).toEqual({ reject: true });
    });

    it("registers required-scope middleware when @RequiresScope is present", async () => {
        @Route("/scoped")
        class ScopedRoute {
            @RequiresScope("read:widgets")
            @Get()
            public find() {
                return {};
            }
        }
        const routeUtils = new RouteUtils();
        (routeUtils as any).logger = makeLogger();
        const app = makeApp();
        await routeUtils.registerRoute(app, new ScopedRoute());
        expect(app._registered["get /scoped"]).toBeDefined();
    });

    it("registers requires-elevation middleware when @RequiresElevation is present", async () => {
        @Route("/elevated")
        class ElevatedRoute {
            @RequiresElevation()
            @Get()
            public find() {
                return {};
            }
        }
        const routeUtils = new RouteUtils();
        (routeUtils as any).logger = makeLogger();
        const app = makeApp();
        await routeUtils.registerRoute(app, new ElevatedRoute());
        expect(app._registered["get /elevated"]).toBeDefined();
    });

    it("rejects with 401 when authentication is required and fails", async () => {
        @Route("/secure")
        class SecureRoute {
            @Auth(["jwt"], true)
            @Get()
            public find() {
                return { ok: true };
            }
        }
        const routeUtils: any = new RouteUtils();
        routeUtils.logger = makeLogger();
        routeUtils.authMiddleware = {
            authenticate: vi.fn().mockResolvedValue(undefined),
        };
        const app = makeApp();
        await routeUtils.registerRoute(app, new SecureRoute());
        const [authMw] = app._registered["get /secure"];
        const next = vi.fn();
        await authMw(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledWith(expect.any(Error));
    });

    it("calls next() without error when auth is not required and authentication throws", async () => {
        @Route("/optional-auth")
        class OptionalAuthRoute {
            @Get()
            public find() {
                return { ok: true };
            }
        }
        const routeUtils: any = new RouteUtils();
        routeUtils.logger = makeLogger();
        routeUtils.authMiddleware = {
            authenticate: vi.fn().mockRejectedValue(new Error("network error")),
        };
        const app = makeApp();
        await routeUtils.registerRoute(app, new OptionalAuthRoute());
        const [authMw] = app._registered["get /optional-auth"];
        const next = vi.fn();
        await authMw(makeReq(), makeRes(), next);
        expect(next).toHaveBeenCalledWith();
    });
});
