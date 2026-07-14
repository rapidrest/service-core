////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
////////////////////////////////////////////////////////////////////////////////
import type { JWTUser } from "@rapidrest/core";
import type { HttpRequest, HttpResponse } from "../http/types.js";
import type { AuthResult, AuthStrategy } from "./AuthStrategy.js";

/**
 * Describes the configuration options that can be used to initialize BasicStrategy.
 *
 * @author Jean-Philippe Steinmetz
 */
export class BasicStrategyOptions {
    /** The name of the header to look for when performing header based authentication. Default value is `Authorization`. */
    public headerKey: string = "authorization";
    /** The authorization scheme type when using header based authentication. Default value is `jwt`. */
    public headerScheme: string = "basic";
    /** The name of the request query parameter to retrieve the token from when using query based authentication. Default value is `auth_basic`. */
    public queryKey: string = "auth_basic";
    /**
     * Set to `true` to allow credentials to be supplied via the `queryKey` URL parameter.
     * Disabled by default — query parameters appear in server logs, browser history, and
     * Referer headers, which permanently exposes credentials outside the application.
     */
    public allowQueryParam: boolean = false;
    /** Override this function to handle asynchronous (non-blocking) verification of the login info. */
    public verify(uid: string, secret: string): JWTUser | Promise<JWTUser | undefined> | undefined {
        throw new Error("Did you forget to override BasicStrategyOptions.verify?");
    }
    /** Override this function to handle synchronous (blocking) verification of the login info. */
    public verifySync(uid: string, secret: string): JWTUser | undefined {
        throw new Error("Did you forget to override BasicStrategyOptions.verifySync?");
    }
}

/**
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class BasicStrategy implements AuthStrategy {
    public readonly name: string = "basic";
    private options: BasicStrategyOptions;

    constructor(options: BasicStrategyOptions = new BasicStrategyOptions()) {
        this.options = options;
    }

    private getLoginInfo(req: HttpRequest): any {
        let loginInfo: string = "";

        // Login info should be found in this order: Query Parameter => Authorization
        // Check the query parameter (only when explicitly opted in — tokens in URLs appear in logs)
        if (this.options.allowQueryParam && this.options.queryKey && req.query && this.options.queryKey in req.query) {
            loginInfo = req.query[this.options.queryKey] as string;
        }

        // Next check the headers. It's possible there is more than one header value defined. Loop through each of
        // them until we have a verified login info.
        if (!loginInfo && this.options.headerKey && this.options.headerKey in req.headers) {
            const value: string | string[] | undefined = req.headers[this.options.headerKey];
            const headers: string[] = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];

            // Loop throught th
            for (const header in headers) {
                const parts: string[] = headers[header].split(" ");
                if (parts.length !== 2) {
                    continue;
                }

                if (!parts[0].match(new RegExp("^" + this.options.headerScheme + "$", "i"))) {
                    continue;
                }

                loginInfo = parts[1];
            }
        }

        return loginInfo;
    }

    public async authenticate(
        req: HttpRequest,
        res: HttpResponse,
        required?: boolean,
    ): Promise<AuthResult | undefined> {
        let loginInfo: string = this.getLoginInfo(req);

        // If the login info has been found, verify it.
        if (loginInfo && loginInfo.length > 0) {
            const info: string = Buffer.from(loginInfo, "base64").toString("utf-8");
            const parts: string[] = info.split(":");
            if (parts.length !== 2) {
                throw new Error("Invalid username or password.");
            }
            const user: JWTUser | undefined = await this.options.verify(parts[0], parts[1]);
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
            throw new Error("Invalid username or password.");
        }

        return undefined;
    }

    public authenticateSync(req: HttpRequest, res: HttpResponse, required?: boolean): AuthResult | undefined {
        let loginInfo: string = this.getLoginInfo(req);

        // If the login info has been found, verify it.
        if (loginInfo && loginInfo.length > 0) {
            const info: string = Buffer.from(loginInfo, "base64").toString("utf-8");
            const parts: string[] = info.split(":");
            if (parts.length !== 2) {
                throw new Error("Invalid username or password.");
            }
            const user: JWTUser | undefined = this.options.verifySync(parts[0], parts[1]);
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
            throw new Error("Invalid username or password.");
        }

        return undefined;
    }
}
