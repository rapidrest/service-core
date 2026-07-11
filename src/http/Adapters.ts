///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { HttpRequest, HttpResponse } from "./types.js";
import type { HttpRequest as UWSHttpRequest, HttpResponse as UWSHttpResponse } from "uWebSockets.js";

/** Parses a `cookie` header string into a key/value map. */
function parseCookies(cookieHeader: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!cookieHeader) return result;
    for (const part of cookieHeader.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 0) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        result[key] = decodeURIComponent(val);
    }
    return result;
}

/** Parses a URL query string (without leading `?`) into a key/value map. */
function parseQueryString(qs: string): Record<string, string | string[]> {
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
    private _headers: Map<string, string> = new Map();
    private _headersSent: boolean = false;
    private _writableEnded: boolean = false;
    private _streaming: boolean = false;
    private _aborted: boolean = false;
    private _abortHandlers: (() => void)[] = [];
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

    public setHeader(key: string, value: string | number): this {
        this._headers.set(key.toLowerCase(), String(value));
        return this;
    }

    public getHeader(key: string): string | undefined {
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

        this.uwsRes.cork(() => {
            // Write status line (uWS expects "200 OK" format)
            if (!this._headersSent) {
                this.uwsRes.writeStatus(this._statusToString(this._statusCode));
                // Write all buffered headers except content-length:
                // uWS auto-adds content-length via end(data) or endWithoutBody(n), so
                // writing it manually would create a duplicate Content-Length header.
                for (const [key, value] of this._headers.entries()) {
                    if (key === "content-length") continue;
                    this.uwsRes.writeHeader(key, value);
                }
                this._headersSent = true;
            }

            if (this.isHead) {
                // HEAD: use endWithoutBody so uWS sets Content-Length from the reported size
                // without sending body bytes. Allows doCount/doExists to report a count via
                // content-length without triggering the duplicate-header bug.
                const cl = this._headers.get("content-length");
                this.uwsRes.endWithoutBody(cl !== undefined ? parseInt(cl, 10) : undefined);
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
            for (const [key, value] of this._headers.entries()) {
                if (key === "content-length") continue;
                this.uwsRes.writeHeader(key, value);
            }
            this._headersSent = true;
        });
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

/**
 * Reads the full request body from a uWS response object as a Buffer.
 * Body parsing (JSON / URL-encoded) is applied based on content-type and the result
 * is cached on `req.body` / `req.rawBody`.
 */
export function readBody(uwsRes: UWSHttpResponse, req: UWSRequest): Promise<void> {
    return new Promise((resolve, reject) => {
        if (req.body !== undefined) {
            resolve();
            return;
        }

        let hasChunks = false;
        const chunks: Buffer[] = [];

        const parseBody = (raw: Buffer) => {
            req.rawBody = raw;
            if (raw.length > 0) {
                const contentType: string = String(req.headers["content-type"] || "").toLowerCase();
                if (contentType.includes("application/json")) {
                    try {
                        req.body = JSON.parse(raw.toString("utf8"));
                    } catch {
                        req.body = raw.toString("utf8");
                    }
                } else if (contentType.includes("application/x-www-form-urlencoded")) {
                    req.body = Object.fromEntries(
                        new URLSearchParams(raw.toString("utf8")).entries()
                    );
                } else {
                    req.body = raw;
                }
            } else {
                req.body = undefined;
            }
        };

        uwsRes.onData((chunk, isLast) => {
            if (isLast && !hasChunks) {
                // Fast path: single-chunk body — skip the chunks array and Buffer.concat entirely.
                parseBody(Buffer.from(chunk));
                resolve();
                return;
            }

            // Multi-chunk path: copy each chunk (ArrayBuffer is only valid during this callback).
            hasChunks = true;
            chunks.push(Buffer.from(chunk));

            if (isLast) {
                parseBody(Buffer.concat(chunks));
                resolve();
            }
        });
    });
}
