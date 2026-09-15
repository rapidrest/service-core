///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
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
    "74.6.143.25",
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

        it("never trusts the client-controllable x-original-forwarded-for header", () => {
            const req = makeRequest({
                headers: {
                    "x-original-forwarded-for": "1.1.1.1",
                    "x-forwarded-for": "2.2.2.2",
                    "x-real-ip": "3.3.3.3",
                },
            });
            expect(NetUtils.getIPAddress(req, ["10.0.0.5"])).toBe("2.2.2.2");
            const onlyOriginal = makeRequest({ headers: { "x-original-forwarded-for": "1.1.1.1" } });
            expect(NetUtils.getIPAddress(onlyOriginal, ["10.0.0.5"])).toBe("10.0.0.5");
        });

        it("prefers x-forwarded-for over x-real-ip", () => {
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

        it("returns the right-most untrusted X-Forwarded-For entry, not the whole header", () => {
            // The client prepends a spoofed address; the trusted proxy appends the real peer it saw.
            const req = makeRequest({ headers: { "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" } });
            expect(NetUtils.getClientIP(req, ["10.0.0.5"])).toBe("203.0.113.9");
        });

        it("gives a client rotating a spoofed X-Forwarded-For prefix the same address every time", () => {
            const seen = new Set<string | undefined>();
            for (let i = 0; i < 20; i++) {
                const req = makeRequest({ headers: { "x-forwarded-for": `198.51.100.${i}, 203.0.113.9` } });
                seen.add(NetUtils.getClientIP(req, ["10.0.0.5"]));
            }
            expect([...seen]).toEqual(["203.0.113.9"]);
        });

        it("skips trusted proxy hops, including CIDR ranges, while walking right to left", () => {
            const req = makeRequest({ headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.1.2.3, 10.0.0.7" } });
            expect(NetUtils.getClientIP(req, ["10.0.0.0/8"])).toBe("203.0.113.9");
        });

        it("returns the left-most entry when every hop is a trusted proxy", () => {
            const req = makeRequest({ headers: { "x-forwarded-for": "10.0.0.9, 10.0.0.8" } });
            expect(NetUtils.getClientIP(req, "10.0.0.0/8")).toBe("10.0.0.9");
        });

        it("stops at an invalid entry and returns the last trusted hop", () => {
            const req = makeRequest({ headers: { "x-forwarded-for": "garbage, 10.0.0.8" } });
            expect(NetUtils.getClientIP(req, ["10.0.0.0/8"])).toBe("10.0.0.8");
            const direct = makeRequest({ headers: { "x-forwarded-for": "not-an-ip" } });
            expect(NetUtils.getClientIP(direct, ["10.0.0.5"])).toBe("10.0.0.5");
        });

        it("joins repeated X-Forwarded-For header values and normalizes entries with ports", () => {
            const req = makeRequest({
                headers: { "x-forwarded-for": ["6.6.6.6", "203.0.113.9:5555, ,[::ffff:10.0.0.6]:80"] },
            });
            expect(NetUtils.getClientIP(req, ["10.0.0.5", "10.0.0.6"])).toBe("203.0.113.9");
        });

        it("ignores an invalid x-real-ip value", () => {
            const req = makeRequest({ headers: { "x-real-ip": "nope" } });
            expect(NetUtils.getClientIP(req, ["10.0.0.5"])).toBe("10.0.0.5");
        });

        it("matches uWS's fully expanded IPv4-mapped remote address against an IPv4 trusted proxy", () => {
            const req = makeRequest({
                socket: { remoteAddress: "0000:0000:0000:0000:0000:ffff:7f00:0001" },
                headers: { "x-forwarded-for": "203.0.113.9" },
            });
            expect(NetUtils.getClientIP(req, ["127.0.0.1"])).toBe("203.0.113.9");
            expect(NetUtils.getClientIP(req, ["::ffff:127.0.0.1"])).toBe("203.0.113.9");
            expect(NetUtils.getClientIP(req)).toBe("127.0.0.1");
        });

        it("matches an expanded IPv6 remote address against a compressed trusted proxy entry", () => {
            const req = makeRequest({
                socket: { remoteAddress: "0000:0000:0000:0000:0000:0000:0000:0001" },
                headers: { "x-forwarded-for": "2001:DB8::0:1" },
            });
            expect(NetUtils.getClientIP(req, ["::1"])).toBe("2001:db8::1");
            expect(NetUtils.getClientIP(req, ["::/127"])).toBe("2001:db8::1");
        });

        it("returns a non-IP remote address verbatim without consulting headers", () => {
            const req = makeRequest({
                socket: { remoteAddress: "unix-socket" },
                headers: { "x-forwarded-for": "1.2.3.4" },
            });
            expect(NetUtils.getClientIP(req, ["unix-socket"])).toBe("unix-socket");
            const empty = makeRequest({ socket: { remoteAddress: "" } });
            expect(NetUtils.getClientIP(empty)).toBeUndefined();
        });
    });

    describe("normalizeIP", () => {
        it.each([
            ["127.0.0.1", "127.0.0.1"],
            ["127.0.0.1:8080", "127.0.0.1"],
            [" 10.0.0.1 ", "10.0.0.1"],
            ["::ffff:127.0.0.1", "127.0.0.1"],
            ["0000:0000:0000:0000:0000:ffff:7f00:0001", "127.0.0.1"],
            ["[::ffff:7f00:1]:443", "127.0.0.1"],
            ["::1", "::1"],
            ["[::1]", "::1"],
            ["::", "::"],
            ["1::", "1::"],
            ["2001:0DB8:0000:0000:0000:0000:0000:0001", "2001:db8::1"],
            ["2001:db8:0:1:0:0:0:1", "2001:db8:0:1::1"],
            ["2001:db8:0:1:1:1:1:1", "2001:db8:0:1:1:1:1:1"],
            ["2001:0:0:1:0:0:0:1", "2001:0:0:1::1"],
            ["fe80::1%eth0", "fe80::1"],
            ["::1.2.3.4", "::102:304"],
        ])("normalizes %s to %s", (input, expected) => {
            expect(NetUtils.normalizeIP(input)).toBe(expected);
        });

        it.each([["not-an-ip"], [""], ["1.2.3"], ["999.1.1.1"], ["[1.2.3.4]:80:90"]])(
            "returns undefined for %s",
            (input) => {
                expect(NetUtils.normalizeIP(input)).toBeUndefined();
            },
        );

        it("returns undefined for non-string input", () => {
            expect(NetUtils.normalizeIP(undefined)).toBeUndefined();
            expect(NetUtils.normalizeIP(null)).toBeUndefined();
            expect(NetUtils.normalizeIP(42 as any)).toBeUndefined();
        });
    });

    describe("isTrustedProxy", () => {
        it("supports single addresses, CIDR ranges and comma-separated strings, ignoring invalid entries", () => {
            const proxies = ["bogus", "10.0.0.0/33", "10.0.0.0/abc", "nope/8", "192.168.0.0/16", "fd00::/8", "::1"];
            expect(NetUtils.isTrustedProxy("192.168.4.4", proxies)).toBe(true);
            expect(NetUtils.isTrustedProxy("fd12::1", proxies)).toBe(true);
            expect(NetUtils.isTrustedProxy("0:0:0:0:0:0:0:1", proxies)).toBe(true);
            expect(NetUtils.isTrustedProxy("10.0.0.1", proxies)).toBe(false);
            expect(NetUtils.isTrustedProxy("10.0.0.1", " 10.0.0.1 , 10.0.0.2")).toBe(true);
            expect(NetUtils.isTrustedProxy("10.0.0.1", [42 as any, "10.0.0.1"])).toBe(true);
        });

        it("returns false for an invalid address or an empty list", () => {
            expect(NetUtils.isTrustedProxy("bogus", ["10.0.0.1"])).toBe(false);
            expect(NetUtils.isTrustedProxy(undefined, ["10.0.0.1"])).toBe(false);
            expect(NetUtils.isTrustedProxy("10.0.0.1", [])).toBe(false);
            expect(NetUtils.isTrustedProxy("10.0.0.1", "")).toBe(false);
            expect(NetUtils.isTrustedProxy("10.0.0.1")).toBe(false);
        });

        it("keeps working after the compiled list cache fills up", () => {
            for (let i = 0; i < 40; i++) {
                expect(NetUtils.isTrustedProxy(`10.0.0.${i}`, [`10.0.0.${i}`])).toBe(true);
            }
            expect(NetUtils.isTrustedProxy("10.0.0.1", ["10.0.0.1"])).toBe(true);
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
