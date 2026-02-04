///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { promises as dns, LookupAddress } from "dns";
import { Request as XRequest } from "express";

/**
 * Provides common utilities and functions for working with networking related problems.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class NetUtils {
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
            if ((matches = tmp.host.match(/^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):?([0-9]+)?$/)) ||
                (matches = tmp.host.match(/^\[?((::)?([0-9a-fA-F]{1,4}:){0,7}:?([0-9a-fA-F]{1,4}:?){1,7})\]?:?([0-9]+)?$/))) {
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
     * Extracts the IP address from a given url or HTTP request.
     *
     * @param urlOrRequest The url or HTTP request to extract the IP from.
     * @returns A `string` containing the IP address if found, otherwise `undefined`.
     */
    public static getIPAddress(urlOrRequest: string | XRequest): string | undefined {
        let result: string | undefined = undefined;

        if (typeof urlOrRequest === "string") {
            // Check that for IPv4/IPv6 addresses
            let matches: RegExpMatchArray | null = null;
            if ((matches = urlOrRequest.match(/^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):?([0-9]+)?$/)) ||
                (matches = urlOrRequest.match(/^\[?((::)?([0-9a-fA-F]{1,4}:){0,7}:?([0-9a-fA-F]{1,4}:?){1,7})\]?:?([0-9]+)?$/))) {
                result = matches[1];
            }
            // Maybe it's a URL?
            else {
                try {
                    const tmp: URL = new URL(urlOrRequest);
                    // Check that the host isn't already an IPv4/IPv6 address
                    let matches: RegExpMatchArray | null = null;
                    if ((matches = tmp.host.match(/^((?:[0-9]{1,3}\.){3}[0-9]{1,3}):?([0-9]+)?$/)) ||
                        (matches = tmp.host.match(/^\[?((::)?([0-9a-fA-F]{1,4}:){0,7}:?([0-9a-fA-F]{1,4}:?){1,7})\]?:?([0-9]+)?$/))) {
                        result = matches[1];
                    } else {
                        result = tmp.host;
                    }
                } catch (err) {
                    // Do nothing
                }
            }
        } else {
            if (urlOrRequest.headers["x-original-forwarded-for"]) {
                result = urlOrRequest.headers["x-original-forwarded-for"] as string;
        }
            else if (urlOrRequest.headers["x-forwarded-for"]) {
                result = urlOrRequest.headers["x-forwarded-for"] as string;
            }
            else if (urlOrRequest.headers["x-real-ip"]) {
                result = urlOrRequest.headers["x-real-ip"] as string;
            }
            else if (urlOrRequest.socket) {
                result = urlOrRequest.socket.remoteAddress;
            }
        }

        return result;
    }
}