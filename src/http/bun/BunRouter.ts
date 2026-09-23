///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
/// <reference types="bun" />
import {
    DEFAULT_WS_OPTIONS,
    type HttpRouteOptions,
    type IHttpRouter,
    type NextFunction,
    type RequestHandler,
    type WebSocketOptions,
} from "../types.js";
import type { RequestWS } from "../uWS/WebSocket.js";
import { DEFAULT_MAX_BODY_SIZE } from "../uWS/Adapters.js";
import { BunRequest, BunResponse, makeBunBodyStream, readBunBody } from "./BunAdapters.js";
import { BunWebSocketShim } from "./BunWebSocket.js";
import { makeWsStubResponse, runChain, splitRouteArgs, type WsUpgradeAuth } from "../MiddlewareChain.js";
import { ApiError } from "@rapidrest/core";
import { ApiErrorMessages, ApiErrors } from "../../ApiErrors.js";

/** Strips a single trailing slash from a pathname, except for the root `"/"` itself. */
function normalizePath(pathname: string): string {
    if (pathname.length > 1 && pathname.endsWith("/")) {
        return pathname.slice(0, -1);
    }
    return pathname;
}

/** Splits a normalized pathname into non-empty segments (e.g. `/users/:uid` -> `["users", ":uid"]`). */
function splitPath(pathname: string): string[] {
    return pathname.split("/").filter((s) => s.length > 0);
}

/**
 * Scores how well a route's segments match a request's segments: 2 points per exact static
 * segment match, 1 point per `:param` segment match, or `null` if the segment counts differ or a
 * static segment doesn't match. Higher scores are more specific (static beats `:param`).
 */
function matchSegments(routeSegments: string[], reqSegments: string[]): number | null {
    if (routeSegments.length !== reqSegments.length) return null;
    let score = 0;
    for (let i = 0; i < routeSegments.length; i++) {
        const seg = routeSegments[i];
        if (seg.startsWith(":")) {
            score += 1;
        } else if (seg === reqSegments[i]) {
            score += 2;
        } else {
            return null;
        }
    }
    return score;
}

/**
 * Extracts `:param` values from a matched request path given the route's segment pattern.
 * `reqSegments` comes from `URL.pathname`, which (like uWS's `getParameter()`) does not decode an
 * already-percent-encoded segment — a caller-encoded value (e.g. `encodeURIComponent()`-ing an
 * email-address-derived uid before building the URL, this library's own established convention)
 * would otherwise arrive here still percent-encoded and fail every downstream uid lookup. Decodes
 * each param value, falling back to the raw segment on malformed percent-encoding (e.g. a bare
 * "%"), matching `Adapters.ts`'s identical query-string fallback and the uWS router's own param
 * decoding — `:param` values stay identical across both adapters for the same request.
 */
function extractParams(routeSegments: string[], reqSegments: string[]): Record<string, string> {
    const params: Record<string, string> = {};
    for (let i = 0; i < routeSegments.length; i++) {
        const seg = routeSegments[i];
        if (seg.startsWith(":")) {
            const raw = reqSegments[i] ?? "";
            try {
                params[seg.slice(1)] = decodeURIComponent(raw);
            } catch {
                params[seg.slice(1)] = raw;
            }
        }
    }
    return params;
}

/** Maps the framework's `ssl` config block (file paths) to Bun's `tls` option (file contents). */
function mapSslConfigToBunTls(sslConfig: { key: string; cert: string; ca?: string; passphrase?: string }): any {
    return {
        key: Bun.file(sslConfig.key),
        cert: Bun.file(sslConfig.cert),
        ca: sslConfig.ca ? Bun.file(sslConfig.ca) : undefined,
        passphrase: sslConfig.passphrase,
    };
}

interface CompiledRoute {
    /**
     * Static/param segments. For a wildcard-suffixed route (`hasWildcardSuffix: true`), this is
     * the PREFIX only — the trailing `"*"` segment itself is stripped and is not represented here.
     */
    segments: string[];
    /**
     * True for any route whose path ends in `/*` (e.g. `/*` itself, or `/static/*`). Matches the
     * prefix followed by `/` and anything after — but NOT the bare prefix with no trailing slash —
     * mirroring uWS's own wildcard semantics (verified empirically against real uWS).
     */
    hasWildcardSuffix: boolean;
    /**
     * True only for the literal whole-path `/*` route. Used solely for `listen()`'s
     * `rootWildcardVerbs` bookkeeping (skip registering the JSON 404 fallback for a verb that
     * already has an app-defined root wildcard) — NOT used for match scoring/priority.
     */
    isRootWildcard: boolean;
    handlers: RequestHandler[];
    preLength: number;
    isHead: boolean;
    /** The registered route pattern, exposed as `req.routePattern`. `undefined` for the router's own fallbacks. */
    pattern?: string;
    /** When `true`, skip buffering the body and expose it as `req.bodyStream` instead — see `HttpRouteOptions`. */
    streamingBody?: boolean;
}

/** The WebSocket options a route resolved to (its own options over `DEFAULT_WS_OPTIONS`). */
type ResolvedWsOptions = typeof DEFAULT_WS_OPTIONS;

interface CompiledWsRoute {
    segments: string[];
    handlers: RequestHandler[];
    upgradeAuth?: WsUpgradeAuth;
    pattern: string;
    options: ResolvedWsOptions;
}

interface WsSocketData {
    req: RequestWS;
    handlers: RequestHandler[];
    shim?: BunWebSocketShim;
    /** The route's maximum incoming message size, in bytes. */
    maxPayloadLength?: number;
}

/** Returns the byte length of an incoming Bun WebSocket message. */
function messageByteLength(message: string | Buffer | ArrayBuffer): number {
    return typeof message === "string" ? Buffer.byteLength(message) : message.byteLength;
}

/**
 * Bun-native HTTP/WebSocket router built on `Bun.serve()`. Exposes the same public surface as the
 * uWS-backed `HttpRouter` (`use/get/post/put/delete/patch/head/options/ws/listen/close/isListening/
 * listenPort`) so `RouteUtils.registerRoute()` and `Server.ts` work against either implementation
 * unchanged.
 *
 * Unlike uWS, `Bun.serve()` has no built-in dynamic router, so this class maintains its own route
 * table matched inside a single `fetch()` callback, with static-segment > `:param` > `/*` wildcard
 * precedence — replicating uWS's specificity-based matching.
 */
export class BunRouter implements IHttpRouter {
    private readonly routesByMethod: Map<string, CompiledRoute[]> = new Map();
    private readonly wsRoutes: CompiledWsRoute[] = [];
    private readonly globalMiddleware: RequestHandler[] = [];
    private preRouteCount: number = -1;
    private readonly rootWildcardVerbs: Set<string> = new Set();
    /** Literal (non-`/*`) paths for which the application has registered its own `.options()` route -
     * see `HttpRouter`'s identical field/doc comment for the full rationale (consulted by `Server.ts`'s
     * global CORS middleware so a real app-defined `OPTIONS` handler gets a chance to run). */
    private readonly explicitOptionsPaths: Set<string> = new Set();
    private readonly maxBodySize: number;
    /** The HTTP requests currently being handled. */
    private inFlight: number = 0;
    private readonly sslConfig: any;
    private _bunServer: Bun.Server<any> | undefined;
    /** The port the server is currently listening on (set after a successful `listen()` call). */
    public listenPort: number = 0;

    constructor(maxBodySize: number = DEFAULT_MAX_BODY_SIZE, sslConfig?: any) {
        this.maxBodySize = maxBodySize;
        this.sslConfig = sslConfig;
    }

    /** Returns `true` if the server is currently listening. */
    public get isListening(): boolean {
        return this._bunServer !== undefined;
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

    private pushRoute(method: string, route: CompiledRoute): void {
        const list = this.routesByMethod.get(method) ?? [];
        list.push(route);
        this.routesByMethod.set(method, list);
    }

    private register(
        method: string,
        routePath: string,
        handlers: RequestHandler[],
        isHead: boolean = false,
        // `null` (not `undefined`, which would select this default) marks the router's own fallback routes.
        pattern: string | null = routePath,
        streamingBody?: boolean,
    ): this {
        const pre = this.capturePreRouteCount();
        const normalized = normalizePath(routePath);
        const isRootWildcard = normalized === "/*";
        if (isRootWildcard) this.rootWildcardVerbs.add(method.toLowerCase());
        const hasWildcardSuffix = isRootWildcard || normalized.endsWith("/*");
        // Strip the trailing "/*" (2 chars) to get the prefix; "/*" itself strips to "" -> segments [].
        const segments = hasWildcardSuffix ? splitPath(normalized.slice(0, -2)) : splitPath(normalized);
        this.pushRoute(method, {
            segments,
            hasWildcardSuffix,
            isRootWildcard,
            handlers,
            preLength: pre,
            isHead,
            pattern: pattern ?? undefined,
            streamingBody,
        });
        return this;
    }

    // -------------------------------------------------------------------------
    // HTTP verb methods
    // -------------------------------------------------------------------------

    public get(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        return this.register("GET", routePath, handlers, false, routePath, options.streamingBody);
    }

    public post(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        return this.register("POST", routePath, handlers, false, routePath, options.streamingBody);
    }

    public put(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        return this.register("PUT", routePath, handlers, false, routePath, options.streamingBody);
    }

    public delete(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        return this.register("DELETE", routePath, handlers, false, routePath, options.streamingBody);
    }

    public patch(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        return this.register("PATCH", routePath, handlers, false, routePath, options.streamingBody);
    }

    public head(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        return this.register("HEAD", routePath, handlers, true, routePath, options.streamingBody);
    }

    public options(routePath: string, ...handlersOrOptions: Array<RequestHandler | HttpRouteOptions>): this {
        const normalized = normalizePath(routePath);
        // The framework's own `listen()` fallback pushes its "/*" OPTIONS route directly via
        // `pushRoute()`, bypassing this method entirely - so it's never tracked as "explicit" here,
        // and always keeps deferring to the CORS middleware's blanket 204.
        if (normalized !== "/*") this.explicitOptionsPaths.add(normalized);
        const { options, handlers } = splitRouteArgs(handlersOrOptions);
        return this.register("OPTIONS", routePath, handlers, false, routePath, options.streamingBody);
    }

    /** Returns `true` if the application has registered its own literal `OPTIONS` route at `path`
     * (not the framework's own `/*` CORS-preflight fallback) - see `HttpRouter`'s identical method
     * doc comment for the full rationale. `path` is normalized the same way registered routes are, so
     * a trailing-slash mismatch between the two doesn't cause a false miss. */
    public hasExplicitOptionsRoute(path: string): boolean {
        return this.explicitOptionsPaths.has(normalizePath(path));
    }

    /**
     * Registers a WebSocket route. Handlers follow the same `(req, res, next)` pattern as HTTP
     * routes; they receive `req.websocket` containing the Bun WebSocket shim.
     *
     * `upgradeAuth` is an optional pre-upgrade auth function, run synchronously inside `fetch()`
     * before the handshake. If it returns `{ reject: true }`, an HTTP 401 is sent and the upgrade
     * is aborted. If it returns `{ user, ... }`, those credentials are attached to the request so
     * downstream middleware sees an authenticated user. If it returns `{}`, auth falls through to
     * the post-upgrade message-based LOGIN flow.
     *
     * `wsOptions` uses the uWS option names (`maxPayloadLength`, `idleTimeout`, `maxBackpressure`) over
     * `DEFAULT_WS_OPTIONS`. `Bun.serve()` only accepts one WebSocket configuration for the whole server, so
     * `maxPayloadLength` is additionally enforced per route (a larger message closes the socket with 1009), while
     * `idleTimeout` and `maxBackpressure` are applied server-wide using the largest value any route registered.
     */
    public ws(
        routePath: string,
        handlers: RequestHandler[],
        wsOptions?: WebSocketOptions,
        upgradeAuth?: WsUpgradeAuth,
    ): this {
        const normalized = normalizePath(routePath);
        const options: ResolvedWsOptions = {
            maxPayloadLength: wsOptions?.maxPayloadLength ?? DEFAULT_WS_OPTIONS.maxPayloadLength,
            idleTimeout: wsOptions?.idleTimeout ?? DEFAULT_WS_OPTIONS.idleTimeout,
            maxBackpressure: wsOptions?.maxBackpressure ?? DEFAULT_WS_OPTIONS.maxBackpressure,
        };
        this.wsRoutes.push({ segments: splitPath(normalized), handlers, upgradeAuth, pattern: routePath, options });
        return this;
    }

    /**
     * Builds the server-wide `Bun.serve()` WebSocket limits from every registered WebSocket route: the largest value
     * of each option, or `DEFAULT_WS_OPTIONS` when no route is registered.
     */
    private buildWebSocketLimits(): { maxPayloadLength: number; idleTimeout: number; backpressureLimit: number } {
        const all: ResolvedWsOptions[] =
            this.wsRoutes.length > 0 ? this.wsRoutes.map((r) => r.options) : [DEFAULT_WS_OPTIONS];
        // Bun treats an idleTimeout of 0 as "disabled", same as uWS, so a route that disabled it wins.
        const idleTimeout: number = all.some((o) => o.idleTimeout === 0)
            ? 0
            : Math.max(...all.map((o) => o.idleTimeout));
        return {
            maxPayloadLength: Math.max(...all.map((o) => o.maxPayloadLength)),
            idleTimeout,
            backpressureLimit: Math.max(...all.map((o) => o.maxBackpressure)),
        };
    }

    // -------------------------------------------------------------------------
    // Route matching
    // -------------------------------------------------------------------------

    /**
     * Matches a request against the route table. Exact-length static/param routes always outrank
     * wildcard-suffixed routes, matching uWS's `best ?? wildcard` fallback behavior. Among wildcard
     * candidates, the one with the longest (most specific) matching prefix wins — e.g. `/static/*`
     * beats a bare `/*` for requests under `/static`.
     *
     * `reqHasTrailingSlash` is required to replicate uWS's own wildcard boundary rule, verified
     * empirically against real uWS: a `<prefix>/*` route matches `<prefix>/` and anything nested
     * under it, but NOT the bare `<prefix>` with no trailing slash — a distinction that's lost if
     * matching were done on segment arrays alone, since `/static` and `/static/` produce the same
     * segment list once empty segments are filtered out.
     */
    private matchRoute(method: string, reqSegments: string[], reqHasTrailingSlash: boolean): CompiledRoute | null {
        const candidates = this.routesByMethod.get(method);
        if (!candidates) return null;

        let best: CompiledRoute | null = null;
        let bestScore = -1;
        let bestWildcard: CompiledRoute | null = null;
        let bestWildcardSpecificity = -1;

        for (const route of candidates) {
            if (route.hasWildcardSuffix) {
                const prefixLen = route.segments.length;
                const hasContentAfterPrefix =
                    reqSegments.length > prefixLen || (reqSegments.length === prefixLen && reqHasTrailingSlash);
                if (!hasContentAfterPrefix) continue;
                const score = matchSegments(route.segments, reqSegments.slice(0, prefixLen));
                if (score === null) continue;
                if (prefixLen > bestWildcardSpecificity) {
                    bestWildcardSpecificity = prefixLen;
                    bestWildcard = route;
                }
                continue;
            }
            const score = matchSegments(route.segments, reqSegments);
            if (score !== null && score > bestScore) {
                bestScore = score;
                best = route;
            }
        }

        return best ?? bestWildcard;
    }

    private matchWsRoute(reqSegments: string[]): CompiledWsRoute | null {
        let best: CompiledWsRoute | null = null;
        let bestScore = -1;
        for (const route of this.wsRoutes) {
            const score = matchSegments(route.segments, reqSegments);
            if (score !== null && score > bestScore) {
                bestScore = score;
                best = route;
            }
        }
        return best;
    }

    // -------------------------------------------------------------------------
    // Request dispatch
    // -------------------------------------------------------------------------

    private readonly fetchHandler = async (rawReq: Request, server: Bun.Server<any>): Promise<Response | undefined> => {
        const url = new URL(rawReq.url);
        // Deliberately no `length > 1` guard here (unlike normalizePath's trailing-slash strip): the bare root
        // path "/" IS a trailing slash relative to an empty wildcard prefix (a `/*` route registered at the
        // app root), so it must count as one or that route's wildcard boundary check would never match "/".
        const reqHasTrailingSlash = url.pathname.endsWith("/");
        const normalizedPath = normalizePath(url.pathname);
        const reqSegments = splitPath(normalizedPath);

        if (rawReq.headers.get("upgrade")?.toLowerCase() === "websocket") {
            const wsMatch = this.matchWsRoute(reqSegments);
            if (wsMatch) {
                const req = new BunRequest(rawReq, server) as RequestWS;
                req.params = extractParams(wsMatch.segments, reqSegments);
                req.routePattern = wsMatch.pattern;

                if (wsMatch.upgradeAuth) {
                    const authResult = wsMatch.upgradeAuth(req);
                    if (authResult.reject) {
                        return new Response(JSON.stringify({ status: 401, message: "Unauthorized" }), {
                            status: 401,
                            headers: { "content-type": "application/json" },
                        });
                    }
                    if (authResult.user) {
                        req.user = authResult.user;
                        req.auth = authResult;
                        req.authPayload = authResult.authPayload;
                        req.authToken = authResult.authToken;
                    }
                }

                const socketData: WsSocketData = {
                    req,
                    handlers: wsMatch.handlers,
                    maxPayloadLength: wsMatch.options.maxPayloadLength,
                };
                const upgraded = server.upgrade(rawReq, { data: socketData } as any);
                if (upgraded) return undefined;
                return new Response("WebSocket upgrade failed", { status: 400 });
            }
            // No matching ws route — fall through to normal HTTP handling (ends in 404 below).
        }

        const method = rawReq.method.toUpperCase();
        const route = this.matchRoute(method, reqSegments, reqHasTrailingSlash);
        if (!route) {
            return new Response(
                JSON.stringify({ code: ApiErrors.NOT_FOUND, status: 404, message: ApiErrorMessages.NOT_FOUND }),
                { status: 404, headers: { "content-type": "application/json" } },
            );
        }

        const req = new BunRequest(rawReq, server);
        req.routePattern = route.pattern;
        // For wildcard-suffixed routes, `route.segments` is only the prefix — slice reqSegments to
        // match so extractParams doesn't walk past it. For exact-length routes this is a no-op
        // (route.segments.length === reqSegments.length is guaranteed by matchSegments).
        req.params = extractParams(route.segments, reqSegments.slice(0, route.segments.length));
        const res = new BunResponse(rawReq);
        res.isHead = route.isHead;

        this.inFlight++;
        if (route.streamingBody) {
            // Opted out of buffering (see HttpRouteOptions.streamingBody / @StreamingBody()) — expose
            // the already-streaming Bun request body directly instead. No maxBodySize check applies
            // here, matching the uWS router's identical streaming branch: buffering (and therefore
            // capping) the body up front is exactly what a streaming route opted out of.
            req.bodyStream = makeBunBodyStream(rawReq);
        } else {
            let bodyResult: Awaited<ReturnType<typeof readBunBody>>;
            try {
                bodyResult = await readBunBody(req, rawReq, this.maxBodySize);
            } catch (err) {
                this.inFlight--;
                throw err;
            }
            if (!bodyResult.ok) {
                this.inFlight--;
                return bodyResult.response;
            }
        }

        const allHandlers = [
            ...this.globalMiddleware.slice(0, route.preLength),
            ...route.handlers,
            ...this.globalMiddleware.slice(route.preLength),
        ];

        runChain(allHandlers, req, res)
            .then(() => {
                if (!res.writableEnded) res.status(204).end();
            })
            .catch((err) => {
                res.abortStream(err);
            })
            .finally(() => {
                this.inFlight--;
            });

        return res.responseReady;
    };

    private readonly websocketConfig: any = {
        open: async (ws: any) => {
            const data = ws.data as WsSocketData;
            const shim = new BunWebSocketShim(ws);
            data.shim = shim;

            const req = data.req;
            req.websocket = shim;
            req.wsHandled = false;

            // A middleware that rejects (e.g. checkRequiredRoles/checkElevation/checkRequiredPerms) with
            // no downstream handler to translate that into a close has nowhere else to signal it — mirror
            // the convention route handlers use themselves: close with 1002 and the error's short code.
            const stubRes = makeWsStubResponse((status, payload) => {
                req.wsHandled = true;
                shim.close(1002, payload?.code || payload?.message || "Internal Server Error");
            });
            await runChain(data.handlers, req, stubRes);

            // Guard against the client disconnecting while runChain was awaiting (e.g. authWebSocket
            // waiting for a LOGIN frame) — mirrors the uWS router's readyState !== 3 / try-catch guard.
            if (!req.wsHandled && shim.readyState !== 3) {
                try {
                    ws.close();
                } catch {
                    // Client already disconnected — nothing to do
                }
            }
        },

        message: (ws: any, message: string | Buffer | ArrayBuffer) => {
            const data = ws.data as WsSocketData;
            // Bun's own limit is server-wide (the largest of all routes), so enforce this route's own limit here,
            // closing the socket like uWS does for an oversized message.
            if (data.maxPayloadLength !== undefined && messageByteLength(message) > data.maxPayloadLength) {
                try {
                    ws.close(1009, "Message too big");
                } catch {
                    // Already closed
                }
                return;
            }
            const isBinary = typeof message !== "string";
            data.shim?.emit("message", isBinary ? Buffer.from(message as any) : message, isBinary);
        },

        close: (ws: any, code: number, reason: string) => {
            const data = ws.data as WsSocketData;
            if (data.shim) data.shim.readyState = 3; // CLOSED
            data.shim?.emit("close", code, reason);
        },
    };

    /**
     * Starts listening on the given host and port.
     * Resolves when the server is ready; rejects if the port cannot be bound.
     */
    public listen(host: string, port: number): Promise<void> {
        // Register a catch-all OPTIONS handler so CORS global middleware runs for all preflight
        // requests. preLength=0 places all globalMiddleware as "post-route" so it all executes
        // sequentially; the CORS middleware terminates the chain early for OPTIONS (sends 204
        // without calling next). Mirrors Router.ts::listen()'s uWS behavior exactly.
        this.pushRoute("OPTIONS", {
            segments: [],
            hasWildcardSuffix: true,
            isRootWildcard: true,
            handlers: [],
            preLength: 0,
            isHead: false,
            pattern: undefined,
        });

        // Register a JSON 404 fallback for any request that doesn't match a registered route,
        // respecting an app-defined literal `/*` route (e.g. a `BaseStaticRoute` mounted at the site
        // root) via `rootWildcardVerbs`, exactly as the uWS router does.
        const notFoundHandler: RequestHandler = (_req, _res, next: NextFunction) => {
            next(new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND));
        };
        const verbs: Array<"get" | "post" | "put" | "delete" | "patch" | "head"> = [
            "get",
            "post",
            "put",
            "delete",
            "patch",
            "head",
        ];
        for (const verb of verbs) {
            if (!this.rootWildcardVerbs.has(verb)) {
                // No route pattern: every unmatched path shares one "unmatched" identity instead of looking like an
                // app-defined `/*` route.
                this.register(verb.toUpperCase(), "/*", [notFoundHandler], verb === "head", null);
            }
        }

        const tls = this.sslConfig ? mapSslConfigToBunTls(this.sslConfig) : undefined;

        return new Promise((resolve, reject) => {
            try {
                this._bunServer = Bun.serve({
                    hostname: host,
                    port,
                    fetch: this.fetchHandler,
                    websocket: { ...this.websocketConfig, ...this.buildWebSocketLimits() },
                    tls,
                } as any);
                this.listenPort = this._bunServer.port ?? port;
                resolve();
            } catch (err) {
                reject(err instanceof Error ? err : new Error(`Failed to listen on ${host}:${port}`));
            }
        });
    }

    /** Stops the server, closing the listen socket. */
    public close(): void {
        if (this._bunServer) {
            void this._bunServer.stop();
            this._bunServer = undefined;
        }
    }

    /** The number of HTTP requests currently being handled. */
    public get inFlightRequests(): number {
        return this.inFlight;
    }

    /**
     * Stops accepting new connections, waits up to `timeoutMs` for in-flight HTTP requests to finish, then closes
     * every remaining connection (keep-alive and WebSocket connections included).
     *
     * @param timeoutMs The maximum time to wait for in-flight requests, in milliseconds.
     */
    public async shutdown(timeoutMs: number = 10000): Promise<void> {
        const server: Bun.Server<any> | undefined = this._bunServer;
        if (!server) {
            return;
        }
        this._bunServer = undefined;

        // stop(false) stops accepting new connections but lets existing ones finish.
        void Promise.resolve(server.stop(false)).catch(() => undefined);
        const deadline: number = Date.now() + Math.max(0, timeoutMs);
        while (this.inFlight > 0 && Date.now() < deadline) {
            await new Promise<void>((resolve) => setTimeout(resolve, 10));
        }
        try {
            await server.stop(true);
        } catch {
            // Already stopped
        }
    }

    // Allow dynamic method access: router["get"](path, ...handlers)
    // This enables RouteUtils to call app[verb](path, ...middleware) unchanged.
    [key: string]: any;
}
