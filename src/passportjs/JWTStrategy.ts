////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Strategy } from "passport-strategy";
import { JWTUtils, JWTUtilsConfig, JWTUser, JWTPayload, ApiError } from "@rapidrest/core";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration.js";
dayjs.extend(duration);

/**
 * Describes the configuration options that can be used to initialize JWTStrategy.
 *
 * @author Jean-Philippe Steinmetz
 */
export class JWTStrategyOptions {
    /** Set to true to allow a failure to be processed as a success, otherwise set to false. Default value is `false`. */
    public allowFailure: boolean = false;
    /** The configuration options to pass to the JWTUtils library during token verification. */
    public config: JWTUtilsConfig = { secret: "" };
    /** The name of the header to look for when performing header based authentication. Default value is `Authorization`. */
    public headerKey: string = "authorization";
    /** The authorization scheme type when using header based authentication. Default value is `jwt`. */
    public headerScheme: string = "(jwt|bearer)";
    /** The name of the cookie to retrieve the token from when using cookie based authentication. Default value is `jwt`. */
    public cookieName: string = "jwt";
    /** The name of the secured cookie to retreive the token from when using cookie based authentication. */
    public cookieSecure: boolean = false;
    /** The name of the requesty query parameter to retreive the token from when using query based authentication. Default value is `jwt_token`. */
    public queryKey: string = "jwt_token";
}

/**
 * Passport strategy for handling JSON Web Token authentication. This strategy performs JWT verification and will
 * search for a token by one of the following methods (in order of precedence).
 * * Cookie
 * * Query Parameter
 * * Header
 *
 * @author Jean-Philippe Steinmetz
 */
export class JWTStrategy extends Strategy {
    private options: JWTStrategyOptions;

    constructor(options: JWTStrategyOptions) {
        super();
        this.options = options;
        this.options.headerKey = options.headerKey.toLowerCase();
    }

    public authenticate(req: any, options?: any): void {
        options = options || {};
        let error: string = "";
        let user: JWTUser | undefined = undefined;

        // Tokens should be found in this order: Query Parameter => Authorization => Cookie
        // Check the query parameter
        if (this.options.queryKey && req.query && this.options.queryKey in req.query) {
            let token: string = req.query[this.options.queryKey] as string;

            try {
                const payload: JWTPayload = JWTUtils.decodeToken(this.options.config, token);
                // If the verification succeeded clear out any existing error, we have success
                if (payload && payload.profile) {
                    error = "";
                    user = payload.profile as JWTUser;
                }
                // Store the payload in the request in case someone needs it
                req.authPayload = payload;
                // Store the full token in the request in case someone needs it
                req.authToken = token;
            } catch (err: any) {
                error = err;
            }
        }

        // Next check the headers. It's possible there is more than one header value defined. Loop through each of
        // them until we have a verified token.
        if (!user && this.options.headerKey && this.options.headerKey in req.headers) {
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
                try {
                    const payload: JWTPayload = JWTUtils.decodeToken(this.options.config, token);
                    // If the verification succeeded clear out any existing error, we have success
                    if (payload && payload.profile) {
                        error = "";
                        user = payload.profile as JWTUser;
                        // No need to continue checking remaining headers. We have our success.
                        break;
                    }
                    // Store the payload in the request in case someone needs it
                    req.authPayload = payload;
                    // Store the full token in the request in case someone needs it
                    req.authToken = token;
                } catch (err: any) {
                    error = err;
                }
            }
        }

        // Check the cookie header
        let token: string = "";
        if (!user && this.options.cookieSecure && this.options.cookieName && req.signedCookies) {
            // TODO Decrypt the signed cookie
            token = req.signedCookies[this.options.cookieName] as string;
        }
        if (!user && !this.options.cookieSecure && this.options.cookieName && req.cookies) {
            token = req.cookies[this.options.cookieName] as string;
        }

        // If the token has been found, verify it.
        if (!user && token && token.length > 0) {
            try {
                const payload: JWTPayload = JWTUtils.decodeToken(this.options.config, token);
                // If the verification succeeded clear out any existing error, we have success
                if (payload && payload.profile) {
                    error = "";
                    user = payload.profile as JWTUser;
                }
                // Store the payload in the request in case someone needs it
                req.authPayload = payload;
                // Store the full token in the request in case someone needs it
                req.authToken = token;
            } catch (err: any) {
                error = err;
            }
        }

        // Record any final error that occurred.
        if (error.length > 0) {
            this.error(new ApiError(ApiErrors.AUTH_FAILED, 401, error));
        }

        // Did we succeed at decoding a JWT payload?
        if (user) {
            this.success(user);
        }
        // If failure is allowed perform a pass to let prior strategies determine final success
        else if (options.allowFailure) {
            this.pass();
        } else {
            this.fail(undefined, 401);
        }
    }
}
