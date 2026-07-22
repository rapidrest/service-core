///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import {
    DEFAULT_MAX_BODY_SIZE,
    parseBodyByContentType,
    parseCookies,
    parseQueryString,
    readBody,
    UWSRequest,
    UWSResponse,
} from "../../../src/http/uWS/Adapters";

describe("parseCookies Tests", () => {
    it("returns an empty object for an empty header", () => {
        expect(parseCookies("")).toEqual({});
    });

    it("parses a single cookie", () => {
        expect(parseCookies("foo=bar")).toEqual({ foo: "bar" });
    });

    it("parses multiple cookies and trims whitespace", () => {
        expect(parseCookies("foo=bar; baz=qux")).toEqual({ foo: "bar", baz: "qux" });
    });

    it("decodes URI-encoded values", () => {
        expect(parseCookies("foo=hello%20world")).toEqual({ foo: "hello world" });
    });

    it("skips segments without an '=' separator", () => {
        expect(parseCookies("foo=bar; noequalshere; baz=qux")).toEqual({ foo: "bar", baz: "qux" });
    });

    it("falls back to the raw value instead of throwing on malformed percent-encoding", () => {
        // A bare "%" is invalid percent-encoding and makes decodeURIComponent throw. This must not
        // propagate — UWSRequest's constructor calls parseCookies() synchronously with no surrounding
        // try/catch, so an uncaught throw here would crash request handling for any malformed cookie.
        expect(() => parseCookies("foo=%")).not.toThrow();
        expect(parseCookies("foo=%")).toEqual({ foo: "%" });
        expect(parseCookies("foo=%zz; bar=baz")).toEqual({ foo: "%zz", bar: "baz" });
    });
});

describe("parseQueryString Tests", () => {
    it("returns an empty object for an empty string", () => {
        expect(parseQueryString("")).toEqual({});
    });

    it("parses simple key/value pairs", () => {
        expect(parseQueryString("a=1&b=2")).toEqual({ a: "1", b: "2" });
    });

    it("treats a key with no '=' as an empty-string value", () => {
        expect(parseQueryString("flag")).toEqual({ flag: "" });
    });

    it("falls back to the raw key when decoding a flag-only key fails", () => {
        expect(parseQueryString("%")).toEqual({ "%": "" });
    });

    it("collects repeated keys into an array", () => {
        expect(parseQueryString("a=1&a=2")).toEqual({ a: ["1", "2"] });
    });

    it("appends to an existing array for a third repeat of the same key", () => {
        expect(parseQueryString("a=1&a=2&a=3")).toEqual({ a: ["1", "2", "3"] });
    });

    it("decodes URI-encoded keys and values", () => {
        expect(parseQueryString("a%20b=c%20d")).toEqual({ "a b": "c d" });
    });

    it("falls back to raw key/value when decoding fails", () => {
        expect(parseQueryString("a=%")).toEqual({ a: "%" });
    });
});

describe("parseBodyByContentType Tests", () => {
    it("returns undefined for an empty buffer", () => {
        expect(parseBodyByContentType(Buffer.alloc(0), "application/json")).toBeUndefined();
    });

    it("parses valid JSON", () => {
        const result = parseBodyByContentType(Buffer.from(JSON.stringify({ a: 1 })), "application/json");
        expect(result).toEqual({ a: 1 });
    });

    it("falls back to the raw string when JSON parsing fails", () => {
        const result = parseBodyByContentType(Buffer.from("not-json"), "application/json");
        expect(result).toBe("not-json");
    });

    it("parses application/x-www-form-urlencoded bodies", () => {
        const result = parseBodyByContentType(Buffer.from("a=1&b=2"), "application/x-www-form-urlencoded");
        expect(result).toEqual({ a: "1", b: "2" });
    });

    it("returns the raw buffer for other content types", () => {
        const buf = Buffer.from("binary-data");
        expect(parseBodyByContentType(buf, "application/octet-stream")).toBe(buf);
    });

    it("matches content-type case-insensitively", () => {
        const result = parseBodyByContentType(Buffer.from(JSON.stringify({ a: 1 })), "Application/JSON; charset=utf-8");
        expect(result).toEqual({ a: 1 });
    });
});

function makeUwsReq(overrides: Partial<{ method: string; url: string; query: string; headers: Record<string, string> }> = {}) {
    const headers = overrides.headers ?? { cookie: "foo=bar" };
    return {
        getMethod: () => overrides.method ?? "get",
        getUrl: () => overrides.url ?? "/test",
        getQuery: () => overrides.query ?? "a=1",
        forEach: (cb: (key: string, value: string) => void) => {
            for (const [k, v] of Object.entries(headers)) cb(k, v);
        },
    };
}

describe("UWSRequest Tests", () => {
    it("captures method, url, headers, cookies, query, and remote address", () => {
        const req = new UWSRequest(makeUwsReq() as any, "127.0.0.1");
        expect(req.method).toBe("GET");
        expect(req.url).toBe("/test");
        expect(req.path).toBe("/test");
        expect(req.headers).toEqual({ cookie: "foo=bar" });
        expect(req.cookies).toEqual({ foo: "bar" });
        expect(req.query).toEqual({ a: "1" });
        expect(req.socket.remoteAddress).toBe("127.0.0.1");
    });

    it("defaults cookies to empty object when there is no cookie header", () => {
        const req = new UWSRequest(makeUwsReq({ headers: {} }) as any);
        expect(req.cookies).toEqual({});
        expect(req.socket.remoteAddress).toBeUndefined();
    });

    it("lowercases header keys", () => {
        const req = new UWSRequest(makeUwsReq({ headers: { "X-Custom": "value" } }) as any);
        expect(req.headers["x-custom"]).toBe("value");
    });
});

function makeUwsRes() {
    const calls: any = { headers: [], statuses: [], ended: [], endWithoutBody: [], writes: [] };
    let onAbortedCb: (() => void) | undefined;
    const res: any = {
        onAborted: (cb: () => void) => {
            onAbortedCb = cb;
        },
        cork: (fn: () => void) => fn(),
        writeStatus: (s: string) => calls.statuses.push(s),
        writeHeader: (k: string, v: string) => calls.headers.push([k, v]),
        end: (data?: any) => calls.ended.push(data),
        endWithoutBody: (n?: number) => calls.endWithoutBody.push(n),
        write: (data: any) => calls.writes.push(data),
        onData: vi.fn(),
        triggerAbort: () => onAbortedCb?.(),
        _calls: calls,
    };
    return res;
}

describe("UWSResponse Tests", () => {
    it("defaults status to 200 and is not yet ended", () => {
        const res = new UWSResponse(makeUwsRes());
        expect(res.statusCode).toBe(200);
        expect(res.headersSent).toBe(false);
        expect(res.writableEnded).toBe(false);
    });

    it("status()/setHeader()/getHeader() are chainable and track state", () => {
        const res = new UWSResponse(makeUwsRes());
        expect(res.status(201)).toBe(res);
        expect(res.statusCode).toBe(201);
        expect(res.setHeader("X-Foo", "bar")).toBe(res);
        expect(res.getHeader("x-foo")).toBe("bar");
        expect(res.getHeader("missing")).toBeUndefined();
    });

    it("json() sets content-type and ends with a JSON string", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.json({ ok: true });
        expect(res.getHeader("content-type")).toBe("application/json");
        expect(uwsRes._calls.ended).toEqual([JSON.stringify({ ok: true })]);
        expect(res.writableEnded).toBe(true);
    });

    it("send() with undefined/null ends without a body", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.send();
        expect(uwsRes._calls.ended).toEqual([undefined]);
    });

    it("send() with a plain object delegates to json()", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.send({ a: 1 });
        expect(res.getHeader("content-type")).toBe("application/json");
        expect(uwsRes._calls.ended).toEqual([JSON.stringify({ a: 1 })]);
    });

    it("send() with a Buffer ends with the raw buffer", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        const buf = Buffer.from("raw");
        res.send(buf);
        expect(uwsRes._calls.ended).toEqual([buf]);
    });

    it("send() with a string ends with the raw string", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.send("plain text");
        expect(uwsRes._calls.ended).toEqual(["plain text"]);
    });

    it("end() writes the status line and headers, skipping content-length", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.setHeader("content-length", "999");
        res.setHeader("x-a", "1");
        res.end("body");
        expect(uwsRes._calls.statuses).toEqual(["200 OK"]);
        expect(uwsRes._calls.headers).toEqual([["x-a", "1"]]);
        expect(uwsRes._calls.ended).toEqual(["body"]);
    });

    it("end() is a no-op when called a second time", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.end("first");
        res.end("second");
        expect(uwsRes._calls.ended).toEqual(["first"]);
    });

    it("end() is a no-op when the connection has already aborted", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        uwsRes.triggerAbort();
        res.end("data");
        expect(uwsRes._calls.ended).toEqual([]);
    });

    it("uses a fallback status message for unknown status codes", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.status(799).end();
        expect(uwsRes._calls.statuses).toEqual(["799 Unknown"]);
    });

    it("end() only writes headers once across HEAD handling", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.isHead = true;
        res.setHeader("content-length", "42");
        res.end();
        expect(uwsRes._calls.endWithoutBody).toEqual([42]);
        expect(uwsRes._calls.ended).toEqual([]);
    });

    it("HEAD response with no content-length passes undefined", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.isHead = true;
        res.end();
        expect(uwsRes._calls.endWithoutBody).toEqual([undefined]);
    });

    it("flushHeaders() writes status/headers and marks streaming", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.setHeader("x-a", "1");
        res.flushHeaders();
        expect(uwsRes._calls.statuses).toEqual(["200 OK"]);
        expect(res.headersSent).toBe(true);
        expect(res.writableEnded).toBe(true); // _streaming makes writableEnded true
    });

    it("flushHeaders() skips a manually-set content-length header", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.setHeader("content-length", "10");
        res.setHeader("x-a", "1");
        res.flushHeaders();
        expect(uwsRes._calls.headers).toEqual([["x-a", "1"]]);
    });

    it("end() after flushHeaders() does not re-write the status line or headers", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.setHeader("x-a", "1");
        res.flushHeaders();
        res.end("body");
        expect(uwsRes._calls.statuses.length).toBe(1);
        expect(uwsRes._calls.headers).toEqual([["x-a", "1"]]);
        expect(uwsRes._calls.ended).toEqual(["body"]);
    });

    it("flushHeaders() is a no-op on subsequent calls", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.flushHeaders();
        res.flushHeaders();
        expect(uwsRes._calls.statuses.length).toBe(1);
    });

    it("flushHeaders() is a no-op when aborted", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        uwsRes.triggerAbort();
        res.flushHeaders();
        expect(uwsRes._calls.statuses).toEqual([]);
    });

    it("write() flushes headers on first call, then writes subsequent chunks directly", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.write("chunk1");
        res.write("chunk2");
        expect(uwsRes._calls.statuses.length).toBe(1);
        expect(uwsRes._calls.writes).toEqual(["chunk1", "chunk2"]);
    });

    it("write() is a no-op once ended", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.end();
        res.write("chunk");
        expect(uwsRes._calls.writes).toEqual([]);
    });

    it("write() is a no-op when aborted", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        uwsRes.triggerAbort();
        res.write("chunk");
        expect(uwsRes._calls.writes).toEqual([]);
    });

    it("onAbort() fires all registered handlers exactly once when aborted", () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        const calls: string[] = [];
        res.onAbort(() => calls.push("a"));
        res.onAbort(() => calls.push("b"));
        uwsRes.triggerAbort();
        expect(calls).toEqual(["a", "b"]);
    });

    it("onFinish() handlers fire after end()", async () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        let called = false;
        res.onFinish(() => {
            called = true;
        });
        res.end();
        await new Promise((resolve) => setImmediate(resolve));
        expect(called).toBe(true);
    });

    it("onFinish() fires immediately when registered after finish", async () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        res.end();
        let called = false;
        res.onFinish(() => {
            called = true;
        });
        await new Promise((resolve) => setImmediate(resolve));
        expect(called).toBe(true);
    });

    it("onFinish() handlers fire on abort too, and swallow thrown errors", async () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        let called = false;
        res.onFinish(() => {
            called = true;
            throw new Error("boom");
        });
        expect(() => uwsRes.triggerAbort()).not.toThrow();
        await new Promise((resolve) => setImmediate(resolve));
        expect(called).toBe(true);
    });

    it("_fireFinish only fires handlers once even if triggered twice", async () => {
        const uwsRes = makeUwsRes();
        const res = new UWSResponse(uwsRes);
        let count = 0;
        res.onFinish(() => {
            count++;
        });
        res.end();
        uwsRes.triggerAbort();
        await new Promise((resolve) => setImmediate(resolve));
        expect(count).toBe(1);
    });
});

function makeUwsResForBody() {
    let onDataCb: ((chunk: ArrayBuffer, isLast: boolean) => void) | undefined;
    const calls: any = { statuses: [], headers: [], ended: [] };
    return {
        onData: (cb: (chunk: ArrayBuffer, isLast: boolean) => void) => {
            onDataCb = cb;
        },
        cork: (fn: () => void) => fn(),
        writeStatus: (s: string) => calls.statuses.push(s),
        writeHeader: (k: string, v: string) => calls.headers.push([k, v]),
        end: (data?: any) => calls.ended.push(data),
        fireData: (chunk: string | Buffer, isLast: boolean) => {
            const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            onDataCb?.(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), isLast);
        },
        _calls: calls,
    };
}

describe("readBody Tests", () => {
    it("resolves true immediately when req.body is already set", async () => {
        const uwsRes = makeUwsResForBody();
        const req: any = { body: { already: "parsed" }, headers: {} };
        await expect(readBody(uwsRes as any, req)).resolves.toBe(true);
    });

    it("parses a single-chunk JSON body (fast path)", async () => {
        const uwsRes = makeUwsResForBody();
        const req: any = { headers: { "content-type": "application/json" } };
        const promise = readBody(uwsRes as any, req);
        uwsRes.fireData(JSON.stringify({ a: 1 }), true);
        await expect(promise).resolves.toBe(true);
        expect(req.body).toEqual({ a: 1 });
        expect(req.rawBody).toBeInstanceOf(Buffer);
    });

    it("assembles a multi-chunk body", async () => {
        const uwsRes = makeUwsResForBody();
        const req: any = { headers: { "content-type": "application/json" } };
        const promise = readBody(uwsRes as any, req);
        const json = JSON.stringify({ a: "x".repeat(10) });
        const mid = Math.floor(json.length / 2);
        uwsRes.fireData(json.slice(0, mid), false);
        uwsRes.fireData(json.slice(mid), true);
        await expect(promise).resolves.toBe(true);
        expect(req.body).toEqual({ a: "x".repeat(10) });
    });

    it("rejects with 413 when the body exceeds maxBodySize", async () => {
        const uwsRes = makeUwsResForBody();
        const req: any = { headers: {} };
        const promise = readBody(uwsRes as any, req, 4);
        uwsRes.fireData(Buffer.from("way too big"), true);
        await expect(promise).resolves.toBe(false);
        expect(uwsRes._calls.statuses).toEqual(["413 Payload Too Large"]);
        const body = JSON.parse(uwsRes._calls.ended[0]);
        expect(body.status).toBe(413);
    });

    it("ignores further chunks after rejection", async () => {
        const uwsRes = makeUwsResForBody();
        const req: any = { headers: {} };
        const promise = readBody(uwsRes as any, req, 4);
        uwsRes.fireData(Buffer.from("way too big"), false);
        uwsRes.fireData(Buffer.from("more"), true);
        await expect(promise).resolves.toBe(false);
        expect(uwsRes._calls.ended.length).toBe(1);
    });

    it("uses DEFAULT_MAX_BODY_SIZE when none is provided", async () => {
        expect(DEFAULT_MAX_BODY_SIZE).toBe(10 * 1024 * 1024);
        const uwsRes = makeUwsResForBody();
        const req: any = { headers: {} };
        const promise = readBody(uwsRes as any, req);
        uwsRes.fireData(Buffer.from("small"), true);
        await expect(promise).resolves.toBe(true);
    });
});
