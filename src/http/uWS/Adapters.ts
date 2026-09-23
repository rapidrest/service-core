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
        uwsRes.onAborted(() => {
            this._aborted = true;
            for (const handler of this._abortHandlers) handler();
            this._fireFinish();
        });
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

        if (this._bodyStream && !isBodyStreamFullyReceived(this._bodyStream)) {
            // This is a streaming-body route finalizing its response before uWS has received the
            // whole declared request body — whether because the handler responded without draining
            // req.bodyStream (an auth/validation failure, typically), a slow-but-legitimate client
            // hasn't finished sending yet, or (the exploit this specifically defends against) the
            // client declared a huge Content-Length and never intends to send it. A graceful
            // uwsRes.end() here would leave the connection sitting in uWS's keep-alive machinery
            // waiting for bytes that may never arrive — indefinitely, for the cost of a single
            // request's worth of headers. Force the connection closed instead: uWS won't accept
            // further writes/reads on it either way once this response is finalizing, so there's
            // nothing lost by not attempting a graceful end() here that keep-alive could have reused.
            // uwsRes.close() also fires the onAborted callback already registered in the constructor,
            // which destroys req.bodyStream (via makeBodyStream()'s res.onAbort() hookup) for us.
            try {
                this.uwsRes.close();
            } catch {
                // Already invalid/closed — nothing left to do.
            }
            return;
        }

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
 * Internal marker set on every `Readable` returned by `makeBodyStream()`, tracking whether uWS has
 * delivered the final chunk of the request body (`onData`'s `isLast`) yet. Deliberately independent
 * of the stream's own `readableEnded` — Node only flips `readableEnded` once a consumer has actually
 * read all the way to the end, so a stream nobody ever reads from (e.g. a route that rejects the
 * request before touching `req.bodyStream` at all) would stay `readableEnded === false` forever even
 * for a request with an already-fully-arrived, zero-byte body. `isBodyStreamFullyReceived()` reads
 * this marker instead — see its own doc comment and `UWSResponse.end()`, which uses it to decide
 * between a graceful `end()` and a forced `close()`.
 */
const FULLY_RECEIVED = Symbol("uwsBodyStreamFullyReceived");

/**
 * Returns `true` once uWS has delivered the final chunk of `stream`'s request body — i.e. it is safe
 * to let the underlying connection return to uWS's keep-alive pool — regardless of whether anything
 * has actually consumed the stream. Returns `true` for `undefined` (nothing to wait for) so callers
 * can pass `req.bodyStream` directly without an existence check first.
 *
 * See `UWSResponse.end()`: a streaming route's handler can legitimately respond (an auth failure, a
 * validation error, anything) without ever reading `req.bodyStream`. If the client declared a large
 * `Content-Length` and hasn't actually sent it all yet — or, in the malicious case, never intends to
 * — a plain `uwsRes.end()` at that point leaves the keep-alive connection open indefinitely: uWS
 * won't consider it clean for reuse until it has received every byte of the declared body, and nothing
 * in that scenario ever makes that happen. `end()` uses this check to force the connection closed
 * instead whenever it would otherwise leave that promise unfulfilled.
 */
export function isBodyStreamFullyReceived(stream: Readable | undefined): boolean {
    if (!stream) return true;
    return (stream as any)[FULLY_RECEIVED] === true;
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
 * to issue the matching `resume()`, which would otherwise leave uWS's connection paused forever with
 * nothing left in this function to ever un-pause it.
 *
 * The stream is destroyed with an error if the client disconnects mid-upload (wired through the
 * existing single `onAborted` fan-out via `res.onAbort()`, matching `readBody()`'s own abort
 * handling) so a handler awaiting `for await (const chunk of req.bodyStream)` sees a thrown error
 * instead of hanging forever, and can clean up (e.g. delete a partial temp file) in its own
 * `catch`/`finally`. A route that never reads `req.bodyStream` at all can still hit this path — e.g.
 * `UWSResponse.end()` itself calls `uwsRes.close()` (which fires `onAborted`) when finalizing a
 * response before the body was fully received — so a permanent no-op `error` listener is attached
 * below as well: a `Readable` with no active consumer still emits `error` on `destroy(err)`, and
 * Node treats an `error` event with zero listeners as fatal (crashes the process). This listener
 * doesn't swallow anything from a real consumer — `for await`/`.pipe()`/an explicit `.on("error")`
 * all still see the same event; EventEmitter calls every registered listener, not just the first.
 *
 * Must be called synchronously, before any `await`, in the same tick as request handling begins —
 * uWS requires `onData`/`onAborted` to be registered before any asynchronous operation, matching the
 * exact constraint `readBody()` above is already subject to.
 *
 * @param uwsRes The uWS HttpResponse to read the body from.
 * @param res Used only to register the abort callback through the framework's existing single
 * `onAborted` slot (see `UWSResponse.onAbort()`) — never written to otherwise.
 */
export function makeBodyStream(uwsRes: UWSHttpResponse, res: { onAbort: (callback: () => void) => void }): Readable {
    // Tracks whether THIS function called uwsRes.pause() and is therefore the one that owes it a
    // matching resume() — see the doc comment above for why resume() must never be called
    // speculatively.
    let paused = false;

    const stream = new Readable({
        highWaterMark: STREAMING_BODY_HIGH_WATER_MARK,
        read() {
            // `stream.destroyed` is set synchronously the moment destroy() is called (Node
            // guarantees this before this `_destroy` implementation even runs), so this check can't
            // race a concurrent destroy from the onAbort handler below.
            if (paused && !stream.destroyed) {
                paused = false;
                uwsRes.resume();
            }
        },
        destroy(err, callback) {
            callback(err);
        },
    });
    (stream as any)[FULLY_RECEIVED] = false;
    // Safety net against an unhandled 'error' event crashing the process when nobody ever consumes
    // this stream — see the doc comment above for the full rationale. A real consumer (for await,
    // .pipe(), or its own .on("error")) still observes the same event independently of this listener.
    stream.on("error", () => undefined);

    res.onAbort(() => {
        if (stream.destroyed) return;
        stream.destroy(new Error("Request aborted before the body stream was fully read."));
    });

    uwsRes.onData((chunk, isLast) => {
        // The stream was already destroyed (consumer error, or the connection aborted) — nothing
        // downstream wants any more chunks. uWS keeps delivering onData for the remainder of the
        // body regardless (there's no way to tell it to stop mid-request), so this must stay a
        // silent no-op rather than pushing into a destroyed stream (which throws).
        if (stream.destroyed) return;

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

        if (isLast) {
            (stream as any)[FULLY_RECEIVED] = true;
            stream.push(null);
        }
    });

    return stream;
}
