///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import uWS from "uWebSockets.js";
import { DEFAULT_MAX_BODY_SIZE, UWSRequest, UWSResponse, makeBodyStream, readBody } from "./Adapters.js";
import {
    DEFAULT_WS_OPTIONS,
    type HttpRequest,
    type HttpResponse,
    type HttpRouteOptions,
    type IHttpRouter,
    type NextFunction,
    type RequestHandler,
    type WebSocketOptions,
} from "../types.js";
import { NetUtils } from "../../NetUtils.js";
import { UWSWebSocketShim, type RequestWS } from "./WebSocket.js";
import { extractParamNames, makeWsStubResponse, runChain, splitRouteArgs, type WsUpgradeAuth } from "../MiddlewareChain.js";
import { ApiError } from "@rapidrest/core";
import { ApiErrorMessages, ApiErrors } from "../../ApiErrors.js";

export { runChain, extractParamNames } from "../MiddlewareChain.js";
export type { WsUpgradeAuth, WsUpgradeAuthResult } from "../MiddlewareChain.js";

/** Strips a single trailing slash from a pathname, except for the root `"/"` itself - mirrors
 * `BunRouter.ts`'s identical helper, kept so `explicitOptionsPaths` matching is consistent across
 * both runtimes despite a request's raw path never having its own trailing slash stripped upstream. */
function normalizePath(pathname: string): string {
    if (pathname.length > 1 && pathname.endsWith("/")) {
        return pathname.slice(0, -1);
    }
    return pathname;
}

/** Reads a uWS connection's remote address and normalizes it (uWS reports IPv4 clients of a dual-stack socket as a
 * fully expanded IPv4-mapped IPv6 address, e.g. `0000:0000:0000:0000:0000:ffff:7f00:0001`). */
function remoteAddressOf(uwsRes: uWS.HttpResponse): string {
    const raw: string = Buffer.from(uwsRes.getRemoteAddressAsText()).toString();
    return NetUtils.normalizeIP(raw) ?? raw;
}

/** Counts the HTTP requests a router is currently handling, so `shutdown()` can wait for them. */
interface InFlightCounter {
    count: number;
}

/** Options for `makeUWSHandler()`. */
interface UWSHandlerOptions {
    /** The number of global middleware registered before this route. */
    preLength: number;
    /** The route's `:param` names, in order. */
    paramNames: string[];
    /** The registered route pattern, exposed as `req.routePattern`. `undefined` for the router's own fallbacks. */
    routePattern: string | undefined;
    isHead?: boolean;
    maxBodySize?: number;
    inFlight: InFlightCounter;
    /** When `true`, skip buffering the body and expose it as `req.bodyStream` instead — see `HttpRouteOptions`. */
    streamingBody?: boolean;
}

/**
 * Wraps a uWS route handler to convert uWS request/response objects into `HttpRequest`/`HttpResponse`
 * adapters, reads the body, and runs the full middleware chain (pre-route global + route-specific + post-route global).
 *
 * `preLength` is the number of global middleware items that were registered BEFORE this route was registered.
 * At invocation time we split `globalMiddleware` at that index so that error handlers and metrics registered
 * AFTER the routes are placed after the route handlers in the chain (matching Express middleware ordering).
 */
function makeUWSHandler(
    globalMiddleware: RequestHandler[],
    routeHandlers: RequestHandler[],
    options: UWSHandlerOptions,
) {
    const {
        preLength,
        paramNames,
        routePattern,
        isHead = false,
        maxBodySize = DEFAULT_MAX_BODY_SIZE,
        inFlight,
        streamingBody = false,
    } = options;
    // Built lazily on the first request and reused thereafter. Safe because all use() calls
    // complete before listen() is invoked, and requests only arrive after listen().
    let allHandlers: RequestHandler[] | null = null;

    return async (uwsRes: uWS.HttpResponse, uwsReq: uWS.HttpRequest) => {
        inFlight.count++;
        try {
            await handle(uwsRes, uwsReq);
        } finally {
            inFlight.count--;
        }
    };

    async function handle(uwsRes: uWS.HttpResponse, uwsReq: uWS.HttpRequest): Promise<void> {
        // Capture remote address before any async work
        const remoteAddress = remoteAddressOf(uwsRes);

        // Build adapters — all uWS HttpRequest reads happen here synchronously
        const req = new UWSRequest(uwsReq, remoteAddress);
        req.routePattern = routePattern;
        const res = new UWSResponse(uwsRes);
        res.isHead = isHead;

        // Capture path params synchronously (uwsReq is stack-allocated, only valid before first await).
        // uWS never decodes route segments itself (unlike the query-string parsing in Adapters.ts), so a
        // caller-encoded value (e.g. `encodeURIComponent()`-ing an email-address-derived uid before
        // building the URL, this library's own established convention) would otherwise arrive here still
        // percent-encoded and fail every downstream uid lookup. Falls back to the raw value on malformed
        // percent-encoding (e.g. a bare "%"), matching Adapters.ts's identical query-string fallback.
        for (let i = 0; i < paramNames.length; i++) {
            const raw = uwsReq.getParameter(i) || "";
            try {
                req.params[paramNames[i]] = decodeURIComponent(raw);
            } catch {
                req.params[paramNames[i]] = raw;
            }
        }

        if (streamingBody) {
            // Opted out of buffering (see HttpRouteOptions.streamingBody / @StreamingBody()) — expose
            // the raw body as a stream instead. This must happen synchronously, in the same tick as
            // req/res construction above, since uWS requires onData/onAborted to be registered before
            // any asynchronous operation (matching readBody()'s own constraint below). No maxBodySize
            // check applies here: buffering is exactly what a streaming route opted out of, so there's
            // nothing to buffer or cap up front — enforcing a limit, if desired, is left to the
            // handler consuming req.bodyStream.
            req.bodyStream = makeBodyStream(uwsRes, res);
            // See UWSResponse.end() / isBodyStreamFullyReceived(): lets end() force-close the
            // connection instead of hanging it if the response finalizes before the declared body
            // has actually arrived (e.g. a route rejecting the request without ever reading the
            // stream — an auth failure, a validation error, or a client that never sends the body
            // it declared at all).
            res.attachBodyStream(req.bodyStream);
        } else {
            // Body must be read before any middleware runs. If it exceeds maxBodySize, readBody() has
            // already written a 413 response and ended the connection — stop here without running any
            // middleware/route logic against a truncated/oversized body.
            let bodyOk = true;
            try {
                bodyOk = await readBody(uwsRes, req, maxBodySize, res);
            } catch {
                // Non-fatal: body may not exist for GET/HEAD/OPTIONS
            }
            if (!bodyOk) {
                return;
            }
        }

        // Build the combined handler chain once; reuse on every subsequent request.
        if (allHandlers === null) {
            allHandlers = [
                ...globalMiddleware.slice(0, preLength),
                ...routeHandlers,
                ...globalMiddleware.slice(preLength),
            ];
        }
        await runChain(allHandlers, req, res);

        // If no handler sent a response, end with 204
        if (!res.writableEnded && !res["_aborted"]) {
            res.status(204).end();
        }
    }
}

/**
 * Thin Express-compatible wrapper over `uWS.TemplatedApp`.
 *
 * Provides the same `app.get()`, `app.post()`, `app.use()`, etc. API that
 * `RouteUtils.registerRoute()` uses, so no changes are needed in route registration
 * code. Global middleware registered via `use()` is prepended to every route's chain.
 *
 * Also supports:
 * - `ws(path, handlers)` — native uWS WebSocket routing
 * - `listen(host, port)` / `close()` — server lifecycle
 */
export class HttpRouter implements IHttpRouter {
    private readonly uwsApp: uWS.TemplatedApp;
    private readonly globalMiddleware: RequestHandler[] = [];
    private listenSocket: uWS.us_listen_socket | null = null;
    /**
     * Number of global middleware items registered BEFORE the first route was added.
     * -1 means no routes have been registered yet (preRouteCount not yet frozen).
     */
    private preRouteCount: number = -1;
    /** The port the server is currently listening on (set after a successful `listen()` call). */
    public listenPort: number = 0;
    /**
     * HTTP verbs for which the application has already registered its own literal `/*` route
     * (e.g. a `BaseStaticRoute` mounted at the site root via `@Route("/")`). Used by `listen()` to
     * avoid clobbering an app-defined root catch-all with the default JSON 404 fallback.
     */
    private readonly rootWildcardVerbs: Set<string> = new Set();
    /**
     * Literal (non-`/*`) paths for which the application has registered its own `.options()` route
     * (e.g. via `@Options()`). Consulted by `Server.ts`'s global CORS middleware so a real,
     * app-defined `OPTIONS` handler (e.g. an EAS route's `MS-ASProtocolVersions` discovery response)
     * gets a chance to run instead of the blanket CORS preflight 204.
     */
    private readonly explicitOptionsPaths: Set<string> = new Set();
    /** Maximum accepted request body size, in bytes. */
    private readonly maxBodySize: number;
    /** The HTTP requests currently being handled. */
    private readonly inFlight: InFlightCounter = { count: 0 };

    constructor(uwsApp: uWS.TemplatedApp, maxBodySize: number = DEFAULT_MAX_BODY_SIZE) {
        this.uwsApp = uwsApp;
        this.maxBodySize = maxBodySize;
    }

    /** Returns `true` if the server is currently listening. */
    public get isListening(): boolean {
        return this.listenSocket !== null;
    }

    /** Register global middleware that runs before every route handler. */
    public use(...handlers: RequestHandler[]): this {
        this.globalMiddleware.push(...handlers);
        return this;
    }

    /**
     * Freezes the pre-route middleware count the first time a route is registered.
     * All global middleware registered BEFORE this call is "pre-route" middleware;
     * everything added after is "post-route" (error handlers, metrics, etc.).
     */
    private capturePreRouteCount(): number {
        if (this.preRouteCount === -1) {
            this.preRouteCount = this.globalMiddleware.length;
        }
        return this.preRouteCount;
    }

    /** Builds the uWS handler for a route registered at `routePattern` (`undefined` for the router's own fallbacks). */
    private makeHandler(
        handlers: RequestHandler[],
        preLength: number,
        routePattern: string | undefined,
        isHead: boolean = false,
        routeOptions: HttpRouteOptions = {},
    ) {
        return makeUWSHandler(this.globalMiddleware, handlers, {
            preLength,
            paramNames: routePattern ? extractParamNames(routePattern) : [],
            routePattern,
            isHead,
            maxBodySize: this.maxBodySize,
            inFlight: this.inFlight,
            streamingBody: routeOptions.streamingBody,
        });
    }

    // -------------------------------------------------------------------------
    // HTTP verb methods — each registers a uWS route
    // -------------------------------------------------------------------------

    public get(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const pre = this.capturePreRouteCount();
        if (routePath === "/*") this.rootWildcardVerbs.add("get");
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        this.uwsApp.get(routePath, this.makeHandler(handlers, pre, routePath, false, options));
        return this;
    }

    public post(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const pre = this.capturePreRouteCount();
        if (routePath === "/*") this.rootWildcardVerbs.add("post");
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        this.uwsApp.post(routePath, this.makeHandler(handlers, pre, routePath, false, options));
        return this;
    }

    public put(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const pre = this.capturePreRouteCount();
        if (routePath === "/*") this.rootWildcardVerbs.add("put");
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        this.uwsApp.put(routePath, this.makeHandler(handlers, pre, routePath, false, options));
        return this;
    }

    public delete(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const pre = this.capturePreRouteCount();
        if (routePath === "/*") this.rootWildcardVerbs.add("delete");
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        this.uwsApp.del(routePath, this.makeHandler(handlers, pre, routePath, false, options));
        return this;
    }

    public patch(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const pre = this.capturePreRouteCount();
        if (routePath === "/*") this.rootWildcardVerbs.add("patch");
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        this.uwsApp.patch(routePath, this.makeHandler(handlers, pre, routePath, false, options));
        return this;
    }

    public head(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const pre = this.capturePreRouteCount();
        if (routePath === "/*") this.rootWildcardVerbs.add("head");
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        // uWS explicitly-registered HEAD routes do send body bytes — suppress them via isHead flag
        this.uwsApp.head(routePath, this.makeHandler(handlers, pre, routePath, true, options));
        return this;
    }

    public options(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const pre = this.capturePreRouteCount();
        const normalized = normalizePath(routePath);
        // The framework's own `listen()` fallback registers exactly "/*" for CORS preflight support -
        // never treated as "explicit" here, so it keeps deferring to the CORS middleware's blanket 204.
        if (normalized !== "/*") this.explicitOptionsPaths.add(normalized);
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        this.uwsApp.options(routePath, this.makeHandler(handlers, pre, routePath, false, options));
        return this;
    }

    /** Returns `true` if the application has registered its own literal `OPTIONS` route at `path`
     * (not the framework's own `/*` CORS-preflight fallback). See `explicitOptionsPaths`'s own doc
     * comment. `path` is normalized the same way registered routes are, so a trailing-slash mismatch
     * between the two doesn't cause a false miss. Only exact literal paths are tracked - a
     * `:param`-containing `OPTIONS` route is not matched here, since that would require
     * reimplementing uWS's own path-pattern matching. */
    public hasExplicitOptionsRoute(path: string): boolean {
        return this.explicitOptionsPaths.has(normalizePath(path));
    }

    /**
     * Registers a WebSocket route. Handlers follow the same `(req, res, next)` pattern
     * as HTTP routes; they receive `req.websocket` containing the uWS WebSocket handle.
     *
     * `upgradeAuth` is an optional pre-upgrade auth function. When provided it runs synchronously
     * inside the uWS `upgrade` callback before the handshake. If it returns `{ reject: true }`,
     * an HTTP 401 is sent and the upgrade is aborted. If it returns `{ user, ... }`, those
     * credentials are attached to the request so downstream middleware sees an authenticated user.
     * If it returns `{}`, auth falls through to the post-upgrade message-based LOGIN flow.
     *
     * Both `path` and `path + "/"` are registered to avoid trailing-slash mismatch.
     */
    public ws(
        routePath: string,
        handlers: RequestHandler[],
        wsOptions?: Partial<uWS.WebSocketBehavior<any>> | WebSocketOptions,
        upgradeAuth?: WsUpgradeAuth,
    ): this {
        const behavior: uWS.WebSocketBehavior<any> = {
            // Explicit defaults, identical to the ones BunRouter applies, so a route behaves the same on both runtimes.
            ...DEFAULT_WS_OPTIONS,
            ...(wsOptions as Partial<uWS.WebSocketBehavior<any>>),

            upgrade: (uwsRes, uwsReq, context) => {
                // Capture all request data synchronously — uWS HttpRequest is stack-allocated
                const req = new UWSRequest(uwsReq, remoteAddressOf(uwsRes));
                req.routePattern = routePath;
                const secWebSocketKey = uwsReq.getHeader("sec-websocket-key");
                const secWebSocketProtocol = uwsReq.getHeader("sec-websocket-protocol");
                const secWebSocketExtensions = uwsReq.getHeader("sec-websocket-extensions");

                if (upgradeAuth) {
                    const authResult = upgradeAuth(req);
                    if (authResult.reject) {
                        // Reject before the WebSocket handshake with HTTP 401
                        uwsRes.cork(() => {
                            uwsRes.writeStatus("401 Unauthorized");
                            uwsRes.writeHeader("content-type", "application/json");
                            uwsRes.end(JSON.stringify({ status: 401, message: "Unauthorized" }));
                        });
                        return;
                    }
                    // Pre-authenticated — attach credentials so authWebSocket skips LOGIN.
                    // Also set req.auth so the @User decorator in wrapMiddleware resolves correctly.
                    if (authResult.user) {
                        req.user = authResult.user;
                        req.auth = authResult;
                        req.authPayload = authResult.authPayload;
                        req.authToken = authResult.authToken;
                    }
                }

                uwsRes.upgrade({ req }, secWebSocketKey, secWebSocketProtocol, secWebSocketExtensions, context);
            },

            open: async (ws) => {
                // Retrieve the request captured during upgrade and attach the shim
                const userData = ws.getUserData() as { req: UWSRequest; shim: UWSWebSocketShim };
                const shim = new UWSWebSocketShim(ws);
                userData.shim = shim;

                const req = userData.req as RequestWS;
                req.websocket = shim;
                req.wsHandled = false;

                // Create a stub response (WebSocket responses don't use HTTP res). A middleware that
                // rejects (e.g. checkRequiredRoles/checkElevation/checkRequiredPerms) with no downstream
                // handler to translate that into a close has nowhere else to signal it — mirror the
                // convention route handlers use themselves: close with 1002 and the error's short code.
                const stubRes: HttpResponse = makeWsStubResponse((status, payload) => {
                    req.wsHandled = true;
                    shim.close(1002, payload?.code || payload?.message || "Internal Server Error");
                });

                await runChain(handlers, req, stubRes);

                // If no handler marked wsHandled, close the connection.
                // Guard against the client disconnecting while runChain was awaiting
                // (e.g. authWebSocket waiting for a LOGIN frame): the uWS handle is
                // invalid once the close callback fires, so calling ws.end() would
                // throw "Invalid access of closed uWS.WebSocket" as an unhandled
                // rejection from this async open handler.
                //
                // Uses `ws.end()`, not `ws.close()` — uWS's `close()` is an abrupt disconnect with no
                // close handshake (surfaces to clients as a connection reset), while `end()` performs a
                // proper WebSocket close. `shim.close()` already calls `end()` internally; called directly
                // here (rather than through the shim) since no code/reason applies to this bare fallback.
                if (!req.wsHandled && shim.readyState !== 3) {
                    try {
                        ws.end();
                    } catch {
                        // Client already disconnected — nothing to do
                    }
                }
            },

            message: (ws, message, isBinary) => {
                const userData = ws.getUserData() as { shim?: UWSWebSocketShim };
                // Forward message events to the per-socket EventEmitter shim. uWS neuters `message` once this callback
                // returns, and `Buffer.from(arrayBuffer)` is only a view over it, so a binary message must be copied
                // (`slice(0)`) or a listener that keeps the Buffer would later read freed memory. The text path
                // decodes into a new string right away, so it needs no copy.
                userData.shim?.emit(
                    "message",
                    isBinary ? Buffer.from(message.slice(0)) : Buffer.from(message).toString(),
                    isBinary,
                );
            },

            close: (ws, code, message) => {
                const userData = ws.getUserData() as { shim?: UWSWebSocketShim };
                userData.shim?.readyState !== undefined && (userData.shim.readyState = 3); // CLOSED
                userData.shim?.emit("close", code, Buffer.from(message).toString());
            },
        };

        this.uwsApp.ws(routePath, behavior);
        // Also register with trailing slash to match Express behavior
        if (!routePath.endsWith("/")) {
            this.uwsApp.ws(routePath + "/", behavior);
        }

        return this;
    }

    /**
     * Starts listening on the given host and port.
     * Resolves when the server is ready; rejects if the port cannot be bound.
     */
    public listen(host: string, port: number): Promise<void> {
        // Register a catch-all OPTIONS handler so CORS global middleware runs for all preflight requests.
        // This must happen before the uWS listen call so it is ready when the first request arrives.
        // preLength=0 places all globalMiddleware as "post-route" so they all execute sequentially;
        // the CORS middleware terminates the chain early for OPTIONS (sends 204 without calling next).
        this.uwsApp.options("/*", this.makeHandler([], 0, undefined));

        // Register a JSON 404 fallback for any request that doesn't match a registered route, so
        // clients get the framework's normal ApiError response shape instead of uWS's built-in HTML
        // "File Not Found" page. Routed through `next()` so it flows through the same error-handling
        // and metrics middleware as any other error. uWS matches by specificity, not registration
        // order, so this never shadows a real route — except an app-defined literal `/*` route (e.g. a
        // `BaseStaticRoute` mounted at the site root), which is deliberately left alone via
        // `rootWildcardVerbs`.
        const notFoundHandler: RequestHandler = (_req, _res, next: NextFunction) => {
            next(new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND));
        };
        const uwsVerbs = { get: "get", post: "post", put: "put", delete: "del", patch: "patch", head: "head" } as const;
        for (const verb of ["get", "post", "put", "delete", "patch", "head"] as const) {
            if (!this.rootWildcardVerbs.has(verb)) {
                // Registered directly rather than via this[verb]() so the fallback has no route pattern: every
                // unmatched path shares one "unmatched" identity instead of looking like an app-defined `/*` route.
                const pre = this.capturePreRouteCount();
                this.uwsApp[uwsVerbs[verb]]("/*", this.makeHandler([notFoundHandler], pre, undefined, verb === "head"));
            }
        }

        return new Promise((resolve, reject) => {
            this.uwsApp.listen(host, port, (socket) => {
                if (socket) {
                    this.listenSocket = socket;
                    this.listenPort = port;
                    resolve();
                } else {
                    reject(new Error(`Failed to listen on ${host}:${port}`));
                }
            });
        });
    }

    /** Closes the listen socket, stopping the server from accepting new connections. */
    public close(): void {
        if (this.listenSocket) {
            uWS.us_listen_socket_close(this.listenSocket);
            this.listenSocket = null;
        }
    }

    /** The number of HTTP requests currently being handled. */
    public get inFlightRequests(): number {
        return this.inFlight.count;
    }

    /**
     * Stops accepting new connections, waits up to `timeoutMs` for in-flight HTTP requests to finish, then closes
     * every remaining connection (keep-alive and WebSocket connections included).
     *
     * @param timeoutMs The maximum time to wait for in-flight requests, in milliseconds.
     */
    public async shutdown(timeoutMs: number = 10000): Promise<void> {
        this.close();
        const deadline: number = Date.now() + Math.max(0, timeoutMs);
        while (this.inFlight.count > 0 && Date.now() < deadline) {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        try {
            this.uwsApp.close();
        } catch {
            // Already closed
        }
    }

    // Allow dynamic method access: router["get"](path, ...handlers)
    // This enables RouteUtils to call app[verb](path, ...middleware) unchanged.
    [key: string]: any;
}
