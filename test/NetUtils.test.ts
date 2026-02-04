///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { describe, it, expect } from "vitest";
import { NetUtils } from "../src/NetUtils.js";

const YahooIPs: string[] = [
    "74.6.231.21",
    "98.137.11.163",
    "74.6.143.26",
    "98.137.11.164",
    "74.6.231.20",
    "74.6.143.25"
];

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
});