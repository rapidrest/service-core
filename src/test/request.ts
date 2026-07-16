///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
/**
 * Supertest-compatible HTTP test helper built on axios.
 * Accepts either a Server instance (extracts port from server.port) or a port number.
 */
import axios from "axios";

/** Minimal supertest-compatible response shape. */
export interface TestResponse {
    status: number;
    statusCode: number;
    body: any;
    text: string;
    /** MIME type extracted from the content-type header (without charset). */
    type: string;
    headers: Record<string, string>;
    ok: boolean;
    /** True for 3xx responses that carry a Location header, matching superagent's `res.redirect`. */
    redirect: boolean;
}

function extractPort(app: any): number {
    if (typeof app === "number") return app;
    // Server instance
    if (app && typeof app.port === "number") return app.port;
    // HttpRouter instance
    if (app && typeof app.listenPort === "number") return app.listenPort;
    throw new Error("request(): cannot determine port from argument");
}

function extractMimeType(contentType?: string): string {
    if (!contentType) return "";
    return contentType.split(";")[0].trim();
}

/** Parses one or more `Set-Cookie` header values, merging `name=value` pairs into the given jar. */
function absorbSetCookie(jar: Map<string, string>, setCookie: string | string[] | undefined): void {
    if (!setCookie) return;
    const values = Array.isArray(setCookie) ? setCookie : [setCookie];
    for (const value of values) {
        const pair = value.split(";")[0];
        const idx = pair.indexOf("=");
        if (idx < 0) continue;
        const name = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        jar.set(name, val);
    }
}

/** Serializes the jar's contents into a `Cookie` request header value, or `undefined` if empty. */
function buildCookieHeader(jar: Map<string, string>): string | undefined {
    if (jar.size === 0) return undefined;
    return Array.from(jar.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
}

/**
 * Builds a supertest-style request builder that sends requests via axios to `http://localhost:<port>`.
 * When `jar` is provided, every request sends the jar's accumulated cookies and every response's
 * `Set-Cookie` header(s) are merged back into it — this is what powers `agent()`'s cross-request
 * cookie persistence. `request()` passes no jar, so it stays stateless between calls.
 */
function createRequester(app: any, jar?: Map<string, string>) {
    const port = extractPort(app);
    const baseUrl = `http://localhost:${port}`;

    function makeChain(method: string, url: string) {
        const hdrs: Record<string, string> = {};
        let body: any = undefined;

        const chain: any = {
            set(key: string, value: string) {
                hdrs[key] = value;
                return chain;
            },
            send(data: any) {
                body = data;
                return chain;
            },
            then(onFulfilled: any, onRejected?: any): Promise<TestResponse> {
                // Auto-set Content-Type for JSON bodies. Buffers are sent verbatim. Everything else (objects,
                // numbers, booleans, and strings — which callers pre-encode as JSON, e.g. `.send('"foo"')`) is
                // treated as JSON: axios's default transform only auto-serializes plain objects, leaves strings
                // untouched but defaults their Content-Type to form-urlencoded, and hands numbers/booleans straight
                // to the HTTP adapter, which rejects anything that isn't a string/Buffer/Stream.
                if (body !== undefined && !Buffer.isBuffer(body)) {
                    hdrs["content-type"] = hdrs["content-type"] || "application/json";
                }
                if (jar && !hdrs["Cookie"] && !hdrs["cookie"]) {
                    const cookieHeader = buildCookieHeader(jar);
                    if (cookieHeader) hdrs["Cookie"] = cookieHeader;
                }
                return axios
                    .request({
                        method,
                        url: baseUrl + url,
                        data: body,
                        headers: hdrs,
                        validateStatus: () => true,
                        responseType: "text",
                        transformResponse: (data) => data,
                        // supertest/superagent does not auto-follow redirects; callers inspect
                        // res.headers.location themselves. Match that so 3xx responses come back as-is.
                        maxRedirects: 0,
                    })
                    .then((res) => {
                        if (jar) absorbSetCookie(jar, res.headers["set-cookie"]);
                        const raw = res.data as string;
                        const ct = res.headers["content-type"] as string | undefined;
                        const mime = extractMimeType(ct);
                        let parsed: any;
                        try {
                            parsed = JSON.parse(raw);
                        } catch {
                            parsed = raw;
                        }
                        const result: TestResponse = {
                            status: res.status,
                            statusCode: res.status,
                            body: parsed,
                            text: raw,
                            type: mime,
                            headers: res.headers as Record<string, string>,
                            ok: res.status >= 200 && res.status < 300,
                            redirect: [301, 302, 303, 305, 307, 308].includes(res.status),
                        };
                        return onFulfilled ? onFulfilled(result) : result;
                    })
                    .catch(onRejected);
            },
            catch(onRejected: any) {
                return chain.then(undefined, onRejected);
            },
        };

        return chain;
    }

    return {
        get: (url: string) => makeChain("GET", url),
        post: (url: string) => makeChain("POST", url),
        put: (url: string) => makeChain("PUT", url),
        delete: (url: string) => makeChain("DELETE", url),
        patch: (url: string) => makeChain("PATCH", url),
        head: (url: string) => makeChain("HEAD", url),
        options: (url: string) => makeChain("OPTIONS", url),
    };
}

/**
 * Creates a supertest-style request builder that sends requests via axios to
 * `http://localhost:<port>`. No cookie persistence between calls — each call is independent.
 */
export function request(app: any) {
    return createRequester(app);
}

/**
 * Creates a supertest `.agent()`-style request builder that persists cookies across every call
 * made through it, matching real browser behavior. Use this for multi-request flows where a
 * server-set cookie (e.g. a session cookie) must be sent back on a later request — a plain
 * `request(app)` call issues a stateless request each time and never resends cookies.
 */
export function agent(app: any) {
    return createRequester(app, new Map<string, string>());
}
