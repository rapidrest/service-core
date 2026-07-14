///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { HttpRequest, HttpResponse } from "../types.js";
import { DEFAULT_MAX_BODY_SIZE, parseBodyByContentType, parseCookies, parseQueryString } from "../uWS/Adapters.js";
import { ApiErrorMessages, ApiErrors } from "../../ApiErrors.js";

/**
 * Minimal structural slice of Bun's `Server` used by `BunRequest`. Deliberately NOT typed as
 * `Bun.Server` — a public constructor parameter typed against the ambient `Bun` namespace would
 * leak into this package's emitted `.d.ts`, breaking `tsc` for downstream consumers who don't have
 * `@types/bun` installed even though they never touch the Bun adapter (confirmed: without this,
 * the emitted declaration file contains a bare unresolvable `Bun.Server<any>` reference). Bun's
 * real `Server` structurally satisfies this interface, so `bun/BunRouter.ts` (which has its own
 * `/// <reference types="bun" />`) can pass a real instance unchanged.
 */
export interface RequestIPSource {
    requestIP(req: Request): { address?: string } | null;
}

/**
 * Adapts a Bun/Fetch API `Request` to the framework-agnostic `HttpRequest` interface.
 *
 * Unlike uWS's stack-allocated request, a Fetch API `Request` stays valid across `await`, so there
 * is no urgency to capture everything synchronously in the constructor the way `UWSRequest` must —
 * this is done here purely for parity/simplicity, not correctness.
 */
export class BunRequest implements HttpRequest {
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

    constructor(req: Request, server: RequestIPSource) {
        this.method = req.method.toUpperCase();

        const u = new URL(req.url);
        this.url = u.pathname + u.search;
        this.path = u.pathname;

        const headers: Record<string, string> = {};
        req.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
        });
        this.headers = headers;

        this.cookies = parseCookies(headers["cookie"] || "");
        // Reuse the exact same query-string parser the uWS adapter uses (array-collapsing rules,
        // decode-failure fallback) rather than URLSearchParams, to keep parsing behavior identical
        // across both adapters.
        this.query = parseQueryString(u.search.startsWith("?") ? u.search.slice(1) : u.search);

        const ip = server.requestIP(req);
        this.socket = { remoteAddress: ip?.address };
    }
}

/**
 * Adapts a buffered/streamed set of response calls to the framework-agnostic `HttpResponse`
 * interface, bridging them into a Fetch API `Response` that `Bun.serve()`'s `fetch()` handler
 * resolves and returns.
 *
 * Two modes:
 * - Buffered (default): `end()`/`json()`/`send()` finalize the body and resolve `responseReady`
 * with a single complete `Response`.
 * - Streaming: `flushHeaders()`/`write()` construct a `ReadableStream`-backed `Response` and
 * resolve `responseReady` immediately (before the body is fully known) so the client starts
 * receiving bytes right away; further `write()` calls enqueue chunks, `end()` closes the stream.
 */
export class BunResponse implements HttpResponse {
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

    private _body: BodyInit | null = null;
    private _controller: ReadableStreamDefaultController<Uint8Array> | null = null;
    private _stream: ReadableStream<Uint8Array> | null = null;

    private _resolveReady!: (res: Response) => void;
    /** Resolves once headers are known — either the full buffered Response, or a streaming one. */
    public readonly responseReady: Promise<Response>;

    constructor(rawRequest: Request) {
        this.responseReady = new Promise<Response>((resolve) => {
            this._resolveReady = resolve;
        });
        rawRequest.signal?.addEventListener("abort", () => {
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
        // Once flushHeaders()/write() has started a streaming response, treat the response as
        // "ended" from the middleware chain's perspective even before end()/close() is called —
        // matches UWSResponse.writableEnded. Without this, runChain's sync-handler branch never
        // sees writableEnded become true for a handler that starts streaming and returns without
        // calling next() (the documented SSE pattern), so the chain hangs forever waiting for next().
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

        if (this._streaming) {
            if (data !== undefined && data !== null) this._enqueue(data);
            try {
                this._controller?.close();
            } catch {
                // already closed/errored
            }
            return;
        }

        this._headersSent = true;
        if (this.isHead) {
            this._body = null;
        } else if (data !== undefined && data !== null) {
            this._body = Buffer.isBuffer(data) ? new Uint8Array(data) : data;
        }
        this._resolveReady(this._buildResponse());
    }

    /**
     * Flushes status and headers to the wire immediately without ending the response, via a
     * `ReadableStream`, and resolves `responseReady` right away so the client starts receiving
     * bytes before the rest of the middleware chain finishes. Required before streaming data
     * (e.g. SSE). Safe to call multiple times — only acts on the first call.
     */
    public flushHeaders(): void {
        if (this._aborted || this._headersSent) return;
        this._streaming = true;
        this._headersSent = true;
        this._stream = new ReadableStream<Uint8Array>({
            start: (controller) => {
                this._controller = controller;
            },
            cancel: () => {
                this._aborted = true;
                for (const handler of this._abortHandlers) handler();
            },
        });
        this._resolveReady(this._buildStreamingResponse());
    }

    /**
     * Writes a chunk to the response without ending it (streaming / SSE).
     * Flushes headers on the first call if they haven't been sent yet.
     */
    public write(data: string | Buffer): void {
        if (this._aborted || this._writableEnded) return;
        if (!this._headersSent) this.flushHeaders();
        this._enqueue(data);
    }

    /**
     * Registers a callback to run when the client aborts the connection — either before any
     * response was sent (via the request's `AbortSignal`) or mid-stream (via the `ReadableStream`'s
     * `cancel` callback).
     */
    public onAbort(callback: () => void): void {
        this._abortHandlers.push(callback);
    }

    /**
     * Errors the underlying stream if it's still open. Used when a middleware chain throws after
     * streaming has already started and the `Response` has already been handed back to the client.
     */
    public abortStream(err: any): void {
        if (this._streaming && !this._writableEnded) {
            try {
                this._controller?.error(err);
            } catch {
                // already closed
            }
            this._writableEnded = true;
        }
    }

    private _enqueue(data: string | Buffer): void {
        const chunk = typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
        try {
            this._controller?.enqueue(chunk);
        } catch {
            // controller may already be closed/errored if the client disconnected
        }
    }

    private _buildHeaders(): Headers {
        const headers = new Headers();
        for (const [key, value] of this._headers.entries()) {
            // Let Response compute content-length itself, same rationale as the uWS adapter.
            if (key === "content-length") continue;
            headers.set(key, value);
        }
        return headers;
    }

    private _buildResponse(): Response {
        return new Response(this._body, { status: this._statusCode, headers: this._buildHeaders() });
    }

    private _buildStreamingResponse(): Response {
        return new Response(this._stream, { status: this._statusCode, headers: this._buildHeaders() });
    }
}

/** Builds the 413 JSON response used when a request body exceeds `maxBodySize`. */
function payloadTooLargeResponse(): Response {
    return new Response(
        JSON.stringify({
            code: ApiErrors.PAYLOAD_TOO_LARGE,
            status: 413,
            message: ApiErrorMessages.PAYLOAD_TOO_LARGE,
        }),
        { status: 413, headers: { "content-type": "application/json" } },
    );
}

export type ReadBunBodyResult = { ok: true } | { ok: false; response: Response };

/**
 * Reads the full request body from a Bun `Request` into a Buffer, mirroring `readBody()`'s uWS
 * behavior exactly: body parsing (JSON / URL-encoded) is applied based on content-type and the
 * result is cached on `req.body` / `req.rawBody`. Rejects with a 413 JSON `Response` if the body
 * exceeds `maxBodySize` — checked both against the declared `Content-Length` up front (fast path)
 * and against the actual accumulated byte count as chunks arrive, so chunked/unknown-length bodies
 * that lie about or omit `Content-Length` are still caught, matching uWS's guarantee.
 */
export async function readBunBody(
    req: BunRequest,
    rawRequest: Request,
    maxBodySize: number = DEFAULT_MAX_BODY_SIZE,
): Promise<ReadBunBodyResult> {
    if (req.body !== undefined) {
        return { ok: true };
    }

    const declaredLength = rawRequest.headers.get("content-length");
    if (declaredLength && Number(declaredLength) > maxBodySize) {
        return { ok: false, response: payloadTooLargeResponse() };
    }

    if (!rawRequest.body) {
        req.rawBody = undefined;
        req.body = undefined;
        return { ok: true };
    }

    const reader = rawRequest.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;

    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > maxBodySize) {
            try {
                await reader.cancel();
            } catch {
                // ignore — we're rejecting the request regardless
            }
            return { ok: false, response: payloadTooLargeResponse() };
        }
        chunks.push(value);
    }

    const raw = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    req.rawBody = raw;
    req.body = parseBodyByContentType(raw, String(req.headers["content-type"] || ""));
    return { ok: true };
}
