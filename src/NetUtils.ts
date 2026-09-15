///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { promises as dns, LookupAddress } from "dns";
import { BlockList, isIP } from "net";
import type { HttpRequest as XRequest } from "./http/index.js";

/** The list of trusted proxies accepted by `NetUtils`: an array of entries, or one comma-separated string. */
export type TrustedProxies = readonly string[] | string;

/** Maximum number of distinct `trustedProxies` lists whose compiled `BlockList` is cached at once. */
const MAX_CACHED_PROXY_LISTS = 32;

/**
 * Provides common utilities and functions for working with networking related problems.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class NetUtils {
    /** Compiled `trustedProxies` lists, keyed by their normalized, `|`-joined entries. */
    private static readonly proxyListCache: Map<string, BlockList> = new Map();

    /**
     * Performs DNS lookup of the IP address from a given url.
     *
     * @param url The url to lookup the IP from.
     * @param family ip family used for dns lookup
     * @returns A `string` containing the IP address if found, otherwise `undefined`.
     */
    public static async lookupIPAddress(url: string, family: number = 4): Promise<string | undefined> {
        let result: string | undefined = undefined;

        try {
            const tmp: URL = new URL(url);
            // Check that the host isn't already an IPv4/IPv6 address
            let matches: RegExpMatchArray | null = null;
            if (
                (matches = tmp.host.match(/^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):?([0-9]+)?$/)) ||
                (matches = tmp.host.match(
                    /^\[?((::)?([0-9a-fA-F]{1,4}:){0,7}:?([0-9a-fA-F]{1,4}:?){1,7})\]?:?([0-9]+)?$/,
                ))
            ) {
                result = matches[1];
            } else {
                // Attempt to resolve the domain name
                matches = tmp.host.match(/^((?:[A-Za-z0-9-]+\.?)+[A-Za-z0-9]{1,3})(:\d{1,5})?$/);
                if (matches) {
                    const lookup: LookupAddress = await dns.lookup(matches[1], family);
                    result = lookup.address;
                }
            }
        } catch (err) {
            // Do nothing
        }

        return result;
    }

    /**
     * Parses and canonicalizes a single IP address so that two spellings of the same address always compare
     * equal. Accepts an optional port (`1.2.3.4:80`, `[::1]:80`), brackets and an IPv6 zone id, all of which are
     * removed.
     *
     * - IPv4 addresses are returned unchanged (e.g. `10.0.0.1`).
     * - IPv4-mapped IPv6 addresses are unmapped to plain IPv4, in either spelling: `::ffff:127.0.0.1` and uWS's
     * fully expanded `0000:0000:0000:0000:0000:ffff:7f00:0001` both become `127.0.0.1`.
     * - Other IPv6 addresses are returned in RFC 5952 form: lowercase, no leading zeros, and the longest run of
     * two or more zero groups compressed to `::` (e.g. `2001:0DB8:0:0:0:0:0:1` becomes `2001:db8::1`).
     *
     * @param value The address to normalize.
     * @returns The canonical address, or `undefined` if `value` is not a valid IPv4/IPv6 address.
     */
    public static normalizeIP(value: string | undefined | null): string | undefined {
        if (typeof value !== "string") {
            return undefined;
        }

        let addr: string = value.trim();
        const bracketed: RegExpMatchArray | null = addr.match(/^\[([^\]]+)\](?::\d{1,5})?$/);
        if (bracketed) {
            addr = bracketed[1];
        } else {
            const ipv4WithPort: RegExpMatchArray | null = addr.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d{1,5}$/);
            if (ipv4WithPort) {
                addr = ipv4WithPort[1];
            }
        }

        const zoneIdx: number = addr.indexOf("%");
        if (zoneIdx >= 0) {
            addr = addr.slice(0, zoneIdx);
        }

        const family: number = isIP(addr);
        if (family === 4) {
            return addr;
        } else if (family !== 6) {
            return undefined;
        }

        const groups: number[] = NetUtils.expandIPv6(addr);
        if (groups[5] === 0xffff && groups.slice(0, 5).every((g) => g === 0)) {
            return `${groups[6] >> 8}.${groups[6] & 0xff}.${groups[7] >> 8}.${groups[7] & 0xff}`;
        }
        return NetUtils.compressIPv6(groups);
    }

    /** Expands an already validated IPv6 address (no zone id) into its eight 16-bit groups. */
    private static expandIPv6(addr: string): number[] {
        const toGroups = (part: string): number[] => {
            if (part.length === 0) {
                return [];
            }
            const result: number[] = [];
            for (const piece of part.split(":")) {
                if (piece.includes(".")) {
                    // Embedded IPv4 tail, e.g. `::ffff:1.2.3.4`
                    const [a, b, c, d] = piece.split(".").map((n) => parseInt(n, 10));
                    result.push((a << 8) | b, (c << 8) | d);
                } else {
                    result.push(parseInt(piece, 16));
                }
            }
            return result;
        };

        const sep: number = addr.indexOf("::");
        if (sep < 0) {
            return toGroups(addr);
        }
        const head: number[] = toGroups(addr.slice(0, sep));
        const tail: number[] = toGroups(addr.slice(sep + 2));
        return [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
    }

    /** Formats eight 16-bit groups as an RFC 5952 IPv6 address. */
    private static compressIPv6(groups: number[]): string {
        let bestStart = -1;
        let bestLen = 0;
        for (let i = 0; i < groups.length;) {
            if (groups[i] !== 0) {
                i++;
                continue;
            }
            let j = i;
            while (j < groups.length && groups[j] === 0) {
                j++;
            }
            if (j - i > bestLen) {
                bestStart = i;
                bestLen = j - i;
            }
            i = j;
        }

        const hex: string[] = groups.map((g) => g.toString(16));
        if (bestLen < 2) {
            return hex.join(":");
        }
        return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLen).join(":")}`;
    }

    /**
     * Compiles (and caches) a `trustedProxies` list into a `BlockList`. Each entry is a single IPv4/IPv6 address or a
     * CIDR range (`10.0.0.0/8`, `fd00::/8`). Entries are normalized the same way as `normalizeIP()`. Invalid entries
     * are ignored.
     */
    private static compileTrustedProxies(trustedProxies: TrustedProxies): BlockList {
        const entries: string[] = (typeof trustedProxies === "string" ? trustedProxies.split(",") : [...trustedProxies])
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter((entry) => entry.length > 0);
        const key: string = entries.join("|");

        const cached: BlockList | undefined = NetUtils.proxyListCache.get(key);
        if (cached) {
            return cached;
        }

        const list: BlockList = new BlockList();
        for (const entry of entries) {
            const slash: number = entry.indexOf("/");
            if (slash >= 0) {
                const prefix: number = Number(entry.slice(slash + 1));
                const network: string | undefined = NetUtils.normalizeIP(entry.slice(0, slash));
                const family: number = network ? isIP(network) : 0;
                const maxPrefix: number = family === 4 ? 32 : 128;
                if (family !== 0 && Number.isInteger(prefix) && prefix >= 0 && prefix <= maxPrefix) {
                    list.addSubnet(network!, prefix, family === 4 ? "ipv4" : "ipv6");
                }
            } else {
                const address: string | undefined = NetUtils.normalizeIP(entry);
                if (address) {
                    list.addAddress(address, isIP(address) === 4 ? "ipv4" : "ipv6");
                }
            }
        }

        if (NetUtils.proxyListCache.size >= MAX_CACHED_PROXY_LISTS) {
            NetUtils.proxyListCache.clear();
        }
        NetUtils.proxyListCache.set(key, list);
        return list;
    }

    /**
     * Returns `true` if `address` matches an entry of `trustedProxies`. Both sides are normalized first (see
     * `normalizeIP()`), so e.g. `::ffff:10.0.0.1` matches a `10.0.0.1` entry, and CIDR range entries are supported.
     *
     * @param address The address to check.
     * @param trustedProxies The trusted proxy addresses and/or CIDR ranges, as an array or a comma-separated string.
     */
    public static isTrustedProxy(address: string | undefined, trustedProxies?: TrustedProxies): boolean {
        const normalized: string | undefined = NetUtils.normalizeIP(address);
        if (!normalized || !trustedProxies || trustedProxies.length === 0) {
            return false;
        }
        const list: BlockList = NetUtils.compileTrustedProxies(trustedProxies);
        return list.check(normalized, isIP(normalized) === 4 ? "ipv4" : "ipv6");
    }

    /**
     * Returns the IP address of the client that made the given request, in canonical form (see `normalizeIP()`).
     * This is the address that should be used for rate limiting, audit logs and any other per-client keying.
     *
     * The result is determined as follows:
     * 1. If the socket's remote address is not a valid IP, it is returned as-is (or `undefined` if empty) and no
     * header is consulted.
     * 2. If `trustedProxies` is empty or the remote address is not a trusted proxy, the remote address is returned.
     * Forwarding headers are ignored, so an untrusted client cannot choose its own address.
     * 3. Otherwise `X-Forwarded-For` is walked from right to left (every `X-Forwarded-For` value is taken into
     * account). Addresses of trusted proxies are skipped and the first address that is not a trusted proxy is
     * returned. If an entry is not a valid IP address, the walk stops and the last trusted hop is returned, since
     * nothing left of it can be trusted. If every entry is a trusted proxy, the left-most entry is returned.
     * 4. If there is no `X-Forwarded-For` header, a valid `X-Real-IP` header is returned, else the remote address.
     *
     * `X-Original-Forwarded-For` is never consulted.
     *
     * @param req The HTTP request to extract the client address from.
     * @param trustedProxies The addresses and/or CIDR ranges of reverse proxies whose forwarding headers are
     * trusted, as an array or a comma-separated string.
     * @returns The client's canonical IP address, or `undefined` if the request has no remote address.
     */
    public static getClientIP(req: XRequest, trustedProxies?: TrustedProxies): string | undefined {
        const rawRemote: string | undefined = req.socket?.remoteAddress;
        const remote: string | undefined = NetUtils.normalizeIP(rawRemote);
        if (!remote) {
            return rawRemote || undefined;
        }
        if (!NetUtils.isTrustedProxy(remote, trustedProxies)) {
            return remote;
        }

        const headerEntries = (value: string | string[] | undefined): string[] =>
            (Array.isArray(value) ? value.join(",") : (value ?? ""))
                .split(",")
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0);

        const forwardedFor: string[] = headerEntries(req.headers["x-forwarded-for"]);
        if (forwardedFor.length > 0) {
            let lastTrusted: string = remote;
            for (let i = forwardedFor.length - 1; i >= 0; i--) {
                const hop: string | undefined = NetUtils.normalizeIP(forwardedFor[i]);
                if (!hop) {
                    return lastTrusted;
                }
                if (!NetUtils.isTrustedProxy(hop, trustedProxies)) {
                    return hop;
                }
                lastTrusted = hop;
            }
            return lastTrusted;
        }

        const realIp: string[] = headerEntries(req.headers["x-real-ip"]);
        return NetUtils.normalizeIP(realIp[realIp.length - 1]) ?? remote;
    }

    /**
     * Extracts the IP address from a given url or HTTP request.
     *
     * For an HTTP request this is identical to `getClientIP()`: forwarding headers are only trusted when the
     * direct connection's remote address is one of `trustedProxies`, and the result is normalized.
     *
     * @param urlOrRequest The url or HTTP request to extract the IP from.
     * @param trustedProxies Optional list of proxy IP addresses and/or CIDR ranges whose forwarding headers should
     * be trusted.
     * @returns A `string` containing the IP address if found, otherwise `undefined`.
     */
    public static getIPAddress(urlOrRequest: string | XRequest, trustedProxies?: TrustedProxies): string | undefined {
        let result: string | undefined = undefined;

        if (typeof urlOrRequest === "string") {
            // Check that for IPv4/IPv6 addresses
            let matches: RegExpMatchArray | null = null;
            if (
                (matches = urlOrRequest.match(/^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):?([0-9]+)?$/)) ||
                (matches = urlOrRequest.match(
                    /^\[?((::)?([0-9a-fA-F]{1,4}:){0,7}:?([0-9a-fA-F]{1,4}:?){1,7})\]?:?([0-9]+)?$/,
                ))
            ) {
                result = matches[1];
            }
            // Maybe it's a URL?
            else {
                try {
                    const tmp: URL = new URL(urlOrRequest);
                    // Check that the host isn't already an IPv4/IPv6 address
                    let matches: RegExpMatchArray | null = null;
                    if (
                        (matches = tmp.host.match(/^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):?([0-9]+)?$/)) ||
                        (matches = tmp.host.match(
                            /^\[?((::)?([0-9a-fA-F]{1,4}:){0,7}:?([0-9a-fA-F]{1,4}:?){1,7})\]?:?([0-9]+)?$/,
                        ))
                    ) {
                        result = matches[1];
                    } else {
                        result = tmp.host;
                    }
                } catch (err) {
                    // Do nothing
                }
            }
        } else {
            result = NetUtils.getClientIP(urlOrRequest, trustedProxies);
        }

        return result;
    }
}
