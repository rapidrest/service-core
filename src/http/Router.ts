///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import uWS from "uWebSockets.js";
import * as fs from "fs";
import * as path from "path";
import { UWSRequest, UWSResponse, readBody } from "./Adapters.js";
import type { HttpRequest, HttpResponse, RequestHandler } from "./types.js";
import { UWSWebSocketShim, type RequestWS } from "./WebSocket.js";

/** MIME types for static file serving. */
const MIME_TYPES: Record<string, string> = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
    ".txt": "text/plain",
    ".map": "application/json",
};

/**
 * Runs an ordered array of middleware handlers sequentially, Express-style.
 * Supports both 3-param `(req, res, next)` handlers and 4-param `(err, req, res, next)`
 * error handlers. On error, execution skips to the next error handler.
 *
 * Each handler is awaited via a Promise that resolves when next() is called, not when
 * the handler's return value resolves. This correctly handles: (1) sync handlers that
 * call next() synchronously, (2) async handlers that return next() or await before
 * calling it, and (3) sync handlers that schedule next() via callbacks such as
 * setTimeout or socket.once. The chain terminates early when a handler ends the
 * response without calling next().
 */
export async function runChain(
    handlers: RequestHandler[],
    req: HttpRequest,
    res: HttpResponse
): Promise<void> {
    let currentError: any = undefined;

    for (let i = 0; i < handlers.length; i++) {
        const handler = handlers[i];
        const isErrorHandler = handler.length === 4;

        if (currentError && !isErrorHandler) continue;
        if (!currentError && isErrorHandler) continue;

        const outcome = await new Promise<{ called: boolean; err?: any }>((resolve) => {
            let settled = false;

            const next = (err?: any): any => {
                if (!settled) {
                    settled = true;
                    resolve({ called: true, err });
                }
            };

            try {
                const handlerResult = isErrorHandler
                    ? (handler as any)(currentError, req, res, next)
                    : handler(req, res, next);

                if (handlerResult instanceof Promise) {
                    // Async handler: wait for the Promise, but next() may have already been
                    // called (or may be called later inside the Promise chain).
                    handlerResult
                        .then(() => {
                            if (!settled) {
                                settled = true;
                                resolve({ called: false });
                            }
                        })
                        .catch((err: any) => {
                            if (!settled) {
                                settled = true;
                                resolve({ called: true, err });
                            }
                        });
                } else {
                    // Sync handler returned. Three sub-cases:
                    //   a. next() was already called synchronously → already settled.
                    //   b. Response was sent without next() → stop chain.
                    //   c. Handler will call next() from an async callback (e.g. setTimeout)
                    //      → leave the Promise pending; it resolves when next() fires.
                    if (!settled && res.writableEnded) {
                        settled = true;
                        resolve({ called: false });
                    }
                    // else: wait for next() to be called asynchronously
                }
            } catch (err: any) {
                if (!settled) {
                    settled = true;
                    resolve({ called: true, err });
                }
            }
        });

        if (!outcome.called) break; // handler terminated chain (sent response)

        if (outcome.err !== undefined) {
            currentError = outcome.err;
        } else if (isErrorHandler) {
            currentError = undefined; // error was handled
        }
    }

    // End of chain with unhandled error
    if (currentError && !res.writableEnded) {
        res.status(500).json({
            message: currentError?.message || "Internal Server Error",
            status: 500,
        });
    }
}

/** Result returned by a pre-upgrade WebSocket auth function. */
export type WsUpgradeAuthResult = {
    user?: any;
    authPayload?: any;
    authToken?: string;
    /** Set to `true` to reject the connection with HTTP 401 before the WebSocket handshake. */
    reject?: boolean;
};

/**
 * Optional pre-upgrade auth function for WebSocket routes. Called synchronously inside the uWS
 * `upgrade` callback — before the WebSocket handshake completes. Returning `{ reject: true }`
 * sends an HTTP 401 and skips the upgrade entirely. Returning `{}` falls through to the
 * post-upgrade message-based LOGIN flow. Returning `{ user, ... }` pre-authenticates the
 * connection so clients that can send an Authorization header skip the LOGIN step.
 */
export type WsUpgradeAuth = (req: HttpRequest) => WsUpgradeAuthResult;

/** Parses `:param` names out of a uWS route pattern (e.g. `/users/:uid/:version` → `["uid","version"]`). */
function extractParamNames(routePath: string): string[] {
    const names: string[] = [];
    for (const segment of routePath.split("/")) {
        if (segment.startsWith(":")) names.push(segment.slice(1));
    }
    return names;
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
    preLength: number,
    paramNames: string[],
    isHead: boolean = false
) {
    return async (uwsRes: uWS.HttpResponse, uwsReq: uWS.HttpRequest) => {
        // Capture remote address before any async work
        const remoteAddress = Buffer.from(uwsRes.getRemoteAddressAsText()).toString();

        // Build adapters — all uWS HttpRequest reads happen here synchronously
        const req = new UWSRequest(uwsReq, remoteAddress);
        const res = new UWSResponse(uwsRes);
        res.isHead = isHead;

        // Capture path params synchronously (uwsReq is stack-allocated, only valid before first await)
        for (let i = 0; i < paramNames.length; i++) {
            req.params[paramNames[i]] = uwsReq.getParameter(i) || "";
        }

        // Body must be read before any middleware runs
        try {
            await readBody(uwsRes, req);
        } catch {
            // Non-fatal: body may not exist for GET/HEAD/OPTIONS
        }

        // Split global middleware: pre-route (registered before this route) and post-route (registered after)
        const preMiddleware = globalMiddleware.slice(0, preLength);
        const postMiddleware = globalMiddleware.slice(preLength);
        const allHandlers = [...preMiddleware, ...routeHandlers, ...postMiddleware];
        await runChain(allHandlers, req, res);

        // If no handler sent a response, end with 204
        if (!res.writableEnded && !res["_aborted"]) {
            res.status(204).end();
        }
    };
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
 * - `static(basePath)` — basic static file serving
 * - `listen(host, port)` / `close()` — server lifecycle
 */
export class HttpRouter {
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

    constructor(uwsApp: uWS.TemplatedApp) {
        this.uwsApp = uwsApp;
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

    // -------------------------------------------------------------------------
    // HTTP verb methods — each registers a uWS route
    // -------------------------------------------------------------------------

    public get(routePath: string, ...handlers: RequestHandler[]): this {
        const pre = this.capturePreRouteCount();
        this.uwsApp.get(routePath, makeUWSHandler(this.globalMiddleware, handlers, pre, extractParamNames(routePath)));
        return this;
    }

    public post(routePath: string, ...handlers: RequestHandler[]): this {
        const pre = this.capturePreRouteCount();
        this.uwsApp.post(routePath, makeUWSHandler(this.globalMiddleware, handlers, pre, extractParamNames(routePath)));
        return this;
    }

    public put(routePath: string, ...handlers: RequestHandler[]): this {
        const pre = this.capturePreRouteCount();
        this.uwsApp.put(routePath, makeUWSHandler(this.globalMiddleware, handlers, pre, extractParamNames(routePath)));
        return this;
    }

    public delete(routePath: string, ...handlers: RequestHandler[]): this {
        const pre = this.capturePreRouteCount();
        this.uwsApp.del(routePath, makeUWSHandler(this.globalMiddleware, handlers, pre, extractParamNames(routePath)));
        return this;
    }

    public patch(routePath: string, ...handlers: RequestHandler[]): this {
        const pre = this.capturePreRouteCount();
        this.uwsApp.patch(routePath, makeUWSHandler(this.globalMiddleware, handlers, pre, extractParamNames(routePath)));
        return this;
    }

    public head(routePath: string, ...handlers: RequestHandler[]): this {
        const pre = this.capturePreRouteCount();
        // uWS explicitly-registered HEAD routes do send body bytes — suppress them via isHead flag
        this.uwsApp.head(routePath, makeUWSHandler(this.globalMiddleware, handlers, pre, extractParamNames(routePath), true));
        return this;
    }

    public options(routePath: string, ...handlers: RequestHandler[]): this {
        const pre = this.capturePreRouteCount();
        this.uwsApp.options(routePath, makeUWSHandler(this.globalMiddleware, handlers, pre, extractParamNames(routePath)));
        return this;
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
    public ws(routePath: string, handlers: RequestHandler[], wsOptions?: Partial<uWS.WebSocketBehavior<any>>, upgradeAuth?: WsUpgradeAuth): this {
        const behavior: uWS.WebSocketBehavior<any> = {
            ...wsOptions,

            upgrade: (uwsRes, uwsReq, context) => {
                // Capture all request data synchronously — uWS HttpRequest is stack-allocated
                const remoteAddress = Buffer.from(uwsRes.getRemoteAddressAsText()).toString();
                const req = new UWSRequest(uwsReq, remoteAddress);
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

                uwsRes.upgrade(
                    { req },
                    secWebSocketKey,
                    secWebSocketProtocol,
                    secWebSocketExtensions,
                    context
                );
            },

            open: async (ws) => {
                // Retrieve the request captured during upgrade and attach the shim
                const userData = ws.getUserData() as { req: UWSRequest; shim: UWSWebSocketShim };
                const shim = new UWSWebSocketShim(ws);
                userData.shim = shim;

                const req = userData.req as RequestWS;
                req.websocket = shim;
                req.wsHandled = false;

                // Create a stub response (WebSocket responses don't use HTTP res)
                const stubRes: HttpResponse = {
                    statusCode: 101,
                    headersSent: true,
                    writableEnded: false,
                    status() { return this; },
                    setHeader() { return this; },
                    getHeader() { return undefined; },
                    json() { return; },
                    send() { return; },
                    end() { this.writableEnded = true; },
                };

                await runChain(handlers, req, stubRes);

                // If no handler marked wsHandled, close the connection.
                // Guard against the client disconnecting while runChain was awaiting
                // (e.g. authWebSocket waiting for a LOGIN frame): the uWS handle is
                // invalid once the close callback fires, so calling ws.close() would
                // throw "Invalid access of closed uWS.WebSocket" as an unhandled
                // rejection from this async open handler.
                if (!req.wsHandled && shim.readyState !== 3) {
                    try {
                        ws.close();
                    } catch {
                        // Client already disconnected — nothing to do
                    }
                }
            },

            message: (ws, message, isBinary) => {
                const userData = ws.getUserData() as { shim?: UWSWebSocketShim };
                // Forward message events to the per-socket EventEmitter shim
                userData.shim?.emit("message", isBinary ? Buffer.from(message) : Buffer.from(message).toString(), isBinary);
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
     * Serves static files from a directory via a wildcard GET route.
     * Files not found on disk return 404.
     */
    public static(basePath: string): this {
        this.uwsApp.get("/*", async (uwsRes, uwsReq) => {
            const remoteAddress = Buffer.from(uwsRes.getRemoteAddressAsText()).toString();
            const req = new UWSRequest(uwsReq, remoteAddress);
            const res = new UWSResponse(uwsRes);

            const safeBase = path.resolve(basePath);
            const requestedPath = req.path === "/" ? "index.html" : req.path.replace(/^\/+/, "");
            const filePath = path.resolve(safeBase, requestedPath);
            if (!filePath.startsWith(safeBase + path.sep) && filePath !== safeBase) {
                res.status(403).end();
                return;
            }
            const ext = path.extname(filePath);

            try {
                const data = await fs.promises.readFile(filePath);
                res.setHeader("content-type", MIME_TYPES[ext] || "application/octet-stream");
                res.end(data);
            } catch {
                res.status(404).end();
            }
        });
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
        this.uwsApp.options("/*", makeUWSHandler(this.globalMiddleware, [], 0, []));

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

    // Allow dynamic method access: router["get"](path, ...handlers)
    // This enables RouteUtils to call app[verb](path, ...middleware) unchanged.
    [key: string]: any;
}
