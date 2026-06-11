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

/**
 * Creates a supertest-style request builder that sends requests via axios to
 * `http://localhost:<port>`.
 */
export function request(app: any) {
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
                // Auto-set Content-Type for JSON object bodies
                if (body !== undefined && typeof body === "object" && !Buffer.isBuffer(body)) {
                    hdrs["content-type"] = hdrs["content-type"] || "application/json";
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
                    })
                    .then((res) => {
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
