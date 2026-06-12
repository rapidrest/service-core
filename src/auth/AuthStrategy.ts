////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { JWTPayload, JWTUser } from "@rapidrest/core";
import { HttpRequest } from "../http/types.js";

/**
 * Result returned by `AuthStrategy.authenticate()`.
 */
export interface AuthResult {
    /** The name of the auth strategy that produced this result. */
    method: string;
    /** The full decoded auth payload. */
    payload?: any;
    /** The raw auth string that was verified. */
    token?: string;
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
     * @param required Set to `true` to if authentication is required to pass, otherwise set to `false`.
     */
    authenticate(req: HttpRequest, required?: boolean): AuthResult | Promise<AuthResult> | undefined;
}
