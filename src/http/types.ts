///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { JWTUser } from "@rapidrest/core";

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
    cookies: Record<string, string>;
    signedCookies: Record<string, string>;
    /**
     * Populated by the optional session middleware (see SessionManager). Undefined when no
     * session middleware is registered (i.e. the `session` config block is absent).
     */
    session?: Record<string, any>;
    /** Minimal socket interface; populated with remote address for IP extraction. */
    socket: { remoteAddress?: string };
    /** Set by JWT auth middleware after successful token verification. */
    user?: JWTUser;
    /** Full decoded JWT payload, set by JWT auth middleware. */
    authPayload?: any;
    /** Raw JWT token string, set by JWT auth middleware. */
    authToken?: string;
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
 * Public surface shared by every HTTP router implementation (uWS-backed, Bun-backed, ...).
 * `Server.ts` depends only on this interface, never on a concrete router class, so the
 * underlying HTTP server can be swapped per-runtime without touching route registration.
 */
export interface IHttpRouter {
    use(...handlers: RequestHandler[]): this;
    get(path: string, ...handlers: RequestHandler[]): this;
    post(path: string, ...handlers: RequestHandler[]): this;
    put(path: string, ...handlers: RequestHandler[]): this;
    delete(path: string, ...handlers: RequestHandler[]): this;
    patch(path: string, ...handlers: RequestHandler[]): this;
    head(path: string, ...handlers: RequestHandler[]): this;
    options(path: string, ...handlers: RequestHandler[]): this;
    ws(path: string, handlers: RequestHandler[], wsOptions?: any, upgradeAuth?: any): this;
    listen(host: string, port: number): Promise<void>;
    close(): void;
    readonly isListening: boolean;
    listenPort: number;
    [key: string]: any;
}
