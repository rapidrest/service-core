///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { HttpRequest, HttpResponse } from "../types.js";
import type { HttpRequest as UWSHttpRequest, HttpResponse as UWSHttpResponse } from "uWebSockets.js";
import { ApiErrorMessages, ApiErrors } from "../../ApiErrors.js";
import { Readable } from "stream";

/** Parses a `cookie` header string into a key/value map. */
export function parseCookies(cookieHeader: string): Record<string, string> {
    const result: Record<string, string> = {};
    if (!cookieHeader) return result;
    for (const part of cookieHeader.split(";")) {
        const idx = part.indexOf("=");
        if (idx < 0) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (key === "__proto__") continue;
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

/**
 * Parses a URL query string (without leading `?`) into a key/value map. A key given more than once becomes an array
 * of its values.
 *
 * The result is a plain object, so spreading it and calling `Object.prototype` methods through it behave as usual.
 * Only own properties are considered when detecting a repeated key, so a key like `hasOwnProperty` or `constructor`
 * is stored as a normal value instead of being merged with the inherited function. `__proto__` keys are dropped:
 * assigning one would replace the object's prototype, and even as an own property it would do so again when the
 * object is later copied with `Object.assign()` or a deep merge.
 */
export function parseQueryString(qs: string): Record<string, string | string[]> {
    const result: Record<string, string | string[]> = {};
    if (!qs) return result;
    for (const part of qs.split("&")) {
        const idx = part.indexOf("=");
        let key: string;
        let val: string;
        if (idx < 0) {
            try {
                key = decodeURIComponent(part);
            } catch {
                key = part;
            }
            val = "";
        } else {
            try {
                key = decodeURIComponent(part.slice(0, idx));
                val = decodeURIComponent(part.slice(idx + 1));
            } catch {
                key = part.slice(0, idx);
                val = part.slice(idx + 1);
            }
        }
        if (key === "__proto__") {
            continue;
        }
        if (idx < 0) {
            // A bare key (no `=`) sets an empty value, replacing any previous value.
            result[key] = val;
        } else if (Object.prototype.hasOwnProperty.call(result, key)) {
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
    /** True while uWS reports backpressure from a `write()` that has not yet drained. */
    private _needDrain: boolean = false;
    /** Whether the single uWS `onWritable` slot has been claimed by this response yet. */
    private _writableHooked: boolean = false;
    private _drainHandlers: (() => void)[] = [];
    private _drainWaiters: ((canWrite: boolean) => void)[] = [];
    /** Set to true for HEAD requests — body bytes must not be sent. */
    public isHead: boolean = false;
    /** Intermediate result passed between middleware. */
    public result?: any;
    /**
     * Set by the router via `attachBodyStream()` for a streaming-body route (see
     * `HttpRouteOptions.streamingBody`). `end()` checks `isBodyStreamFullyReceived()` against it —
     * see that function's doc comment and `end()` for the full rationale.
     */
    private _bodyStream?: Readable;
    /** Allow arbitrary per-response properties. */
    [key: string]: any;

    constructor(uwsRes: UWSHttpResponse) {
        this.uwsRes = uwsRes;
        // Track connection abort so we don't attempt writes on a closed socket.
        // uWS only allows one onAborted registration per response, so fan out here.
        uwsRes.onAborted(() => this._handleAbort());
    }

    /**
     * Records that the connection is gone, whether the client closed it or `destroy()` did, and tells everyone watching.
     * Runs its notifications only once, however many times it is reached (`uwsRes.close()` fires `onAborted` itself).
     */
    private _handleAbort(): void {
        if (this._aborted) return;
        this._aborted = true;
        this._needDrain = false;
        // Nothing will ever drain an aborted connection: release anyone waiting so they can stop producing.
        this._settleDrainWaiters(false);
        for (const handler of this._abortHandlers) handler();
        this._fireFinish();
    }

    /**
     * Associates this response with a streaming-body route's `req.bodyStream`, so `end()` can detect
     * a response finalizing before uWS has received the whole declared request body and force the
     * connection closed instead of hanging it — see `isBodyStreamFullyReceived()`'s doc comment for
     * the full rationale. Called once, by the router, right after `makeBodyStream()` creates the
     * stream (`HttpRouteOptions.streamingBody` routes only — never called otherwise).
     */
    public attachBodyStream(stream: Readable): void {
        this._bodyStream = stream;
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

    /** `true` once the client has aborted the connection. A producer should stop writing and release its resources. */
    public get aborted(): boolean {
        return this._aborted;
    }

    /**
     * `true` while a previous `write()` returned `false` and the buffered data has not drained yet (the equivalent
     * of Node's `Writable.writableNeedDrain`). Wait with `waitForDrain()` or `onDrain()` before writing more.
     */
    public get writableNeedDrain(): boolean {
        return this._needDrain;
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
        this._needDrain = false;
        this._settleDrainWaiters(false);
        this._fireFinish();

        // A streaming-body route answering before uWS has received the whole declared request body: the handler
        // responded without draining req.bodyStream (an auth or validation failure, a rate limit, a size limit hit part
        // way), a slow client hasn't finished sending, or a client declared a huge Content-Length it never intends to
        // send. A plain uwsRes.end() now would leave the connection in uWS's keep-alive machinery waiting for bytes that
        // may never arrive, indefinitely, for the cost of one request's headers, and uWS gives no way to close it once
        // the response has ended. Closing it now instead (uwsRes.close(), or end(..., closeConnection = true), which
        // closes as soon as the response is written) resets a connection the client is still sending on, and the reset
        // makes the client drop the answer: it sees a network error instead of a 401 or a 429. So the rest of the body
        // is read and discarded first, within UNREAD_BODY_DRAIN's limits, and the response is then sent normally. When
        // the limits don't allow that, it is sent with `Connection: close` (written by uWS) and uWS closes the
        // connection right after it.
        if (this._bodyStream && !isBodyStreamFullyReceived(this._bodyStream)) {
            const cancel = drainBodyStream(this._bodyStream, (fullyReceived) => {
                if (!this._aborted) this._send(data, !fullyReceived);
            });
            // A client that goes away first gets nothing, and its timer must not outlive it.
            this.onAbort(cancel);
            return;
        }
        this._send(data, false);
    }

    /** Writes the status, the headers (unless already sent) and `data`, and ends the uWS response. */
    private _send(data: any, closeConnection: boolean): void {
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
                this.uwsRes.endWithoutBody(typeof cl === "string" ? parseInt(cl, 10) : undefined, closeConnection);
            } else if (data === undefined || data === null) {
                if (closeConnection) this.uwsRes.end("", true);
                else this.uwsRes.end();
            } else {
                this.uwsRes.end(data, closeConnection);
            }
        });
    }

    /**
     * Terminates the connection abruptly, so the client sees a failed transfer (a reset or a truncated chunked body)
     * instead of a response that ended normally. See `HttpResponse.destroy()`.
     *
     * Closes the uWS response with `close()`, and then runs the abort bookkeeping itself in case `close()` did not (it
     * is skipped when the uWS response is already invalid). The reason is accepted for parity with other runtimes and
     * is not used: uWS cannot carry one to the client.
     */
    public destroy(_error?: Error): void {
        if (this._aborted || this._writableEnded) return;
        try {
            this.uwsRes.close();
        } catch {
            // Already invalid/closed — nothing left to close.
        }
        this._handleAbort();
    }

    /**
     * Flushes status and headers to the wire immediately without ending the response.
     * Required before streaming data (e.g. SSE). Safe to call multiple times — only
     * acts on the first call.
     */
    public flushHeaders(): void {
        if (this._aborted || this._headersSent) return;
        this._streaming = true;
        this.uwsRes.cork(() => this._writeHead());
    }

    /** Writes the status line and buffered headers. Must be called from within a cork. */
    private _writeHead(): void {
        this.uwsRes.writeStatus(this._statusToString(this._statusCode));
        this._writeHeaders();
        this._headersSent = true;
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
     * Writes a chunk to the response without ending it (streaming / SSE), corked so it is safe from any async
     * context. Flushes headers on the first call if they haven't been sent yet.
     *
     * Mirrors Node's `Writable.write()`: returns `true` when the data was sent (or buffered below the limit) and
     * `false` when uWS's buffer is now full. The chunk is still accepted in that case, but the caller should stop
     * writing until `waitForDrain()` resolves (or an `onDrain()` callback fires). Also returns `false`, and writes
     * nothing, once the response has ended or the client aborted (see `aborted`).
     */
    public write(data: string | Buffer): boolean {
        if (this._aborted || this._writableEnded) return false;
        let ok = true;
        // Everything that touches the uWS response runs inside one cork. uWS only implicitly corks the synchronous top
        // of a request handler; a write made after an `await`, from a stream event or from a timer is outside of it
        // (uWS logs "writes must be made from within a corked callback" and sends one syscall per call).
        this.uwsRes.cork(() => {
            if (!this._headersSent) {
                this._streaming = true;
                this._writeHead();
            }
            ok = this.uwsRes.write(data) !== false;
        });
        if (!ok) {
            // uWS accepted and buffered the chunk (nothing is lost) but its buffer is over the limit.
            this._needDrain = true;
            this._hookWritable();
        }
        return ok;
    }

    /**
     * Registers a callback fired every time the buffered data of a backpressured `write()` has drained and it is safe
     * to write again (the equivalent of Node's `'drain'` event). It is never called after the response has ended or
     * aborted.
     */
    public onDrain(callback: () => void): void {
        this._drainHandlers.push(callback);
    }

    /**
     * Resolves once it is safe to write again, so a producer can honour backpressure:
     *
     * ```ts
     * for (const chunk of chunks) {
     *     if (!res.write(chunk) && !(await res.waitForDrain())) return; // client went away
     * }
     * res.end();
     * ```
     *
     * Resolves `true` immediately when there is no pending backpressure, `true` when the data drains, and `false` when
     * the client aborts or the response ends while waiting, meaning the producer must stop. It never stays pending
     * for a connection that can no longer drain.
     */
    public waitForDrain(): Promise<boolean> {
        if (this._aborted || this._writableEnded) return Promise.resolve(false);
        if (!this._needDrain) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => this._drainWaiters.push(resolve));
    }

    /** Claims uWS's single `onWritable` slot (once) to learn when a backpressured `write()` has drained. */
    private _hookWritable(): void {
        if (this._writableHooked) return;
        this._writableHooked = true;
        this.uwsRes.onWritable(() => {
            if (this._needDrain) {
                this._needDrain = false;
                this._settleDrainWaiters(true);
                for (const handler of this._drainHandlers) handler();
            }
            // "Writing nothing is always success" (uWS docs): only a `tryEnd()` caller could report otherwise.
            return true;
        });
    }

    private _settleDrainWaiters(canWrite: boolean): void {
        const waiters = this._drainWaiters;
        this._drainWaiters = [];
        for (const resolve of waiters) resolve(canWrite);
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
            100: "Continue",
            101: "Switching Protocols",
            200: "OK",
            201: "Created",
            202: "Accepted",
            204: "No Content",
            206: "Partial Content",
            301: "Moved Permanently",
            302: "Found",
            304: "Not Modified",
            400: "Bad Request",
            401: "Unauthorized",
            403: "Forbidden",
            404: "Not Found",
            405: "Method Not Allowed",
            409: "Conflict",
            410: "Gone",
            422: "Unprocessable Entity",
            429: "Too Many Requests",
            500: "Internal Server Error",
            501: "Not Implemented",
            502: "Bad Gateway",
            503: "Service Unavailable",
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
    res?: { onAbort: (callback: () => void) => void },
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

        // If the client disconnects mid-upload, uWS never delivers a final `isLast` chunk to onData()
        // below, which would otherwise leave this promise pending forever — permanently leaking the
        // chunks buffered so far along with the request/response closures awaiting it. There's no
        // response to send to an already-closed connection, so just settle immediately.
        res?.onAbort(() => {
            if (rejected) return;
            rejected = true;
            resolve(false);
        });

        uwsRes.onData((chunk, isLast) => {
            // The response has already been ended below (or the connection aborted); ignore any
            // further chunks uWS may deliver.
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

/**
 * Internal buffer size (in bytes) at which `makeBodyStream()`'s stream applies backpressure — i.e.
 * pauses pulling more bytes off the uWS connection until its consumer catches up. Chosen much larger
 * than a Node `Readable`'s 16 KiB default: a streaming route exists specifically to move large
 * payloads (e.g. a multi-GB mailbox import) efficiently, and throttling every 16 KiB would make
 * pause()/resume() churn dominate. 1 MiB bounds worst-case extra memory per in-flight streaming
 * request to a small, predictable amount while still giving a slow consumer (e.g. writing to disk)
 * plenty of headroom before the network is throttled.
 */
export const STREAMING_BODY_HIGH_WATER_MARK = 1024 * 1024;

/**
 * Limits on how much of a request body uWS reads and throws away after a streaming-body route has answered before the
 * body was fully received (see `UWSResponse.end()`). Reading the rest first is what lets the client receive the answer:
 * a connection closed while the client is still sending is reset, and a reset makes the client discard the response it
 * has not read yet, so the client would see a network error instead of, say, a 401 or a 429.
 *
 * A body read to the end this way leaves the connection open for the next request, as after any other response. Past
 * either limit, the answer is sent with `Connection: close` and the connection is closed right after it. Both values are
 * read each time such a response is sent, so an application can change them at startup.
 */
export const UNREAD_BODY_DRAIN: { maxBytes: number; timeoutMs: number } = {
    /**
     * The most body bytes still to come (by the declared `Content-Length`, or counted as they arrive for a chunked body)
     * that are read and discarded. When more remain, the answer is sent at once. 0 turns draining off.
     */
    maxBytes: 16 * 1024 * 1024,
    /** The longest, in milliseconds, the answer waits for the rest of the body (a slow or stalled client). */
    timeoutMs: 30_000,
};

/** Internal state of a stream made by `makeBodyStream()`, stored on it under `BODY_STATE`. */
interface BodyStreamState {
    /**
     * Whether uWS has delivered the final chunk (`onData`'s `isLast`). Deliberately independent of the stream's own
     * `readableEnded`: Node only sets that once a consumer has read to the end, so a stream nobody reads (a route that
     * rejects the request before touching `req.bodyStream`) would never report an already-fully-arrived body.
     */
    fullyReceived: boolean;
    /** The body length the request declared (`Content-Length`), or `undefined` when it did not (chunked). */
    declaredLength?: number;
    /** The body bytes uWS has delivered so far, read or not. */
    receivedBytes: number;
    /** Resumes the connection if, and only if, this stream paused it and still owes the matching `resume()`. */
    releasePause(): void;
    /** Called after every chunk uWS delivers, once the stream has handled it (see `drainBodyStream()`). */
    onChunk?: () => void;
}

const BODY_STATE = Symbol("uwsBodyStreamState");

function bodyStateOf(stream: Readable): BodyStreamState | undefined {
    return (stream as any)[BODY_STATE];
}

/**
 * Returns `true` once uWS has delivered the final chunk of `stream`'s request body — i.e. it is safe
 * to let the underlying connection return to uWS's keep-alive pool — regardless of whether anything
 * has actually consumed the stream. Returns `true` for `undefined` (nothing to wait for) so callers
 * can pass `req.bodyStream` directly without an existence check first, and `false` for a stream
 * `makeBodyStream()` did not make.
 *
 * See `UWSResponse.end()`: a streaming route's handler can legitimately respond (an auth failure, a
 * validation error, anything) without ever reading `req.bodyStream`. If the client declared a large
 * `Content-Length` and hasn't actually sent it all yet — or, in the malicious case, never intends to
 * — a plain `uwsRes.end()` at that point leaves the keep-alive connection open indefinitely: uWS
 * won't consider it clean for reuse until it has received every byte of the declared body, and nothing
 * in that scenario ever makes that happen. `end()` uses this check to drain the rest of the body
 * within `UNREAD_BODY_DRAIN`'s limits first, or to close the connection after the response.
 */
export function isBodyStreamFullyReceived(stream: Readable | undefined): boolean {
    if (!stream) return true;
    return bodyStateOf(stream)?.fullyReceived === true;
}

/**
 * Discards the rest of a request body the response no longer needs, and calls `done` once: with `true` when the whole
 * body has arrived (the connection can stay open), or with `false` (the response must close the connection) straight
 * away when the declared length leaves more than `UNREAD_BODY_DRAIN.maxBytes` to come, or later when that many bytes
 * have arrived or `UNREAD_BODY_DRAIN.timeoutMs` runs out. When the client goes away first, `done` is never called; the
 * caller sees the abort itself.
 *
 * The stream is destroyed, so a consumer still reading it gets an error instead of waiting forever, and a `pause()` the
 * stream still owes a `resume()` for is lifted so the rest of the body can arrive. A stream `makeBodyStream()` did not
 * make is left alone, and `done(false)` is called at once.
 *
 * @returns A function that stops waiting without calling `done`, for when the client has gone away.
 */
function drainBodyStream(stream: Readable, done: (fullyReceived: boolean) => void): () => void {
    const state = bodyStateOf(stream);
    if (!state) {
        // Not a stream makeBodyStream() made: nothing here can tell when its body ends.
        done(false);
        return () => undefined;
    }
    if (!stream.destroyed) stream.destroy(new Error("The response was sent before the request body was fully read."));
    state.releasePause();
    const { maxBytes, timeoutMs } = UNREAD_BODY_DRAIN;
    const limit = state.receivedBytes + maxBytes;
    if (maxBytes <= 0 || (state.declaredLength !== undefined && state.declaredLength > limit)) {
        done(false);
        return () => undefined;
    }
    const stop = (): void => {
        clearTimeout(timer);
        state.onChunk = undefined;
    };
    const settle = (fullyReceived: boolean): void => {
        stop();
        done(fullyReceived);
    };
    const timer = setTimeout(() => settle(false), timeoutMs);
    state.onChunk = () => {
        if (state.fullyReceived) settle(true);
        else if (state.receivedBytes > limit) settle(false);
    };
    return stop;
}

/**
 * Exposes a uWS request body as a Node `Readable` stream instead of buffering it into memory, for a
 * route registered with `{ streamingBody: true }` (see `HttpRouteOptions`). Does NOT populate
 * `req.body`/`req.rawBody` and does NOT enforce any `maxBodySize` limit — this is the entire point:
 * unlike `readBody()`, the caller has opted out of buffering specifically so an arbitrarily large
 * body (e.g. a 20 GB PST/mbox import) never needs to fit in memory at once. Enforcing a size limit,
 * if wanted, is the route handler's own responsibility while consuming the stream.
 *
 * Backpressure is real, not simulated: a chunk that overflows the stream's internal buffer
 * (`push()` returning `false`) calls `uwsRes.pause()` (uWS suspends delivering more `onData`
 * chunks), and the returned `Readable`'s `_read()` calls `uwsRes.resume()` — but ONLY when this
 * function itself previously paused it. uWS's `pause()`/`resume()` are not simple idempotent
 * throttle toggles: empirically, calling `resume()` when the connection was never paused (e.g. from
 * `_read()`'s very first call, before any backpressure has ever been applied) stops any further
 * `onData` delivery for the rest of the request, hanging it forever. A local `paused` flag makes
 * `resume()` a no-op unless a matching `pause()` was actually issued, matching the exact
 * pause/resume pairing uWS expects. A slow consumer (a route piping to a slow disk, or one simply
 * not reading yet) still throttles how fast bytes are pulled off the client connection rather than
 * piling up unbounded data in process memory — the failure mode this whole feature exists to avoid.
 * The same pairing discipline also applies to the final chunk: when a chunk that overflows the
 * buffer also happens to be the last one (`isLast`), `pause()` is skipped entirely — the stream is
 * about to signal EOF via `push(null)` regardless, so Node's `Readable` never calls `_read()` again
 * to issue the matching `resume()`. For that same reason, a `pause()` still owed a `resume()` when
 * the last chunk arrives is resumed right there: uWS can still deliver chunks it had already
 * buffered after `pause()` ("some buffered data may still be sent to onData"), the last one
 * included, and a connection left paused never reads the next keep-alive request on it.
 *
 * The stream is destroyed with an error if the client disconnects mid-upload (wired through the
 * existing single `onAborted` fan-out via `res.onAbort()`, matching `readBody()`'s own abort
 * handling) so a handler awaiting `for await (const chunk of req.bodyStream)` sees a thrown error
 * instead of hanging forever, and can clean up (e.g. delete a partial temp file) in its own
 * `catch`/`finally`. A route that never reads `req.bodyStream` at all can still hit this path — e.g.
 * `UWSResponse.end()` destroys the stream when the response is sent before the body was fully
 * received — so a permanent no-op `error` listener is attached below as well: a `Readable` with no
 * active consumer still emits `error` on `destroy(err)`, and Node treats an `error` event with zero
 * listeners as fatal (crashes the process). This listener doesn't swallow anything from a real
 * consumer — `for await`/`.pipe()`/an explicit `.on("error")` all still see the same event;
 * EventEmitter calls every registered listener, not just the first.
 *
 * Must be called synchronously, before any `await`, in the same tick as request handling begins —
 * uWS requires `onData`/`onAborted` to be registered before any asynchronous operation, matching the
 * exact constraint `readBody()` above is already subject to.
 *
 * @param uwsRes The uWS HttpResponse to read the body from.
 * @param res Used only to register the abort callback through the framework's existing single
 * `onAborted` slot (see `UWSResponse.onAbort()`) — never written to otherwise.
 * @param contentLength The request's `Content-Length` header, if any. Lets `UWSResponse.end()` tell at once whether
 * the rest of an unread body is small enough to drain (see `UNREAD_BODY_DRAIN`); without it, bytes are counted as they
 * arrive.
 */
export function makeBodyStream(
    uwsRes: UWSHttpResponse,
    res: { onAbort: (callback: () => void) => void },
    contentLength?: string | string[],
): Readable {
    // Tracks whether THIS function called uwsRes.pause() and is therefore the one that owes it a
    // matching resume() — see the doc comment above for why resume() must never be called
    // speculatively.
    let paused = false;
    const state: BodyStreamState = {
        fullyReceived: false,
        declaredLength:
            typeof contentLength === "string" && /^\d+$/.test(contentLength) ? Number(contentLength) : undefined,
        receivedBytes: 0,
        releasePause: () => {
            if (paused) {
                paused = false;
                uwsRes.resume();
            }
        },
    };

    const stream = new Readable({
        highWaterMark: STREAMING_BODY_HIGH_WATER_MARK,
        read() {
            // `stream.destroyed` is set synchronously the moment destroy() is called (Node
            // guarantees this before this `_destroy` implementation even runs), so this check can't
            // race a concurrent destroy from the onAbort handler below.
            if (!stream.destroyed) state.releasePause();
        },
        destroy(err, callback) {
            callback(err);
        },
    });
    (stream as any)[BODY_STATE] = state;
    // Safety net against an unhandled 'error' event crashing the process when nobody ever consumes
    // this stream — see the doc comment above for the full rationale. A real consumer (for await,
    // .pipe(), or its own .on("error")) still observes the same event independently of this listener.
    stream.on("error", () => undefined);

    res.onAbort(() => {
        if (stream.destroyed) return;
        stream.destroy(new Error("Request aborted before the body stream was fully read."));
    });

    uwsRes.onData((chunk, isLast) => {
        state.receivedBytes += chunk.byteLength;
        if (isLast) {
            state.fullyReceived = true;
            // A pause() may still be owed its resume() here: see the doc comment above.
            state.releasePause();
        }

        // A destroyed stream (a consumer error, an abort, or a response sent before the body was read) wants no more
        // chunks. uWS keeps delivering onData for the rest of the body regardless (there's no way to tell it to stop
        // mid-request), so they are dropped here rather than pushed into a destroyed stream (which throws).
        if (!stream.destroyed) {
            if (chunk.byteLength > 0) {
                // `chunk` is a raw ArrayBuffer uWS reuses/detaches once this callback returns — see the
                // identical, more detailed comment in readBody() above for why `.slice(0)` is required.
                const ok = stream.push(Buffer.from(chunk.slice(0)));
                // Never pause on the final chunk — see the doc comment above for why that would leave
                // the connection paused with no matching resume() ever coming.
                if (!ok && !isLast) {
                    paused = true;
                    uwsRes.pause();
                }
            }
            if (isLast) stream.push(null);
        }

        state.onChunk?.();
    });

    return stream;
}
