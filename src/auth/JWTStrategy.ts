////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { JWTUtils, ObjectDecorators, type JWTUtilsConfig, type JWTUser, type JWTPayload } from "@rapidrest/core";
import type { HttpRequest, HttpResponse } from "../http/types.js";
import dayjs from "dayjs";
import { createRequire } from "module";
import type { AuthResult } from "./AuthStrategy.js";
import { NetUtils } from "../NetUtils.js";
const { Config, Init, Logger } = ObjectDecorators;
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

    @Logger
    private logger: any;

    public readonly name: string = "jwt";

    private options: JWTStrategyOptions;
    private readonly _headerSchemeRegex: RegExp;

    constructor(options: JWTStrategyOptions = new JWTStrategyOptions()) {
        this.options = options;
        this.options.headerKey = options.headerKey.toLowerCase();
        this._headerSchemeRegex = new RegExp("^" + this.options.headerScheme + "$", "i");
    }

    @Init
    private init(): void {
        // Signed-cookie verification was never implemented (req.signedCookies is always `{}` in both HTTP
        // adapters — see getAuthToken() below), so enabling this option silently disables cookie-based
        // authentication entirely rather than adding the extra verification an operator would expect from the
        // name. Warn loudly at startup instead of letting that be discovered as a confusing runtime auth failure.
        if (this.options.cookieSecure) {
            this.logger?.warn(
                "JWTStrategyOptions.cookieSecure is enabled, but signed-cookie verification is not implemented. " +
                    "Cookie-based authentication is disabled while this option is set to true — set it to false " +
                    "to authenticate via the plain `jwt` cookie instead.",
            );
        }

        // Defense-in-depth only: the underlying jsonwebtoken library already restricts verification to
        // algorithms compatible with the configured key's type when `options.algorithms` is left unset, so
        // this isn't currently exploitable. Pinning it explicitly for the common case of a plain symmetric
        // secret removes any reliance on that library default. Left untouched for PEM/asymmetric keys —
        // there's no reliable way to guess the intended algorithm family (RS/ES/PS, key size) from the key's
        // runtime shape alone, and guessing wrong would break those apps' verification entirely.
        if (
            this.config &&
            !this.config.options?.algorithms &&
            typeof this.config.secret === "string" &&
            !this.config.secret.includes("BEGIN")
        ) {
            this.config.options = { ...this.config.options, algorithms: ["HS256"] };
        }
    }

    /**
     * Scans the provided request object for an authentication token this strategy can process.
     * @param req The request to scan for an auth token.
     * @returns The auth token if found, otherwise `undefined`.
     */
    private getAuthToken(req: HttpRequest): string | undefined {
        let authToken: string | undefined = undefined;

        // Tokens should be found in this order: Query Parameter => Authorization => Cookie
        // Check the query parameter (only when explicitly opted in — tokens in URLs appear in logs)
        if (
            (this.options.allowQueryParam || this.config?.allowQueryParam) &&
            this.options.queryKey &&
            req.query &&
            this.options.queryKey in req.query
        ) {
            authToken = req.query[this.options.queryKey] as string;
        }

        // Next check the headers, but only if a higher-precedence source (the query parameter above)
        // hasn't already supplied a token — a later-checked, lower-precedence source must never override
        // an earlier one. It's possible there is more than one header value defined; loop through each of
        // them until we have a verified token.
        if (!authToken && this.options.headerKey && this.options.headerKey in req.headers) {
            const value: string | string[] | undefined = req.headers[this.options.headerKey];
            const headers: string[] = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];

            // Loop through the headers looking for Authentication and our scheme
            for (const header of headers) {
                const parts: string[] = header.split(" ");
                if (parts.length !== 2) {
                    continue;
                }

                if (!this._headerSchemeRegex.test(parts[0])) {
                    continue;
                }

                authToken = parts[1];
                break;
            }
        }

        // Check the cookie header — lowest precedence, so only consulted if neither the query parameter
        // nor the header supplied a token above.
        // TODO Decrypt the signed cookie — until this is implemented, req.signedCookies is always `{}` (see
        // both HTTP adapters), so this branch never finds a token; init() warns at startup when cookieSecure
        // is enabled so that's not a silent failure.
        if (!authToken && this.options.cookieSecure && this.options.cookieName && req.signedCookies) {
            const cookieToken = req.signedCookies[this.options.cookieName];
            if (cookieToken) {
                authToken = cookieToken;
            }
        }
        if (!authToken && !this.options.cookieSecure && this.options.cookieName && req.cookies) {
            const cookieToken = req.cookies[this.options.cookieName];
            if (cookieToken) {
                authToken = cookieToken;
            }
        }

        return authToken;
    }

    public async authenticate(req: HttpRequest, res: HttpResponse): Promise<JWTAuthResult | undefined> {
        let user: JWTUser | undefined = undefined;
        let authPayload: JWTPayload | undefined = undefined;
        let authToken: string | undefined = this.getAuthToken(req);

        // If the token has been found, verify it.
        if (authToken && authToken.length > 0) {
            const payload: JWTPayload = await JWTUtils.decodeToken(this.config, authToken);
            // If the verification succeeded clear out any existing error, we have success
            if (payload && payload.profile) {
                user = payload.profile as JWTUser;
            }
            authPayload = payload;
            if (user) {
                // If sessions are enabled, update the stored information about the authenticated user
                if (req.session) {
                    const now = Date.now();
                    req.session.ip = NetUtils.getIPAddress(req);
                    req.session.lastAccess = now;
                    req.session.lastLogin = req.session.lastLogin ?? now;
                    req.session.userUid = user.uid;
                }

                return {
                    data: authToken,
                    method: this.name,
                    payload: authPayload,
                    tokenFound: authToken !== undefined,
                    user,
                };
            }
        }

        return undefined;
    }

    public authenticateSync(req: HttpRequest, res: HttpResponse): JWTAuthResult | undefined {
        let user: JWTUser | undefined = undefined;
        let authPayload: JWTPayload | undefined = undefined;
        let authToken: string | undefined = this.getAuthToken(req);

        // If the token has been found, verify it.
        if (authToken && authToken.length > 0) {
            const payload: JWTPayload = JWTUtils.decodeTokenSync(this.config, authToken);
            // If the verification succeeded clear out any existing error, we have success
            if (payload && payload.profile) {
                user = payload.profile as JWTUser;
            }
            authPayload = payload;
            if (user) {
                // If sessions are enabled, update the stored information about the authenticated user
                if (req.session) {
                    const now = Date.now();
                    req.session.ip = NetUtils.getIPAddress(req);
                    req.session.lastAccess = now;
                    req.session.lastLogin = req.session.lastLogin ?? now;
                    req.session.userUid = user.uid;
                }

                return {
                    data: authToken,
                    method: this.name,
                    payload: authPayload,
                    tokenFound: authToken !== undefined,
                    user,
                };
            }
        }

        return undefined;
    }
}
