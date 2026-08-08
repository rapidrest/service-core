///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { HttpRequest, HttpResponse } from "../types.js";
import type { HttpRequest as UWSHttpRequest, HttpResponse as UWSHttpResponse } from "uWebSockets.js";
import { ApiErrorMessages, ApiErrors } from "../../ApiErrors.js";

/** Parses a `cookie` header string into a key/value map. */
export function parseCookies(cookieHeader: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!cookieHeader) return result;
    for (const part of cookieHeader.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 0) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        try {
            result[key] = decodeURIComponent(val);
        } catch {
            // Malformed percent-encoding (e.g. a bare "%") — fall back to the raw value rather than
            // letting the throw escape into the caller, which for the uWS request path happens before
            // any try/catch and would otherwise crash the process (no global unhandledRejection handler
            // is registered anywhere in this package).
            result[key] = val;
        }
    }
    return result;
}

/** Parses a URL query string (without leading `?`) into a key/value map. */
export function parseQueryString(qs: string): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    if (!qs) return result;
    for (const part of qs.split("&")) {
        const idx = part.indexOf("=");
        if (idx < 0) {
            let key: string;
            try { key = decodeURIComponent(part); } catch { key = part; }
            result[key] = "";
            continue;
        }
        let key: string;
        let val: string;
        try {
            key = decodeURIComponent(part.slice(0, idx));
            val = decodeURIComponent(part.slice(idx + 1));
        } catch {
            key = part.slice(0, idx);
            val = part.slice(idx + 1);
        }
        if (key in result) {
            const existing = result[key];
            result[key] = Array.isArray(existing) ? [...existing, val] : [existing, val];
        } else {
            result[key] = val;
        }
    }
    return result;
}

/**
 * Parses a raw request body Buffer according to its content-type header. Shared by both the
 * uWS-backed and Bun-backed HTTP adapters so body-parsing rules stay in one place:
 * `application/json` is parsed (falling back to the raw string on parse failure),
 * `application/x-www-form-urlencoded` is parsed into a plain object, and anything else is
 * returned as the raw Buffer. Returns `undefined` for an empty body.
 */
export function parseBodyByContentType(raw: Buffer, contentType: string): any {
    if (raw.length === 0) return undefined;
    const ct = contentType.toLowerCase();
    if (ct.includes("application/json")) {
        try {
            return JSON.parse(raw.toString("utf8"));
        } catch {
            return raw.toString("utf8");
        }
    } else if (ct.includes("application/x-www-form-urlencoded")) {
        return Object.fromEntries(new URLSearchParams(raw.toString("utf8")).entries());
    } else {
        return raw;
    }
}

/**
 * Adapts a uWS `HttpRequest` to the framework-agnostic `HttpRequest` interface.
 *
 * IMPORTANT: uWS HttpRequest is stack-allocated and only valid during the synchronous portion of
 * the handler. All request data MUST be captured in the constructor before any `await`.
 */
export class UWSRequest implements HttpRequest {
    public readonly method: string;
    public readonly url: string;
    public readonly path: string;
    public readonly headers: Record<string, string>;
    public params: Record<string, string> = {};
    public readonly query: Record<string, string | string[]>;
    public body: any = undefined;
    public rawBody?: Buffer;
    public readonly cookies: Record<string, string>;
    public readonly signedCookies: Record<string, string> = {};
    public readonly socket: { remoteAddress?: string };
    public user?: any;
    public authPayload?: any;
    public authToken?: string;
    /** Allow arbitrary per-request properties (websocket, wsHandled, etc.) */
    [key: string]: any;

    constructor(uwsReq: UWSHttpRequest, remoteAddress?: string) {
        // Capture all uWS request data synchronously — req becomes invalid after first await
        this.method = uwsReq.getMethod().toUpperCase();

        const rawUrl: string = uwsReq.getUrl();
        this.url = rawUrl;
        this.path = rawUrl;

        // Capture all headers
        const headers: Record<string, string> = {};
        uwsReq.forEach((key, value) => {
            headers[key.toLowerCase()] = value;
        });
        this.headers = headers;

        // Parse cookies from the cookie header
        this.cookies = parseCookies(headers["cookie"] || "");

        // Parse query string
        this.query = parseQueryString(uwsReq.getQuery());

        // Remote address for IP utilities
        this.socket = { remoteAddress };
    }
}

/**
 * Adapts a uWS `HttpResponse` to the framework-agnostic `HttpResponse` interface.
 *
 * Buffers headers and status code until the first write. Tracks abort state to safely
 * skip writes on aborted connections. All uWS writes are wrapped in `res.cork()` for
 * optimal performance.
 */
export class UWSResponse implements HttpResponse {
    private readonly uwsRes: UWSHttpResponse;
    private _statusCode: number = 200;
    private _headers: Map<string, string | string[]> = new Map();
    private _headersSent: boolean = false;
    private _writableEnded: boolean = false;
    private _streaming: boolean = false;
    private _aborted: boolean = false;
    private _abortHandlers: (() => void)[] = [];
    private _finished: boolean = false;
    private _finishHandlers: (() => void | Promise<void>)[] = [];
    /** Set to true for HEAD requests — body bytes must not be sent. */
    public isHead: boolean = false;
    /** Intermediate result passed between middleware. */
    public result?: any;
    /** Allow arbitrary per-response properties. */
    [key: string]: any;

    constructor(uwsRes: UWSHttpResponse) {
        this.uwsRes = uwsRes;
        // Track connection abort so we don't attempt writes on a closed socket.
        // uWS only allows one onAborted registration per response, so fan out here.
        uwsRes.onAborted(() => {
            this._aborted = true;
            for (const handler of this._abortHandlers) handler();
            this._fireFinish();
        });
    }

    public get statusCode(): number {
        return this._statusCode;
    }

    public get headersSent(): boolean {
        return this._headersSent;
    }

    public get writableEnded(): boolean {
        return this._writableEnded || this._streaming;
    }

    public status(code: number): this {
        this._statusCode = code;
        return this;
    }

    public setHeader(key: string, value: string | number | string[]): this {
        this._headers.set(key.toLowerCase(), Array.isArray(value) ? value.map(String) : String(value));
        return this;
    }

    public appendHeader(key: string, value: string | number): this {
        const lowerKey = key.toLowerCase();
        const existing = this._headers.get(lowerKey);
        if (existing === undefined) {
            this._headers.set(lowerKey, String(value));
        } else if (Array.isArray(existing)) {
            existing.push(String(value));
        } else {
            this._headers.set(lowerKey, [existing, String(value)]);
        }
        return this;
    }

    public getHeader(key: string): string | string[] | undefined {
        return this._headers.get(key.toLowerCase());
    }

    public json(data: any): void {
        this._headers.set("content-type", "application/json");
        this.end(JSON.stringify(data));
    }

    public send(data?: any): void {
        if (data === undefined || data === null) {
            this.end();
        } else if (typeof data === "object" && !Buffer.isBuffer(data)) {
            this.json(data);
        } else {
            this.end(data);
        }
    }

    public end(data?: any): void {
        if (this._aborted || this._writableEnded) return;
        this._writableEnded = true;
        this._fireFinish();

        this.uwsRes.cork(() => {
            // Write status line (uWS expects "200 OK" format)
            if (!this._headersSent) {
                this.uwsRes.writeStatus(this._statusToString(this._statusCode));
                // Write all buffered headers except content-length:
                // uWS auto-adds content-length via end(data) or endWithoutBody(n), so
                // writing it manually would create a duplicate Content-Length header.
                this._writeHeaders();
                this._headersSent = true;
            }

            if (this.isHead) {
                // HEAD: use endWithoutBody so uWS sets Content-Length from the reported size
                // without sending body bytes. Allows doCount/doExists to report a count via
                // content-length without triggering the duplicate-header bug.
                const cl = this._headers.get("content-length");
                this.uwsRes.endWithoutBody(typeof cl === "string" ? parseInt(cl, 10) : undefined);
            } else if (data === undefined || data === null) {
                this.uwsRes.end();
            } else {
                this.uwsRes.end(data);
            }
        });
    }

    /**
     * Flushes status and headers to the wire immediately without ending the response.
     * Required before streaming data (e.g. SSE). Safe to call multiple times — only
     * acts on the first call.
     */
    public flushHeaders(): void {
        if (this._aborted || this._headersSent) return;
        this._streaming = true;
        this.uwsRes.cork(() => {
            this.uwsRes.writeStatus(this._statusToString(this._statusCode));
            this._writeHeaders();
            this._headersSent = true;
        });
    }

    /**
     * Writes all buffered headers to the wire, skipping content-length (uWS sets it
     * automatically via end(data)/endWithoutBody(n)). Headers with multiple values (e.g. one
     * set via `appendHeader`, such as multiple `Set-Cookie` cookies) are written as repeated
     * `writeHeader` calls — uWS emits a separate header line per call rather than overwriting.
     */
    private _writeHeaders(): void {
        for (const [key, value] of this._headers.entries()) {
            if (key === "content-length") continue;
            if (Array.isArray(value)) {
                for (const v of value) this.uwsRes.writeHeader(key, v);
            } else {
                this.uwsRes.writeHeader(key, value);
            }
        }
    }

    /**
     * Writes a chunk to the response without ending it (streaming / SSE).
     * Flushes headers on the first call if they haven't been sent yet.
     */
    public write(data: string | Buffer): void {
        if (this._aborted || this._writableEnded) return;
        if (!this._headersSent) this.flushHeaders();
        this.uwsRes.write(data);
    }

    /**
     * Registers a callback to run when the client aborts the connection.
     * Safe to call multiple times — all registered callbacks are invoked on abort.
     * Uses the single uWS `onAborted` slot registered in the constructor.
     */
    public onAbort(callback: () => void): void {
        this._abortHandlers.push(callback);
    }

    /**
     * Registers a callback fired exactly once when the response lifecycle ends — either a normal
     * end() or a client abort. Fires immediately if the response has already finished. Handlers run
     * fire-and-forget (via a resolved microtask) so slow/async work (e.g. a Redis write) never
     * delays or blocks the actual response flush.
     */
    public onFinish(handler: () => void | Promise<void>): void {
        if (this._finished) {
            void handler();
        } else {
            this._finishHandlers.push(handler);
        }
    }

    private _fireFinish(): void {
        if (this._finished) return;
        this._finished = true;
        for (const handler of this._finishHandlers) {
            Promise.resolve()
                .then(() => handler())
                .catch(() => {
                    // Persistence errors are the middleware's responsibility to log; never let
                    // them surface as an unhandled rejection from the adapter.
                });
        }
    }

    /** Converts a numeric status code to the "200 OK" string format uWS expects. */
    private _statusToString(code: number): string {
        const messages: Record<number, string> = {
            100: "Continue", 101: "Switching Protocols",
            200: "OK", 201: "Created", 202: "Accepted", 204: "No Content", 206: "Partial Content",
            301: "Moved Permanently", 302: "Found", 304: "Not Modified",
            400: "Bad Request", 401: "Unauthorized", 403: "Forbidden", 404: "Not Found",
            405: "Method Not Allowed", 409: "Conflict", 410: "Gone", 422: "Unprocessable Entity",
            429: "Too Many Requests",
            500: "Internal Server Error", 501: "Not Implemented", 502: "Bad Gateway", 503: "Service Unavailable",
        };
        return `${code} ${messages[code] || "Unknown"}`;
    }
}

/** Default maximum accepted request body size (10 MiB) when no explicit limit is configured. */
export const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;

/**
 * Reads the full request body from a uWS response object as a Buffer.
 * Body parsing (JSON / URL-encoded) is applied based on content-type and the result
 * is cached on `req.body` / `req.rawBody`.
 *
 * If the accumulated body exceeds `maxBodySize`, a `413 Payload Too Large` response is written
 * directly and the connection is ended — the caller must check the resolved value and skip running
 * any further middleware/routing for this request when it's `false`, since a response has already
 * been sent.
 *
 * @returns `true` if the body was read normally (or there was none to read), `false` if the request
 * was rejected for exceeding `maxBodySize`.
 */
export function readBody(
    uwsRes: UWSHttpResponse,
    req: UWSRequest,
    maxBodySize: number = DEFAULT_MAX_BODY_SIZE,
): Promise<boolean> {
    return new Promise((resolve) => {
        if (req.body !== undefined) {
            resolve(true);
            return;
        }

        let hasChunks = false;
        let totalLength = 0;
        let rejected = false;
        const chunks: Buffer[] = [];

        const parseBody = (raw: Buffer) => {
            req.rawBody = raw;
            req.body = parseBodyByContentType(raw, String(req.headers["content-type"] || ""));
        };

        uwsRes.onData((chunk, isLast) => {
            // The response has already been ended below; ignore any further chunks uWS may deliver.
            if (rejected) return;

            totalLength += chunk.byteLength;
            if (totalLength > maxBodySize) {
                rejected = true;
                uwsRes.cork(() => {
                    uwsRes.writeStatus("413 Payload Too Large");
                    uwsRes.writeHeader("content-type", "application/json");
                    uwsRes.end(
                        JSON.stringify({
                            code: ApiErrors.PAYLOAD_TOO_LARGE,
                            status: 413,
                            message: ApiErrorMessages.PAYLOAD_TOO_LARGE,
                        }),
                    );
                });
                resolve(false);
                return;
            }

            // `chunk` is a raw ArrayBuffer that uWS reuses/detaches once this callback returns, so any
            // reference to it must not outlive this call. `Buffer.from(arrayBuffer)` does NOT copy in that
            // case — given an ArrayBuffer (as opposed to a TypedArray/Buffer), it returns a *view* over that
            // same memory. Retaining that view past this callback (on `req.rawBody`, or in `chunks` for a
            // later `Buffer.concat()`) and reading it afterward throws "Cannot perform
            // %TypedArray%.prototype.set on a detached ArrayBuffer" (or silently returns garbage bytes).
            // `chunk.slice(0)` copies the bytes into a brand new, independently-owned ArrayBuffer first.
            if (isLast && !hasChunks) {
                // Fast path: single-chunk body — skip the chunks array and Buffer.concat entirely.
                parseBody(Buffer.from(chunk.slice(0)));
                resolve(true);
                return;
            }

            // Multi-chunk path: copy each chunk immediately, for the same reason as the fast path above.
            hasChunks = true;
            chunks.push(Buffer.from(chunk.slice(0)));

            if (isLast) {
                parseBody(Buffer.concat(chunks));
                resolve(true);
            }
        });
    });
}
