////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { JWTUtils, JWTUtilsConfig, JWTUser, JWTPayload, ObjectDecorators } from "@rapidrest/core";
import { ApiErrorMessages } from "../ApiErrors.js";
import type { HttpRequest, HttpResponse } from "../http/types.js";
import dayjs from "dayjs";
import { createRequire } from "module";
import { AuthResult } from "./AuthStrategy.js";
const { Config } = ObjectDecorators;
const _require = createRequire(process.cwd() + "/package.json");
const duration = _require("dayjs/plugin/duration");
dayjs.extend(duration);

/**
 * Describes the configuration options that can be used to initialize JWTStrategy.
 *
 * @author Jean-Philippe Steinmetz
 */
export class JWTStrategyOptions {
    /** The configuration options to pass to the JWTUtils library during token verification. */
    public config?: JWTUtilsConfig;
    /** The name of the header to look for when performing header based authentication. Default value is `Authorization`. */
    public headerKey: string = "authorization";
    /** The authorization scheme type when using header based authentication. Default value is `jwt`. */
    public headerScheme: string = "(jwt|bearer)";
    /** The name of the cookie to retrieve the token from when using cookie based authentication. Default value is `jwt`. */
    public cookieName: string = "jwt";
    /** The name of the secured cookie to retreive the token from when using cookie based authentication. */
    public cookieSecure: boolean = false;
    /** The name of the request query parameter to retrieve the token from when using query based authentication. Default value is `auth_token`. */
    public queryKey: string = "auth_token";
    /**
     * Set to `true` to allow tokens to be supplied via the `queryKey` URL parameter.
     * Disabled by default — query parameters appear in server logs, browser history, and
     * Referer headers, which permanently exposes tokens outside the application.
     */
    public allowQueryParam: boolean = false;
}

/** Result returned by `JWTStrategy.authenticate()`. */
export interface JWTAuthResult extends AuthResult {
    /**
     * `true` when at least one credential (header, query param, or cookie) was present in
     * the request, even if it was ultimately invalid. Distinguishes "no token submitted" from
     * "bad token submitted" — useful for deciding whether to reject early vs. fall through to
     * an alternative auth path (e.g. WebSocket message-based LOGIN).
     */
    tokenFound?: boolean;
}

/**
 * JWT authentication strategy. Performs JWT verification and searches for a token by one of the
 * following methods (in order of precedence):
 * * Query Parameter
 * * Authorization Header
 * * Cookie
 *
 * This class no longer extends `passport-strategy`; it is used directly by route middleware
 * and returns a plain result object instead of calling Passport callbacks.
 *
 * @author Jean-Philippe Steinmetz
 */
export class JWTStrategy {
    @Config("auth")
    private config: any;

    public readonly name: string = "jwt";

    private options: JWTStrategyOptions;

    constructor(options: JWTStrategyOptions = new JWTStrategyOptions()) {
        this.options = options;
        this.options.headerKey = options.headerKey.toLowerCase();
    }

    /**
     * Attempts to authenticate the incoming request by extracting and verifying a JWT token.
     * Returns a `JWTAuthResult` describing the outcome.
     */
    public authenticate(req: HttpRequest, res: HttpResponse, required?: boolean): JWTAuthResult | undefined {
        let error: string = "";
        let user: JWTUser | undefined = undefined;
        let authPayload: JWTPayload | undefined = undefined;
        let authToken: string | undefined = undefined;
        let tokenFound: boolean = false;

        // Tokens should be found in this order: Query Parameter => Authorization => Cookie
        // Check the query parameter (only when explicitly opted in — tokens in URLs appear in logs)
        if ((this.options.allowQueryParam || this.config?.allowQueryParam) && this.options.queryKey && req.query && this.options.queryKey in req.query) {
            let token: string = req.query[this.options.queryKey] as string;
            tokenFound = true;

            const payload: JWTPayload = JWTUtils.decodeToken(this.config, token);
            // If the verification succeeded clear out any existing error, we have success
            if (payload && payload.profile) {
                error = "";
                user = payload.profile as JWTUser;
            }
            // Store the payload in the request in case someone needs it
            authPayload = payload;
            // Store the full token in the request in case someone needs it
            authToken = token;
        }

        // Next check the headers. It's possible there is more than one header value defined. Loop through each of
        // them until we have a verified token.
        if (!user && this.options.headerKey && this.options.headerKey in req.headers) {
            tokenFound = true;
            const value: string | string[] | undefined = req.headers[this.options.headerKey];
            const headers: string[] = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];

            // Loop throught th
            for (const header in headers) {
                const parts: string[] = headers[header].split(" ");
                if (parts.length !== 2) {
                    error = ApiErrorMessages.AUTH_FAILED;
                    continue;
                }

                if (!parts[0].match(new RegExp("^" + this.options.headerScheme + "$", "i"))) {
                    error = ApiErrorMessages.AUTH_FAILED;
                    continue;
                }

                let token: string = parts[1];
                const payload: JWTPayload = JWTUtils.decodeToken(this.config, token);
                // If the verification succeeded clear out any existing error, we have success
                if (payload && payload.profile) {
                    error = "";
                    user = payload.profile as JWTUser;
                    authPayload = payload;
                    authToken = token;
                    // No need to continue checking remaining headers. We have our success.
                    break;
                }
                authPayload = payload;
                authToken = token;
            }
        }

        // Check the cookie header
        let token: string = "";
        if (!user && this.options.cookieSecure && this.options.cookieName && req.signedCookies) {
            // TODO Decrypt the signed cookie
            token = req.signedCookies[this.options.cookieName];
        }
        if (!user && !this.options.cookieSecure && this.options.cookieName && req.cookies) {
            token = req.cookies[this.options.cookieName];
        }

        // If the token has been found, verify it.
        if (!user && token && token.length > 0) {
            tokenFound = true;
            try {
                const payload: JWTPayload = JWTUtils.decodeToken(this.config, token);
                // If the verification succeeded clear out any existing error, we have success
                if (payload && payload.profile) {
                    error = "";
                    user = payload.profile as JWTUser;
                }
                authPayload = payload;
                authToken = token;
            } catch (err: any) {
                error = err;
            }
        }

        if (user) {
            return { data: authToken, method: this.name, payload: authPayload, tokenFound, user };
        }

        if (required) {
            throw new Error("Invalid or missing auth token.");
        }

        return undefined;
    }
}
