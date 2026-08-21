////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { JWTUser } from "@rapidrest/core";
import type { HttpRequest, HttpResponse } from "../http/types.js";

/**
 * Result returned by `AuthStrategy.authenticate()`.
 */
export interface AuthResult {
    /** The raw auth data that was verified. */
    data?: any;
    /** The name of the auth strategy that produced this result. */
    method: string;
    /** The fully decoded payload from the auth data. */
    payload?: any;
    /**
     * Client-supplied app-correlation data extracted from the `state` round-trip, if any (see
     * OAuthStrategy's combined state/CSRF design). Available to route handlers via `@AuthResult`.
     */
    state?: string;
    /** The authenticated user profile, or `undefined` if authentication failed. */
    user?: JWTUser;
}

/**
 * Describes an interface for implementing strategies that will perform authentication.
 */
export interface AuthStrategy {
    /** The unique name of the strategy used to register with the `AuthMiddleware`. */
    readonly name: string;

    /**
     * Attempts to perform authentication with the given request data. If authentication was successful, returns an
     * `AuthResult` containing the authentication details. If authentication fails and `required` is set to `true`
     * throws an error, otherwise returns `undefined`.
     *
     * @param req The request containing data to attempt authentication with.
     * @param res The response to use when writing back directly to the client.
     */
    authenticate(req: HttpRequest, res?: HttpResponse): Promise<AuthResult | undefined>;

    /**
     * Attempts to perform authentication with the given request data. If authentication was successful, returns an
     * `AuthResult` containing the authentication details. If authentication fails and `required` is set to `true`
     * throws an error, otherwise returns `undefined`.
     *
     * This is the synchronous version of `authenticate` that performs blocking based authentication.
     *
     * @param req The request containing data to attempt authentication with.
     * @param res The response to use when writing back directly to the client.
     */
    authenticateSync(req: HttpRequest, res?: HttpResponse): AuthResult | undefined;
}
