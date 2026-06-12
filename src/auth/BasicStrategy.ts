////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
////////////////////////////////////////////////////////////////////////////////
import { JWTUser } from "@rapidrest/core";
import { HttpRequest } from "../http/types.js";
import { AuthResult, AuthStrategy } from "./AuthStrategy.js";
import { ApiErrorMessages } from "../ApiErrors.js";

/**
 * Describes the configuration options that can be used to initialize BasicStrategy.
 *
 * @author Jean-Philippe Steinmetz
 */
export class AuthStrategyOptions {
    /** The name of the header to look for when performing header based authentication. Default value is `Authorization`. */
    public headerKey: string = "authorization";
    /** The authorization scheme type when using header based authentication. Default value is `jwt`. */
    public headerScheme: string = "basic";
    /** The name of the requesty query parameter to retreive the token from when using query based authentication. Default value is `auth_token`. */
    public queryKey: string = "auth_basic";
    /** You must override this function to perform validation of the login information. */
    public validate(uid: string, secret: string): JWTUser | undefined {
        return undefined;
    }
}

/**
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class BasicStrategy implements AuthStrategy {
    public readonly name: string = "basic";
    private options: AuthStrategyOptions;

    constructor(options: AuthStrategyOptions = new AuthStrategyOptions()) {
        this.options = options;
    }

    authenticate(req: HttpRequest, required?: boolean): AuthResult | Promise<AuthResult> | undefined {
        let error: string = "";
        let loginFound: boolean = false;
        let loginInfo: string = "";

        // Login info should be found in this order: Query Parameter => Authorization
        // Check the query parameter
        if (this.options.queryKey && req.query && this.options.queryKey in req.query) {
            loginInfo = req.query[this.options.queryKey] as string;
            loginFound = true;
        }

        // Next check the headers. It's possible there is more than one header value defined. Loop through each of
        // them until we have a verified login info.
        if (!loginFound && this.options.headerKey && this.options.headerKey in req.headers) {
            loginFound = true;
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

                loginInfo = parts[1];
            }
        }

        // If the login info has been found, verify it.
        if (loginInfo && loginInfo.length > 0) {
            const info: string = Buffer.from(loginInfo, "base64").toString("utf-8");
            const parts: string[] = info.split(":");
            if (parts.length !== 2) {
                throw new Error("Invalid or missing username of password.");
            }
            const user: JWTUser | undefined = this.options.validate(parts[0], parts[1]);
            if (user) {
                return {
                    data: loginInfo,
                    method: this.name,
                    payload: info,
                    user,
                };
            }
        }

        if (required) {
            throw new Error("Invalid or missing username of password.");
        }

        return undefined;
    }
}
