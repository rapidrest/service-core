///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { ApiErrorMessages, ApiErrors } from "../../../src/ApiErrors";
import { BunRequest, BunResponse, readBunBody, type RequestIPSource } from "../../../src/http/bun/BunAdapters";

function makeIpSource(overrides: Partial<{ requestIP: any }> = {}): RequestIPSource {
    return {
        requestIP: vi.fn().mockReturnValue({ address: "127.0.0.1" }),
        ...overrides,
    };
}

describe("BunRequest Tests", () => {
    it("captures method, url, path, headers, cookies, query, and remote address", () => {
        const req = new Request("http://localhost/test?a=1", {
            method: "get",
            headers: { cookie: "foo=bar" },
        });
        const bunReq = new BunRequest(req, makeIpSource());
        expect(bunReq.method).toBe("GET");
        expect(bunReq.url).toBe("/test?a=1");
        expect(bunReq.path).toBe("/test");
        expect(bunReq.headers["cookie"]).toBe("foo=bar");
        expect(bunReq.cookies).toEqual({ foo: "bar" });
        expect(bunReq.query).toEqual({ a: "1" });
        expect(bunReq.socket.remoteAddress).toBe("127.0.0.1");
    });

    it("lowercases header keys", () => {
        const req = new Request("http://localhost/test", { headers: { "X-Custom": "value" } });
        const bunReq = new BunRequest(req, makeIpSource());
        expect(bunReq.headers["x-custom"]).toBe("value");
    });

    it("defaults cookies to an empty object when there is no cookie header", () => {
        const req = new Request("http://localhost/test");
        const bunReq = new BunRequest(req, makeIpSource());
        expect(bunReq.cookies).toEqual({});
    });

    it("collects repeated query keys into an array, reusing the uWS query parser", () => {
        const req = new Request("http://localhost/test?a=1&a=2");
        const bunReq = new BunRequest(req, makeIpSource());
        expect(bunReq.query).toEqual({ a: ["1", "2"] });
    });

    it("leaves remoteAddress undefined when requestIP() returns null", () => {
        const req = new Request("http://localhost/test");
        const bunReq = new BunRequest(req, makeIpSource({ requestIP: vi.fn().mockReturnValue(null) }));
        expect(bunReq.socket.remoteAddress).toBeUndefined();
    });

    it("defaults params, body, and signedCookies", () => {
        const req = new Request("http://localhost/test");
        const bunReq = new BunRequest(req, makeIpSource());
        expect(bunReq.params).toEqual({});
        expect(bunReq.body).toBeUndefined();
        expect(bunReq.signedCookies).toEqual({});
    });
});

describe("BunResponse Tests", () => {
    function makeReq(): Request {
        return new Request("http://localhost/test");
    }

    it("defaults status to 200 and is not yet ended", () => {
        const res = new BunResponse(makeReq());
        expect(res.statusCode).toBe(200);
        expect(res.headersSent).toBe(false);
        expect(res.writableEnded).toBe(false);
    });

    it("status()/setHeader()/getHeader() are chainable and case-insensitive", () => {
        const res = new BunResponse(makeReq());
        expect(res.status(201)).toBe(res);
        expect(res.statusCode).toBe(201);
        expect(res.setHeader("X-Foo", "bar")).toBe(res);
        expect(res.getHeader("x-foo")).toBe("bar");
        expect(res.getHeader("missing")).toBeUndefined();
    });

    it("json() sets content-type and resolves responseReady with a JSON body", async () => {
        const res = new BunResponse(makeReq());
        res.json({ ok: true });
        expect(res.getHeader("content-type")).toBe("application/json");
        const response = await res.responseReady;
        expect(await response.json()).toEqual({ ok: true });
        expect(res.writableEnded).toBe(true);
    });

    it("send() with undefined/null ends without a body", async () => {
        const res = new BunResponse(makeReq());
        res.send();
        const response = await res.responseReady;
        expect(await response.text()).toBe("");
    });

    it("send() with a plain object delegates to json()", async () => {
        const res = new BunResponse(makeReq());
        res.send({ a: 1 });
        expect(res.getHeader("content-type")).toBe("application/json");
        const response = await res.responseReady;
        expect(await response.json()).toEqual({ a: 1 });
    });

    it("send() with a Buffer ends with the raw bytes and does not set json content-type", async () => {
        const res = new BunResponse(makeReq());
        res.send(Buffer.from("raw"));
        expect(res.getHeader("content-type")).toBeUndefined();
        const response = await res.responseReady;
        expect(await response.text()).toBe("raw");
    });

    it("send() with a string ends with the raw string", async () => {
        const res = new BunResponse(makeReq());
        res.send("plain text");
        const response = await res.responseReady;
        expect(await response.text()).toBe("plain text");
    });

    it("end() strips a manually-set content-length header instead of trusting the caller's value", async () => {
        const res = new BunResponse(makeReq());
        res.setHeader("content-length", "999");
        res.setHeader("x-a", "1");
        res.end("abc");
        const response = await res.responseReady;
        expect(response.headers.get("x-a")).toBe("1");
        expect(response.headers.get("content-length")).not.toBe("999");
        expect(await response.text()).toBe("abc");
    });

    it("end() is a no-op when called a second time", async () => {
        const res = new BunResponse(makeReq());
        res.end("first");
        res.end("second");
        const response = await res.responseReady;
        expect(await response.text()).toBe("first");
    });

    it("end() with isHead=true drops the body even when data is passed", async () => {
        const res = new BunResponse(makeReq());
        res.isHead = true;
        res.setHeader("x-a", "1");
        res.end("body");
        const response = await res.responseReady;
        expect(response.headers.get("x-a")).toBe("1");
        expect(await response.text()).toBe("");
    });

    it("flushHeaders() resolves responseReady before end() is called, and marks writableEnded", async () => {
        const res = new BunResponse(makeReq());
        res.setHeader("x-a", "1");
        let resolved = false;
        res.responseReady.then(() => (resolved = true));
        res.flushHeaders();
        await Promise.resolve();
        expect(resolved).toBe(true);
        expect(res.headersSent).toBe(true);
        // The documented SSE quirk: writableEnded is true as soon as streaming starts, even though
        // end() was never called — this is what stops runChain from hanging forever on a handler
        // that starts streaming and returns without calling next().
        expect(res.writableEnded).toBe(true);
    });

    it("flushHeaders() is a no-op on subsequent calls", async () => {
        const res = new BunResponse(makeReq());
        res.flushHeaders();
        const first = await res.responseReady;
        res.flushHeaders();
        const second = await res.responseReady;
        expect(second).toBe(first);
    });

    it("write() auto-flushes headers on the first call and enqueues chunks", async () => {
        const res = new BunResponse(makeReq());
        res.write("chunk1");
        res.write("chunk2");
        res.end();
        const response = await res.responseReady;
        expect(await response.text()).toBe("chunk1chunk2");
    });

    it("write() accepts a Buffer chunk", async () => {
        const res = new BunResponse(makeReq());
        res.write(Buffer.from("buf-chunk"));
        res.end();
        const response = await res.responseReady;
        expect(await response.text()).toBe("buf-chunk");
    });

    it("end(data) while streaming enqueues the final chunk before closing", async () => {
        const res = new BunResponse(makeReq());
        res.flushHeaders();
        res.write("first-");
        res.end("last");
        const response = await res.responseReady;
        expect(await response.text()).toBe("first-last");
    });

    it("write()/end() after writableEnded are no-ops", async () => {
        const res = new BunResponse(makeReq());
        res.end("first");
        res.write("ignored");
        const response = await res.responseReady;
        expect(await response.text()).toBe("first");
    });

    it("onAbort() and onFinish() fire when the request's AbortSignal fires", async () => {
        const ac = new AbortController();
        const req = new Request("http://localhost/test", { signal: ac.signal });
        const res = new BunResponse(req);
        const aborted: string[] = [];
        let finished = false;
        res.onAbort(() => aborted.push("a"));
        res.onFinish(() => {
            finished = true;
        });
        ac.abort();
        await Promise.resolve();
        expect(aborted).toEqual(["a"]);
        expect(finished).toBe(true);
    });

    it("onAbort() fires via the streaming ReadableStream's cancel callback", async () => {
        const res = new BunResponse(makeReq());
        const aborted: string[] = [];
        res.onAbort(() => aborted.push("a"));
        res.flushHeaders();
        const response = await res.responseReady;
        const reader = response.body!.getReader();
        await reader.cancel();
        expect(aborted).toEqual(["a"]);
    });

    it("onFinish() handlers run fire-and-forget and swallow a rejected handler", async () => {
        const res = new BunResponse(makeReq());
        let called = false;
        res.onFinish(async () => {
            called = true;
            throw new Error("boom");
        });
        expect(() => res.end()).not.toThrow();
        await new Promise((resolve) => setImmediate(resolve));
        expect(called).toBe(true);
    });

    it("onFinish() fires immediately when registered after the response already finished", async () => {
        const res = new BunResponse(makeReq());
        res.end();
        let called = false;
        res.onFinish(() => {
            called = true;
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(called).toBe(true);
    });

    it("only fires onFinish handlers once, even if the finish trigger fires again after end()", async () => {
        // The AbortSignal listener calls _fireFinish() unconditionally, regardless of whether end()
        // already ran — _fireFinish()'s own internal `if (this._finished) return` guard is what
        // prevents onFinish handlers from running a second time in that case.
        const ac = new AbortController();
        const req = new Request("http://localhost/test", { signal: ac.signal });
        const res = new BunResponse(req);
        let count = 0;
        res.onFinish(() => {
            count++;
        });
        res.end();
        ac.abort();
        await new Promise((resolve) => setImmediate(resolve));
        expect(count).toBe(1);
    });

    it("abortStream() errors an in-flight stream and marks it ended", async () => {
        const res = new BunResponse(makeReq());
        res.flushHeaders();
        const response = await res.responseReady;
        const reader = response.body!.getReader();
        res.abortStream(new Error("boom"));
        await expect(reader.read()).rejects.toThrow("boom");
        expect(res.writableEnded).toBe(true);
    });

    it("abortStream() is a no-op when the response already ended", () => {
        const res = new BunResponse(makeReq());
        res.end("done");
        expect(() => res.abortStream(new Error("boom"))).not.toThrow();
    });

    it("abortStream() is a no-op when never streaming", () => {
        const res = new BunResponse(makeReq());
        expect(() => res.abortStream(new Error("boom"))).not.toThrow();
    });
});

describe("readBunBody Tests", () => {
    function throwingBodyRequest(headers: Record<string, string> = {}): Request {
        const stream = new ReadableStream<Uint8Array>({
            pull() {
                throw new Error("body should not have been read");
            },
        });
        return new Request("http://localhost/test", {
            method: "POST",
            body: stream,
            duplex: "half",
            headers,
        } as any);
    }

    it("returns ok:true immediately when req.body is already set, without reading the stream", async () => {
        const rawReq = throwingBodyRequest();
        const req = new BunRequest(rawReq, makeIpSource());
        req.body = { already: "parsed" };
        await expect(readBunBody(req, rawReq)).resolves.toEqual({ ok: true });
    });

    it("rejects with 413 via the fast path when Content-Length exceeds maxBodySize, without reading the stream", async () => {
        const rawReq = throwingBodyRequest({ "content-length": "1000" });
        const req = new BunRequest(rawReq, makeIpSource());
        const result = await readBunBody(req, rawReq, 10);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.response.status).toBe(413);
            const body = await result.response.json();
            expect(body).toEqual({
                code: ApiErrors.PAYLOAD_TOO_LARGE,
                status: 413,
                message: ApiErrorMessages.PAYLOAD_TOO_LARGE,
            });
        }
    });

    it("sets body/rawBody to undefined when there is no request body", async () => {
        const rawReq = new Request("http://localhost/test");
        const req = new BunRequest(rawReq, makeIpSource());
        const result = await readBunBody(req, rawReq);
        expect(result).toEqual({ ok: true });
        expect(req.body).toBeUndefined();
        expect(req.rawBody).toBeUndefined();
    });

    it("reads a body with no content-type header, falling back to raw bytes", async () => {
        // A Uint8Array body (unlike a plain string) does not trigger the Fetch API's automatic
        // Content-Type default, so req.headers["content-type"] is genuinely absent here.
        const rawReq = new Request("http://localhost/test", {
            method: "POST",
            body: new TextEncoder().encode("raw bytes, no type"),
        });
        expect(rawReq.headers.get("content-type")).toBeNull();
        const req = new BunRequest(rawReq, makeIpSource());
        const result = await readBunBody(req, rawReq);
        expect(result).toEqual({ ok: true });
        expect(req.rawBody?.toString()).toBe("raw bytes, no type");
    });

    it("reads and parses a JSON body, setting rawBody and body", async () => {
        const json = JSON.stringify({ a: 1 });
        const rawReq = new Request("http://localhost/test", {
            method: "POST",
            body: json,
            headers: { "content-type": "application/json" },
        });
        const req = new BunRequest(rawReq, makeIpSource());
        const result = await readBunBody(req, rawReq);
        expect(result).toEqual({ ok: true });
        expect(req.rawBody).toBeInstanceOf(Buffer);
        expect(req.body).toEqual({ a: 1 });
    });

    it("rejects with 413 via the slow path when accumulated bytes exceed maxBodySize on a body with no Content-Length", async () => {
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(new Uint8Array(1024));
            },
        });
        const rawReq = new Request("http://localhost/test", { method: "POST", body: stream, duplex: "half" } as any);
        const req = new BunRequest(rawReq, makeIpSource());
        const result = await readBunBody(req, rawReq, 10);
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.response.status).toBe(413);
        }
    });

    it("swallows a throw from reader.cancel() during the slow-path 413 rejection", async () => {
        const stream = new ReadableStream<Uint8Array>({
            pull(controller) {
                controller.enqueue(new Uint8Array(1024));
            },
            cancel() {
                throw new Error("cancel boom");
            },
        });
        const rawReq = new Request("http://localhost/test", { method: "POST", body: stream, duplex: "half" } as any);
        const req = new BunRequest(rawReq, makeIpSource());
        await expect(readBunBody(req, rawReq, 10)).resolves.toMatchObject({ ok: false });
    });

    it("uses DEFAULT_MAX_BODY_SIZE when maxBodySize is not provided", async () => {
        const rawReq = new Request("http://localhost/test", {
            method: "POST",
            body: "small",
            headers: { "content-type": "text/plain" },
        });
        const req = new BunRequest(rawReq, makeIpSource());
        await expect(readBunBody(req, rawReq)).resolves.toEqual({ ok: true });
    });
});
