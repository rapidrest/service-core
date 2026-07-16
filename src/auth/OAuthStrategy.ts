////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
////////////////////////////////////////////////////////////////////////////////
import axios, { AxiosResponse } from "axios";
import * as crypto from "crypto";
import * as jwt from "jsonwebtoken";
import type { JWTUser } from "@rapidrest/core";
import type { HttpRequest, HttpResponse } from "../http/types.js";
import type { AuthResult, AuthStrategy } from "./AuthStrategy.js";

export const OAuthProtocol = {
    OAUTH2: "oauth2",
    OPENID: "openid",
} as const;

export interface OAuthProvider {
    /** The unique name of the provider that can be used for authentication. */
    name: string;
    /** The URL of the provider's API that will be used to perform authorization requests. */
    authorizationURL: string;
    /** The unique identifier that has been provided by the OAuth provider. */
    clientID: string;
    /** The shared secret that has been provided by the OAuth provider. */
    clientSecret: string;
    /**
     * Indicates whether PKCE is required by the OAuth provider. Optionally, set the value to the desired algorithm of
     * the PKCE challenge method (E.g., `S256`).
     */
    pkce?: boolean | string;
    /** The URL of the provider's API that the user profile can be retrieved from. */
    profileURL?: string;
    /** The authentication protocol to use (e.g. OAuth 2.0 or Open ID). */
    protocol: string;
    /** The callback URI that has been registered with the OAuth provider. */
    redirectURI: string;
    /** The list of scopes to request during the authentication process. Default is `none`. */
    scope?: string[];
    /** The URL of the provider's API that will perform token exchange. */
    tokenURL: string;
}

/**
 * Describes the configuration options that can be used to initialize OAuthStrategy.
 *
 * @author Jean-Philippe Steinmetz
 */
export class OAuthStrategyOptions {
    /**
     * The configuration of the OAuth/OpenID provider.
     */
    public provider: OAuthProvider;
    /** Override this function to handle asynchronous (non-blocking) verification of the login info. */
    public verify(profile: any, accessToken: string): JWTUser | Promise<JWTUser | undefined> | undefined {
        throw new Error("Did you forget to override OAuthStrategyOptions.verify?");
    }

    constructor(provider: OAuthProvider) {
        this.provider = provider;
    }
}

/**
 * Implements an authentication strategy for performing OAuth 2.0 and OpenID Connect authorization with a third-party provider.
 *
 * The OAuth/OpenID authorization flow has the following steps:
 *
 * 1. Client initiates a request for an Authorization Request URI. Builds the Authorization Request URI and returns it
 * to the client.
 * 2. The client should automatically redirect the user to the Authorization Request URI obtained in step 1.
 * 3. Once the user has approved the authorization request with the third-party provider the client will be
 * redirected to the application's registered callback URL with a single query parameter containing an
 * Authorization Code. The client initiates a request to a route handler, containing the code, and then
 * calls `authenticate()`.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class OAuthStrategy implements AuthStrategy {
    public readonly name: string = "oauth";
    private options: OAuthStrategyOptions;

    constructor(options: OAuthStrategyOptions) {
        this.options = options;
    }

    /**
     * Creates and returns the Authorization Request URI for the configured OAuth provider.
     *
     * @param req The source HTTP request.
     * @param redirectURI The source URI to redirect the user to once authentication is complete.
     */
    protected buildAuthorizationURI(req: HttpRequest, redirectURI?: string): string {
        let url: string = this.options.provider.authorizationURL + `?client_id=${this.options.provider.clientID}`;

        redirectURI = redirectURI ?? (req.query?.redirect_uri as string) ?? this.options.provider.redirectURI;

        if (this.options.provider.pkce) {
            if (!req.session) {
                throw new Error(
                    "OAuthStrategy requires session support for PKCE. Configure the `session` config " +
                        "block so the session middleware is registered.",
                );
            }

            // Create a random verifier string and generate a code challenge with it. Per RFC 7636
            // the verifier itself must be an unreserved-charset string (not raw bytes) since it's
            // later sent back verbatim during token exchange — base64url encoding a random buffer
            // yields exactly such a string.
            const algo: string =
                (req.query.code_challenge_method as string) ||
                (typeof this.options.provider.pkce === "string" ? this.options.provider.pkce : "SHA-256");
            const verifier: string = req.query.code_verifier
                ? (req.query.code_verifier as string)
                : crypto.randomBytes(32).toString("base64url");
            const codeChallenge =
                req.query.code_challenge ||
                crypto
                    .createHash(algo)
                    .update(Buffer.from(verifier, "ascii"))
                    .digest("base64")
                    .replace(/=/g, "")
                    .replace(/\+/g, "-")
                    .replace(/\//g, "_");

            // Add the challenge to the URL
            url += `&code_challenge=${codeChallenge}&code_challenge_method=${algo}`;

            // Store all pkce info in the session for reference later.
            req.session.code_challenge = codeChallenge;
            req.session.code_challenge_method = algo;
            req.session.code_verifier = verifier;
        }

        if (redirectURI) {
            url += `&redirect_uri=${encodeURIComponent(redirectURI)}`;
        }

        url += `&response_type=${this.options.provider.protocol === OAuthProtocol.OPENID ? "id_token code" : "code"}`;

        url += `&scope=${req.query.scope || (this.options.provider.scope ?? []).join(" ")}`;

        url += `&state=${req.query.state}`;

        return url;
    }

    public async authenticate(
        req: HttpRequest,
        res: HttpResponse,
        required?: boolean,
    ): Promise<AuthResult | undefined> {
        // Is this an authorization request or token exchange?
        if (req.body?.code || req.query?.code) {
            // 1. First exchange the auth code for the access token with the provider
            const accessToken: any = await this.exchangeOAuthCode(req);

            // 2. Retrieve the user profile.
            const profile: any = await this.retrieveUserProfile(accessToken);

            // 3. Notify the verify callback to create a user object for this profile.
            const user: JWTUser | undefined = await this.options.verify(profile, accessToken);

            return {
                data: accessToken,
                method: this.name,
                payload: accessToken,
                user,
            };
        } else {
            const url: string = this.buildAuthorizationURI(req);
            res.status(302);
            res.setHeader("Location", url);
            res.setHeader("Content-Length", 0);
            res.end();
            return undefined;
        }
    }

    public authenticateSync(req: HttpRequest, res: HttpResponse, required?: boolean): AuthResult | undefined {
        throw new Error("Not supported. This auth strategy requires must be used asynchronously.");
    }

    /**
     * Performs a request against the OAuth provider to exchange the given authorization code for an access token.
     *
     * @param req The request data to use in the exchange exchange.
     * @param provider The OAuth provider to perform the exchange with.
     */
    protected async exchangeOAuthCode(req: HttpRequest): Promise<any> {
        // The code may come from either request query for body
        const code: string = req.body?.code || req.query?.code;
        if (!code) {
            throw new Error("Authorization code is missing!");
        }

        // Create a url-encoded payload for the token exchange per RFC-6749 Section 4.1.3
        let data: any = {
            code,
            grant_type: "authorization_code",
            redirect_uri: req.body?.redirect_uri ?? req.query?.redirect_uri ?? this.options.provider.redirectURI,
        };

        // If PKCE is required for this provider make sure to include the challenge. The request body may have already
        // included the challenge details. If not, we'll use what we have from the stored session.
        if (this.options.provider.pkce) {
            data.code_verifier = req.body?.code_verifier ?? req.query?.code_verifier ?? req.session?.code_verifier;
        }

        try {
            const result: AxiosResponse = await axios.post(this.options.provider.tokenURL, data, {
                headers: {
                    Authorization: `Basic ${Buffer.from(this.options.provider.clientID + ":" + this.options.provider.clientSecret).toString("base64")}`,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
            });
            if (result && (result.status !== 200 || !result.data)) {
                throw new Error("Failed to retrieve access token.");
            }

            const json: any = typeof result.data === "string" ? JSON.parse(result.data) : result.data;
            return json;
        } catch (err: any) {
            const error: any = err.response?.data || new Error(`Failed to exchange auth token. ${err.message || ""}`);
            error.status = err.status;
            throw error;
        }
    }

    /**
     * Retrieves the user profile from the specified OAuth provider using the given access token.
     * @param token The access token to use to retrieve the user profile.
     */
    protected async retrieveUserProfile(token: any): Promise<any> {
        // Was an id_token provided? If so, we can decode it and retrieve the profile without
        // having to contact the OAuth provider again.
        if (token.id_token) {
            const payload: any = token.id_token;
            if (typeof payload !== "object") {
                throw new Error("Invalid id_token provided");
            }
            return payload;
        } else {
            // If no profileURL has been set just immediately return.
            if (!this.options.provider.profileURL) {
                return undefined;
            }

            try {
                const request: AxiosResponse = await axios.get(this.options.provider.profileURL, {
                    headers: {
                        Accept: "application/json",
                        Authorization: `${token.token_type} ${token.access_token}`,
                    },
                });
                if (request && (request.status !== 200 || !request.data)) {
                    throw new Error("Failed to retrieve user profile.");
                }

                const json: any = typeof request.data === "string" ? JSON.parse(request.data) : request.data;
                return json;
            } catch (err: any) {
                const error: any =
                    err.response?.data || new Error(`Failed to retrieve user profile. ${err.message || ""}`);
                error.status = err.status;
                throw error;
            }
        }
    }
}
