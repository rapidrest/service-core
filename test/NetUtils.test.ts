///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
vi.mock("dns", async () => {
    return {
        promises: {
            lookup: vi.fn(async (hostname: string) => {
                if (hostname === "example.com") {
                    return { address: "93.184.216.34", family: 4 };
                }
                throw new Error(`getaddrinfo ENOTFOUND ${hostname}`);
            }),
        },
    };
});

import { NetUtils } from "../src/NetUtils";
import type { HttpRequest } from "../src/http/index.js";

const YahooIPs: string[] = [
    "74.6.231.21",
    "98.137.11.163",
    "74.6.143.26",
    "98.137.11.164",
    "74.6.231.20",
    "74.6.143.25"
];

vi.setConfig({ testTimeout: 120000 });
describe("NetUtils Tests", () => {
    it("Can extract IPv4 address from string.", async () => {
        let result: string | undefined = NetUtils.getIPAddress("127.0.0.1");
        expect(result).toBe("127.0.0.1");
        result = NetUtils.getIPAddress("127.0.0.1:1234");
        expect(result).toBe("127.0.0.1");
    });

    it("Can extract IPv6 address from string.", async () => {
        let result: string | undefined = NetUtils.getIPAddress("::1");
        expect(result).toBe("::1");
        result = NetUtils.getIPAddress("[::1]:7777");
        expect(result).toBe("::1");
        result = NetUtils.getIPAddress("2001:4860:4860::8888");
        expect(result).toBe("2001:4860:4860::8888");
        result = NetUtils.getIPAddress("[2001:4860:4860::8888]:1234");
        expect(result).toBe("2001:4860:4860::8888");
        result = NetUtils.getIPAddress("2001:db8::1:0:0:1");
        expect(result).toBe("2001:db8::1:0:0:1");
        result = NetUtils.getIPAddress("[2001:db8::1:0:0:1]:1234");
        expect(result).toBe("2001:db8::1:0:0:1");
        result = NetUtils.getIPAddress("2001:db8::2:1");
        expect(result).toBe("2001:db8::2:1");
        result = NetUtils.getIPAddress("[2001:db8::2:1]:1234");
        expect(result).toBe("2001:db8::2:1");
    });

    it("Can extract IP address from URL string.", async () => {
        let result: string | undefined = NetUtils.getIPAddress("http://127.0.0.1");
        expect(result).toBe("127.0.0.1");
        result = NetUtils.getIPAddress("http://127.0.0.1:1234");
        expect(result).toBe("127.0.0.1");
        result = NetUtils.getIPAddress("http://[2001:db8::2:1]:1234");
        expect(result).toBe("2001:db8::2:1");
    });

    it("Falls back to the hostname when the URL string does not resolve to an IP.", async () => {
        const result: string | undefined = NetUtils.getIPAddress("http://example.com");
        expect(result).toBe("example.com");
    });

    it("Returns undefined for a string that is neither an IP nor a valid URL.", async () => {
        const result: string | undefined = NetUtils.getIPAddress("not a url and not an ip");
        expect(result).toBeUndefined();
    });

    describe("getIPAddress with an HttpRequest", () => {
        function makeRequest(overrides: Partial<HttpRequest> = {}): HttpRequest {
            return {
                socket: { remoteAddress: "10.0.0.5" },
                headers: {},
                ...overrides,
            } as unknown as HttpRequest;
        }

        it("returns the socket remoteAddress when no trustedProxies are configured", () => {
            const req = makeRequest({ headers: { "x-forwarded-for": "1.2.3.4" } });
            expect(NetUtils.getIPAddress(req)).toBe("10.0.0.5");
        });

        it("returns the socket remoteAddress when trustedProxies is provided but empty", () => {
            const req = makeRequest({ headers: { "x-forwarded-for": "1.2.3.4" } });
            expect(NetUtils.getIPAddress(req, [])).toBe("10.0.0.5");
        });

        it("ignores forwarding headers when remoteAddress is not in trustedProxies", () => {
            const req = makeRequest({ headers: { "x-forwarded-for": "1.2.3.4" } });
            expect(NetUtils.getIPAddress(req, ["9.9.9.9"])).toBe("10.0.0.5");
        });

        it("ignores forwarding headers when remoteAddress is undefined", () => {
            const req = makeRequest({ socket: {}, headers: { "x-forwarded-for": "1.2.3.4" } });
            expect(NetUtils.getIPAddress(req, ["10.0.0.5"])).toBeUndefined();
        });

        it("prefers x-original-forwarded-for when the proxy is trusted", () => {
            const req = makeRequest({
                headers: {
                    "x-original-forwarded-for": "1.1.1.1",
                    "x-forwarded-for": "2.2.2.2",
                    "x-real-ip": "3.3.3.3",
                },
            });
            expect(NetUtils.getIPAddress(req, ["10.0.0.5"])).toBe("1.1.1.1");
        });

        it("falls back to x-forwarded-for when x-original-forwarded-for is absent", () => {
            const req = makeRequest({
                headers: { "x-forwarded-for": "2.2.2.2", "x-real-ip": "3.3.3.3" },
            });
            expect(NetUtils.getIPAddress(req, ["10.0.0.5"])).toBe("2.2.2.2");
        });

        it("falls back to x-real-ip when neither forwarded-for header is present", () => {
            const req = makeRequest({ headers: { "x-real-ip": "3.3.3.3" } });
            expect(NetUtils.getIPAddress(req, ["10.0.0.5"])).toBe("3.3.3.3");
        });

        it("falls back to remoteAddress when the proxy is trusted but no forwarding headers are set", () => {
            const req = makeRequest({ headers: {} });
            expect(NetUtils.getIPAddress(req, ["10.0.0.5"])).toBe("10.0.0.5");
        });
    });

    describe("lookupIPAddress", () => {
        it("returns the host directly when it is already an IPv4 address", async () => {
            const result = await NetUtils.lookupIPAddress("http://127.0.0.1:8080");
            expect(result).toBe("127.0.0.1");
        });

        it("returns the host directly when it is already an IPv6 address", async () => {
            const result = await NetUtils.lookupIPAddress("http://[::1]:8080");
            expect(result).toBe("::1");
        });

        it("resolves a domain name via DNS", async () => {
            const result = await NetUtils.lookupIPAddress("http://example.com", 4);
            expect(result).toBe("93.184.216.34");
        });

        it("returns undefined when DNS lookup fails", async () => {
            const result = await NetUtils.lookupIPAddress("http://does-not-resolve.invalid");
            expect(result).toBeUndefined();
        });

        it("returns undefined when the URL cannot be parsed", async () => {
            const result = await NetUtils.lookupIPAddress("not a url");
            expect(result).toBeUndefined();
        });

        it("returns undefined when the host matches neither an IP nor a domain name pattern", async () => {
            const result = await NetUtils.lookupIPAddress("http://_invalid_host_/path");
            expect(result).toBeUndefined();
        });
    });
});
