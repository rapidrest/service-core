////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { ApiError, ObjectDecorators, type JWTUser } from "@rapidrest/core";
import type { HttpRequest, HttpResponse, RequestHandler, NextFunction } from "../http/types.js";
import { ApiErrors, ApiErrorMessages } from "../ApiErrors.js";
import type { RequestWS } from "../http/uWS/WebSocket.js";
import type { AuthResult, AuthStrategy } from "./AuthStrategy.js";
import { ObjectFactory } from "../ObjectFactory.js";
import { JWTStrategy } from "./JWTStrategy.js";
const { Config, Init } = ObjectDecorators;

/**
 * A set of common utilities for performing authentication using one or more strategies.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class AuthMiddleware {
    // Automatically injected by ObjectFactory on instantiation
    protected _objectFactory?: ObjectFactory;

    @Config("auth")
    private authConfig: any;

    @Config("auth:socketTimeout", 2000)
    private authSocketTimeout: number = 2000;

    /** The authentication strategies that have been registered. */
    public readonly strategies: Map<string, AuthStrategy> = new Map();

    @Init
    private async init() {
        if (this._objectFactory) {
            // Register built-in strategy classes with ObjectFactory
            this._objectFactory.register(JWTStrategy, "auth.JWTStrategy");

            if (this.authConfig.strategy) {
                const strategy = await this._objectFactory.newInstance<AuthStrategy>(this.authConfig.strategy);
                this.strategies.set(strategy.name, strategy);
            }
        }
    }

    /**
     * Performs authentication of the given request using one of the provided strategies.
     *
     * Each strategy is tried in order until one succeeds. A strategy that throws doesn't stop the others from
     * being tried, since several strategies can claim the same credential (e.g. `jwt` and `oauth_bearer` both
     * read an `Authorization: Bearer` header). If no strategy succeeds and at least one threw, the first error
     * thrown is rethrown, whether or not `required` is set, so callers can still tell a bad credential from a
     * missing one.
     *
     * @param strategies The list of strategy names to attempt authentication with.
     * @param req The request containing data to perform authenticate with.
     * @param res The response to use when writing back directly to the client.
     * @param required Set to `true` to if authentication is required to pass, otherwise set to `false`.
     */
    public async authenticate(
        strategies: string[],
        req: HttpRequest,
        res?: HttpResponse,
        required?: boolean,
    ): Promise<AuthResult | undefined> {
        const errors: unknown[] = [];

        for (const name of strategies) {
            const strategy: AuthStrategy = this.getStrategy(name);
            try {
                const authResult: AuthResult | undefined = await strategy.authenticate(req, res);
                if (authResult) {
                    return authResult;
                }
            } catch (err) {
                errors.push(err);
            }
        }

        return this.authFailed(errors, required);
    }

    /**
     * Performs authentication of the given request using one of the provided strategies.
     *
     * This is the synchronous version of `authenticate` that performs blocking based authentication. It follows
     * the same rules for strategies that throw.
     *
     * @param strategies The list of strategy names to attempt authentication with.
     * @param req The request containing data to perform authenticate with.
     * @param res The response to use when writing back directly to the client.
     * @param required Set to `true` to if authentication is required to pass, otherwise set to `false`.
     */
    public authenticateSync(
        strategies: string[],
        req: HttpRequest,
        res?: HttpResponse,
        required?: boolean,
    ): AuthResult | undefined {
        const errors: unknown[] = [];

        for (const name of strategies) {
            const strategy: AuthStrategy = this.getStrategy(name);
            try {
                const authResult: AuthResult | undefined = strategy.authenticateSync(req, res);
                if (authResult) {
                    return authResult;
                }
            } catch (err) {
                errors.push(err);
            }
        }

        return this.authFailed(errors, required);
    }

    /**
     * Returns the registered strategy with the given name, throwing if there is none. A missing strategy is a
     * configuration error, so it is never treated as an ordinary authentication failure.
     */
    private getStrategy(name: string): AuthStrategy {
        const strategy: AuthStrategy | undefined = this.strategies.get(name);
        if (!strategy) {
            throw new Error("No authentication strategy has been registered with name: " + name);
        }
        return strategy;
    }

    /**
     * Handles the case where no strategy authenticated the request: rethrows the first strategy error if there was
     * one, throws if authentication is required, and otherwise returns `undefined`.
     */
    private authFailed(errors: unknown[], required?: boolean): undefined {
        if (errors.length > 0) {
            throw errors[0];
        }
        if (required) {
            throw new Error("Authentication failed.");
        }
        return undefined;
    }

    /**
     * Builds a copy of `req` that carries only the given token, as an `Authorization: Bearer` header. Used to run
     * a WebSocket `LOGIN` message's token through the route's strategies. Query parameters and cookies from the
     * upgrade request are removed, so a strategy can't authenticate from a credential other than the one supplied.
     */
    private createTokenRequest(req: HttpRequest, token: string): HttpRequest {
        const headers: Record<string, any> = { ...req.headers, authorization: `Bearer ${token}` };
        return Object.create(req, {
            cookies: { value: {}, enumerable: true, writable: true },
            headers: { value: headers, enumerable: true, writable: true },
            query: { value: {}, enumerable: true, writable: true },
            signedCookies: { value: {}, enumerable: true, writable: true },
        });
    }

    /**
     * Returns a request handler function that will perform authentication of a websocket connection. Authentication
     * can be handled in two ways:
     *
     * 1. Authorization header (or any other credential a strategy reads from the upgrade request)
     * 2. Negotiation via handshake
     *
     * Pre-upgrade auth (see `RouteUtils.registerRoute()`) can only run strategies synchronously. When it didn't
     * authenticate the connection, this handler first runs the strategies asynchronously against the upgrade
     * request, which covers async-only strategies such as `oauth_bearer`. If that doesn't authenticate either, it
     * waits for a `LOGIN` message whose `data` token is also verified through `strategies`, sent to them as an
     * `Authorization: Bearer` header.
     *
     * When `required` is `false`, a failed or missing credential never closes the connection; the handler proceeds
     * anonymously.
     *
     * @param required Set to `true` to indicate that auth is required, otherwise `false`.
     * @param strategies The strategy names to authenticate with. Defaults to `["jwt"]`, matching `RouteUtils`.
     */
    public authWebSocket(required: boolean, strategies: string[] = ["jwt"]): RequestHandler {
        return (req: HttpRequest, _res: HttpResponse, next: NextFunction) => {
            const sock: any = (req as RequestWS).websocket || req.socket;
            const user: JWTUser | undefined = req.user;

            // Pre-upgrade auth already set req.user — no LOGIN handshake needed
            if (user && user.uid) {
                next();
                return;
            }

            // Ensures timer, message listener, and close listener each fire at most once.
            // Prevents the timer from firing after the socket closes (which would try to call
            // sock.close() on an already-closed handle and throw an unhandled rejection).
            let settled = false;
            const settle = (fn: () => void) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                sock.removeListener("message", onMessage);
                sock.removeListener("close", onClose);
                fn();
            };

            const accept = (result: AuthResult) => {
                req.user = result.user;
                // Set req.auth so @User decorator in wrapMiddleware resolves correctly
                req.auth = result;
                next();
            };

            const rejectAuth = (id?: any) => {
                const error = new ApiError(ApiErrors.AUTH_FAILED, 401, ApiErrorMessages.AUTH_FAILED);
                if (id !== undefined) {
                    sock.send(JSON.stringify({ id, type: "LOGIN_RESPONSE", success: false, data: error.message }));
                }
                sock.close(1002, error.message);
                next(error);
            };

            const rejectInvalid = () => {
                if (required) {
                    const error = new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
                    sock.close(1002, error.code);
                    next(error);
                } else {
                    next();
                }
            };

            const onClose = () => {
                // Socket closed before auth completed — unblock runChain so the open handler can
                // finish. The readyState === 3 guard in the router's ws() open handler (uWS/Router.ts
                // and bun/BunRouter.ts both implement it) will skip the final ws.close().
                settle(() => next());
            };

            const login = async (message: any) => {
                let result: AuthResult | undefined = undefined;
                try {
                    if (typeof message.data === "string" && message.data.length > 0) {
                        result = await this.authenticate(strategies, this.createTokenRequest(req, message.data));
                    }
                } catch {
                    // A malformed token makes a strategy throw. Keep the established response for that case:
                    // close with `INVALID_REQUEST` when auth is required, otherwise proceed anonymously.
                    settle(rejectInvalid);
                    return;
                }

                if (result?.user?.uid) {
                    const loginResult: AuthResult = result;
                    settle(() => {
                        sock.send(JSON.stringify({ id: message.id, type: "LOGIN_RESPONSE", success: true }));
                        accept(loginResult);
                    });
                } else if (required) {
                    settle(() => rejectAuth(message.id));
                } else {
                    settle(() => {
                        sock.send(
                            JSON.stringify({
                                id: message.id,
                                type: "LOGIN_RESPONSE",
                                success: false,
                                data: "Invalid authentication token.",
                            }),
                        );
                        next();
                    });
                }
            };

            const onMessage = (data: any, isBinary: boolean) => {
                if (isBinary) {
                    settle(rejectInvalid);
                    return;
                }

                let message: any = undefined;
                try {
                    message = JSON.parse(data);
                } catch {
                    settle(rejectInvalid);
                    return;
                }

                if (message?.type === "LOGIN") {
                    // Stop listening now. The login verification is async, and the timer or a close can still
                    // settle first while it runs.
                    sock.removeListener("message", onMessage);
                    void login(message);
                } else {
                    settle(rejectInvalid);
                }
            };

            // Attach listeners before any await, so a LOGIN frame sent right after the upgrade isn't missed.
            sock.once("message", onMessage);
            sock.once("close", onClose);

            const timer: NodeJS.Timeout = setTimeout(() => {
                settle(() => {
                    if (required) {
                        rejectAuth();
                    } else {
                        next();
                    }
                });
            }, this.authSocketTimeout);

            // Try the strategies against the upgrade request itself. This covers credentials that the synchronous
            // pre-upgrade auth couldn't verify, e.g. an `Authorization` header for an async-only strategy.
            this.authenticate(strategies, req).then(
                (result) => {
                    if (result?.user?.uid) {
                        settle(() => accept(result));
                    }
                },
                () => {
                    // A credential was sent but is invalid. Only reject when auth is required; otherwise keep
                    // waiting for a LOGIN message, the same as when no credential was sent.
                    if (required) {
                        settle(() => rejectAuth());
                    }
                },
            );
        };
    }

    /**
     * Registers the provided authentication strategy to be used
     * @param name The name of the authentication type to associate the given strategy with
     * @param strategy The strategy to register
     */
    public register(name: string, strategy: AuthStrategy) {
        this.strategies.set(name, strategy);
    }
}
