///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { JWTUser } from "@rapidrest/core";
import type { Readable } from "stream";

/**
 * Framework-agnostic HTTP request interface. Mirrors the Express `Request` surface used throughout
 * this codebase so that route handlers, middleware, and utilities require no changes when the
 * underlying HTTP server changes.
 */
export interface HttpRequest {
    method: string;
    path: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    params: Record<string, string>;
    query: Record<string, string | string[]>;
    body: any;
    rawBody?: Buffer;
    /**
     * The raw request body as a Node `Readable` stream, populated instead of `body`/`rawBody` for a
     * route registered with `{ streamingBody: true }` (see `HttpRouteOptions`) — e.g. via the
     * `@StreamingBody()` decorator. `undefined` for every ordinary route, where `body`/`rawBody` are
     * populated as before.
     *
     * The stream yields `Buffer` chunks and supports `for await (const chunk of req.bodyStream)` as
     * well as `.pipe()`. Backpressure is enforced end-to-end by both adapters — a slow consumer
     * throttles how fast bytes are read off the underlying connection rather than buffering
     * unbounded data in memory — which is the entire point of opting into streaming (e.g. a
     * multi-GB file upload). The stream is destroyed (with an error) if the client disconnects
     * mid-upload; a handler consuming it via `for await` sees that as a thrown error and should
     * clean up (e.g. delete a partially-written temp file) in a `catch`/`finally`.
     *
     * A streaming route does NOT get the framework's default `maxBodySize` enforcement — that check
     * only runs as part of the ordinary buffering path. The handler is responsible for enforcing
     * whatever size limit makes sense for the route itself.
     */
    bodyStream?: Readable;
    cookies: Record<string, string>;
    signedCookies: Record<string, string>;
    /**
     * Populated by the optional session middleware (see SessionManager). Undefined when no
     * session middleware is registered (i.e. the `session` config block is absent).
     */
    session?: Record<string, any>;
    /**
     * Set by the session middleware. `true` when `session` is not backed by a stored session yet (the request carried
     * no valid session cookie): nothing is stored and no cookie is sent unless a handler writes to `session`.
     * Bookkeeping-only writes (last access time, IP address, ...) should be skipped while this is `true`.
     */
    sessionIsNew?: boolean;
    /** Minimal socket interface; populated with remote address for IP extraction. */
    socket: { remoteAddress?: string };
    /** Set by JWT auth middleware after successful token verification. */
    user?: JWTUser;
    /** Full decoded JWT payload, set by JWT auth middleware. */
    authPayload?: any;
    /** Raw JWT token string, set by JWT auth middleware. */
    authToken?: string;
    /**
     * The registered route pattern that matched this request (e.g. `/items/:id`), set by the router before any
     * middleware runs. `undefined` when no application route matched, i.e. the request is handled by the router's
     * own not-found or CORS preflight fallback. Unlike `path`, the set of possible values is bounded by the
     * application's routes, so it is safe to use as a metrics label.
     */
    routePattern?: string;
    /** Allow arbitrary per-request properties (e.g. req.websocket, req.wsHandled). */
    [key: string]: any;
}

/**
 * Framework-agnostic HTTP response interface. Mirrors the Express `Response` surface used
 * throughout this codebase.
 */
export interface HttpResponse {
    statusCode: number;
    headersSent: boolean;
    writableEnded: boolean;
    /** Intermediate result passed between middleware via res.result. */
    result?: any;
    status(code: number): this;
    /** Sets a header, replacing any value(s) previously set for the same key. */
    setHeader(key: string, value: string | number | string[]): this;
    /**
     * Adds a value for a header without clobbering any value(s) already set for the same key —
     * the header is sent as multiple lines on the wire (e.g. multiple `Set-Cookie` headers).
     */
    appendHeader(key: string, value: string | number): this;
    getHeader(key: string): string | string[] | undefined;
    json(data: any): void;
    send(data?: any): void;
    end(data?: any): void;
    /**
     * Registers a callback fired exactly once when the response actually completes — either a
     * normal end() or client/stream abort. Does not delay or await end(). Used to persist
     * request-scoped state (e.g. session data) after downstream handlers finish mutating it.
     */
    onFinish(handler: () => void | Promise<void>): void;
    /** Allow arbitrary per-response properties. */
    [key: string]: any;
}

/** Standard Express-style next callback. Pass an error to trigger error handlers. */
export type NextFunction = (err?: any) => void;

/** Standard 3-param middleware function. */
export type RequestHandler = (req: HttpRequest, res: HttpResponse, next: NextFunction) => void | Promise<void>;

/** Standard 4-param error-handling middleware function. */
export type ErrorHandler = (err: any, req: HttpRequest, res: HttpResponse, next: NextFunction) => void | Promise<void>;

/**
 * Per-route registration options, optionally passed as the first element of a route's handler list
 * (e.g. `app.post(path, { streamingBody: true }, ...handlers)`). Detected at runtime by both router
 * implementations: a non-function first argument is treated as `HttpRouteOptions` rather than a
 * `RequestHandler`, so omitting it entirely (the overwhelmingly common case) is unaffected — every
 * existing call site that only ever passes handler functions keeps its exact current behavior.
 */
export interface HttpRouteOptions {
    /**
     * When `true`, the router does not buffer this route's request body into `req.body`/`req.rawBody`
     * before running its middleware/handler chain. Instead the raw body is exposed as a stream on
     * `req.bodyStream` (see its doc comment on `HttpRequest`), and the route's own handler is
     * responsible for consuming it and enforcing any size limit it needs — the framework's
     * `maxBodySize` 413 rejection does not apply to a streaming route. Set by the `@StreamingBody()`
     * route decorator; see `RouteUtils.registerRoute()`.
     */
    streamingBody?: boolean;
    [key: string]: any;
}

/**
 * Public surface shared by every HTTP router implementation (uWS-backed, Bun-backed, ...).
 * `Server.ts` depends only on this interface, never on a concrete router class, so the
 * underlying HTTP server can be swapped per-runtime without touching route registration.
 */
export interface IHttpRouter {
    use(...handlers: RequestHandler[]): this;
    get(path: string, ...handlers: Array<RequestHandler | HttpRouteOptions>): this;
    post(path: string, ...handlers: Array<RequestHandler | HttpRouteOptions>): this;
    put(path: string, ...handlers: Array<RequestHandler | HttpRouteOptions>): this;
    delete(path: string, ...handlers: Array<RequestHandler | HttpRouteOptions>): this;
    patch(path: string, ...handlers: Array<RequestHandler | HttpRouteOptions>): this;
    head(path: string, ...handlers: Array<RequestHandler | HttpRouteOptions>): this;
    options(path: string, ...handlers: Array<RequestHandler | HttpRouteOptions>): this;
    /** `true` if the application has registered its own literal `OPTIONS` route at `path` (as
     * opposed to the framework's own internal `/*` CORS-preflight fallback registered in `listen()`).
     * Consulted by `Server.ts`'s global CORS middleware so a real app-defined `OPTIONS` handler gets a
     * chance to run instead of the blanket preflight 204 - see `HttpRouter`/`BunRouter`'s identical
     * implementations for the full rationale. */
    hasExplicitOptionsRoute(path: string): boolean;
    ws(path: string, handlers: RequestHandler[], wsOptions?: any, upgradeAuth?: any): this;
    listen(host: string, port: number): Promise<void>;
    /** Stops accepting new connections. Connections that are already open (including keep-alive and WebSocket
     * connections) are left alone. */
    close(): void;
    /**
     * Gracefully shuts the server down: stops accepting new connections, waits up to `timeoutMs` milliseconds for
     * HTTP requests that are still being handled to finish, then force-closes every remaining connection
     * (keep-alive and WebSocket connections included). Optional, so custom routers without it keep working;
     * `Server.stop()` falls back to `close()` for those.
     */
    shutdown?(timeoutMs: number): Promise<void>;
    readonly isListening: boolean;
    listenPort: number;
    [key: string]: any;
}

/**
 * WebSocket options shared by every router implementation. Names follow uWebSockets.js' `WebSocketBehavior`.
 */
export interface WebSocketOptions {
    /** Maximum size of a single incoming message, in bytes. A larger message closes the connection. */
    maxPayloadLength?: number;
    /** Seconds without any received data after which the connection is closed. `0` disables the timeout. */
    idleTimeout?: number;
    /** Maximum number of bytes that may be queued for sending before further messages are dropped. */
    maxBackpressure?: number;
    [key: string]: any;
}

/**
 * The WebSocket defaults used by both the uWS and Bun routers when a route doesn't override them. These match
 * uWebSockets.js' own defaults, so a route behaves the same on both runtimes (Bun's own defaults are far larger,
 * e.g. a 16 MiB payload limit).
 */
export const DEFAULT_WS_OPTIONS: Readonly<
    Required<Pick<WebSocketOptions, "maxPayloadLength" | "idleTimeout" | "maxBackpressure">>
> = Object.freeze({
    maxPayloadLength: 16 * 1024,
    idleTimeout: 120,
    maxBackpressure: 64 * 1024,
});
