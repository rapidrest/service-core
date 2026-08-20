////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ApiError, JWTUtils, ObjectDecorators, type JWTUser, type JWTPayload } from "@rapidrest/core";
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
    private _objectFactory?: ObjectFactory;

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
        for (const name of strategies) {
            // Attempt authentication with the strategy
            const strategy: AuthStrategy | undefined = this.strategies.get(name);
            if (strategy) {
                const authResult: AuthResult | undefined = await strategy.authenticate(req, res);

                // Was it successful?
                if (authResult) {
                    return authResult;
                }
            } else {
                throw new Error("No authentication strategy has been registered with name: " + name);
            }
        }

        if (required) {
            throw new Error("Authentication failed.");
        }

        return undefined;
    }

    /**
     * Performs authentication of the given request using one of the provided strategies.
     *
     * This is the synchronous version of `authenticate` that performs blocking based authentication.
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
        let authResult: AuthResult | undefined = undefined;

        for (const name of strategies) {
            // Attempt authentication with the strategy
            const strategy: AuthStrategy | undefined = this.strategies.get(name);
            if (strategy) {
                authResult = strategy.authenticateSync(req, res);
            } else {
                throw new Error("No authentication strategy has been registered with name: " + name);
            }

            // Was it successful?
            if (authResult) {
                break;
            }
        }

        if (!authResult && required) {
            throw new Error("Authentication failed.");
        }

        return authResult;
    }

    /**
     * Returns a request handler function that will perform authentication of a websocket connection. Authentication
     * can be handled in two ways:
     *
     * 1. Authorization header
     * 2. Negotiation via handshake
     *
     * This middleware function primarily provides the implementation for item 2 above.
     *
     * @param required Set to `true` to indicate that auth is required, otherwise `false`.
     */
    public authWebSocket(required: boolean): RequestHandler {
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

            const onClose = () => {
                // Socket closed before auth completed — unblock runChain so the open handler can
                // finish. The readyState === 3 guard in the router's ws() open handler (uWS/Router.ts
                // and bun/BunRouter.ts both implement it) will skip the final ws.close().
                settle(() => next());
            };

            const onMessage = (data: any, isBinary: boolean) => {
                if (isBinary) {
                    settle(() => {
                        if (required) {
                            const error = new ApiError(
                                ApiErrors.INVALID_REQUEST,
                                400,
                                ApiErrorMessages.INVALID_REQUEST,
                            );
                            sock.close(1002, error.code);
                            next(error);
                        } else {
                            next();
                        }
                    });
                    return;
                }

                try {
                    const message: any = JSON.parse(data);

                    if (message.type === "LOGIN") {
                        const payload: JWTPayload = JWTUtils.decodeTokenSync(this.authConfig, message.data);
                        const loginUser: JWTUser | null =
                            payload && payload.profile ? (payload.profile as JWTUser) : null;

                        if (loginUser && loginUser.uid) {
                            settle(() => {
                                sock.send(JSON.stringify({ id: message.id, type: "LOGIN_RESPONSE", success: true }));
                                req.user = loginUser;
                                // Set req.auth so @User decorator in wrapMiddleware resolves correctly
                                req.auth = { user: loginUser, method: "jwt", data: message.data, payload };
                                next();
                            });
                        } else if (required) {
                            settle(() => {
                                const error = new ApiError(ApiErrors.AUTH_FAILED, 401, ApiErrorMessages.AUTH_FAILED);
                                sock.send(
                                    JSON.stringify({
                                        id: message.id,
                                        type: "LOGIN_RESPONSE",
                                        success: false,
                                        data: error.message,
                                    }),
                                );
                                sock.close(1002, error.message);
                                next(error);
                            });
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
                    } else if (required) {
                        settle(() => {
                            const error = new ApiError(
                                ApiErrors.INVALID_REQUEST,
                                400,
                                ApiErrorMessages.INVALID_REQUEST,
                            );
                            sock.close(1002, error.code);
                            next(error);
                        });
                    } else {
                        settle(() => next());
                    }
                } catch {
                    settle(() => {
                        if (required) {
                            const error = new ApiError(
                                ApiErrors.INVALID_REQUEST,
                                400,
                                ApiErrorMessages.INVALID_REQUEST,
                            );
                            sock.close(1002, error.code);
                            next(error);
                        } else {
                            next();
                        }
                    });
                }
            };

            sock.once("message", onMessage);
            sock.once("close", onClose);

            const timer: NodeJS.Timeout = setTimeout(() => {
                settle(() => {
                    if (required) {
                        const error = new ApiError(ApiErrors.AUTH_FAILED, 401, ApiErrorMessages.AUTH_FAILED);
                        error.status = 401;
                        sock.close(1002, error.message);
                        next(error);
                    } else {
                        next();
                    }
                });
            }, this.authSocketTimeout);
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
