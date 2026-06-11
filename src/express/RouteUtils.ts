///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { ApiError, JWTPayload, JWTUser, JWTUtils, ObjectDecorators, UserUtils } from "@rapidrest/core";
import type { HttpRequest, HttpResponse, NextFunction, RequestHandler } from "../http/types.js";
import type { WsUpgradeAuth } from "../http/Router.js";
import type { RequestWS } from "../http/WebSocket.js";
import { ServerResponse } from "http";
import { OpenApiSpec } from "../OpenApiSpec.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import { AccessControlList, ACLUtils } from "../security/index.js";
import { JWTStrategy, JWTStrategyOptions } from "../passportjs/JWTStrategy.js";
import _ from "lodash";
const { Config, Inject, Logger } = ObjectDecorators;

/**
 * Provides a set of utilities for converting Route classes to HTTP middleware.
 *
 * @author Jean-Philippe Steinmetz <rapidrests@gmail.com>
 */
export class RouteUtils {
    @Inject(ACLUtils)
    private aclUtils?: ACLUtils;

    @Inject(OpenApiSpec)
    private apiSpec: OpenApiSpec = new OpenApiSpec();

    @Config("auth")
    private authConfig: any;

    @Config("auth:socketTimeout", 2000)
    private authSocketTimeout: number = 2000;

    @Logger
    private logger?: any;

    /** Lazily-constructed JWT strategy used for all auth middleware (no Passport dependency). */
    private _jwtStrategy?: JWTStrategy;
    private get jwtStrategy(): JWTStrategy {
        if (!this._jwtStrategy) {
            const opts = new JWTStrategyOptions();
            opts.config = this.authConfig || { secret: "" };
            this._jwtStrategy = new JWTStrategy(opts);
        }
        return this._jwtStrategy;
    }

    /**
     * Creates a middleware function that verifies the incoming request is from a valid user with at least
     * one of the specified roles.
     */
    public checkRequiredPerms(aclUid: string): RequestHandler {
        return async (req: HttpRequest, _res: HttpResponse, next: NextFunction) => {
            let granted: boolean = this.aclUtils
                ? await this.aclUtils.checkRequestPerms(aclUid, req.user, req)
                : false;

            if (granted) {
                return next();
            } else {
                const err: ApiError = new ApiError(
                    ApiErrors.AUTH_PERMISSION_FAILURE,
                    403,
                    ApiErrorMessages.AUTH_PERMISSION_FAILURE
                );
                return next(err);
            }
        };
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
            const user: JWTUser | undefined = req.user as JWTUser;

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
                // finish. The readyState === 3 guard in Router.ts will skip the final ws.close().
                settle(() => next());
            };

            const onMessage = (data: any, isBinary: boolean) => {
                if (isBinary) {
                    settle(() => {
                        if (required) {
                            const error = new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
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
                        const payload: JWTPayload = JWTUtils.decodeToken(this.authConfig, message.data);
                        const loginUser: JWTUser | null =
                            payload && payload.profile ? (payload.profile as JWTUser) : null;

                        if (loginUser && loginUser.uid) {
                            settle(() => {
                                sock.send(JSON.stringify({ id: message.id, type: "LOGIN_RESPONSE", success: true }));
                                req.user = loginUser;
                                next();
                            });
                        } else if (required) {
                            settle(() => {
                                const error = new ApiError(ApiErrors.AUTH_FAILED, 401, ApiErrorMessages.AUTH_FAILED);
                                sock.send(JSON.stringify({ id: message.id, type: "LOGIN_RESPONSE", success: false, data: error.message }));
                                sock.close(1002, error.message);
                                next(error);
                            });
                        } else {
                            settle(() => {
                                sock.send(JSON.stringify({ id: message.id, type: "LOGIN_RESPONSE", success: false, data: "Invalid authentication token." }));
                                next();
                            });
                        }
                    } else if (required) {
                        settle(() => {
                            const error = new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
                            sock.close(1002, error.code);
                            next(error);
                        });
                    } else {
                        settle(() => next());
                    }
                } catch {
                    settle(() => {
                        if (required) {
                            const error = new ApiError(ApiErrors.INVALID_REQUEST, 400, ApiErrorMessages.INVALID_REQUEST);
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
     * Creates a middleware function that verifies the incoming request is from a valid user with at least
     * one of the specified roles.
     *
     * @param requiredRoles The list of roles that the authenticated user must have.
     */
    public checkRequiredRoles(requiredRoles: string[]): RequestHandler {
        return (req: HttpRequest, _res: HttpResponse, next: NextFunction) => {
            let foundRole: boolean = UserUtils.hasRoles(req.user, requiredRoles);

            if (foundRole) {
                return next();
            } else {
                const err: ApiError = new ApiError(
                    ApiErrors.AUTH_PERMISSION_FAILURE,
                    403,
                    ApiErrorMessages.AUTH_PERMISSION_FAILURE
                );
                return next(err);
            }
        };
    }

    /**
     * Converts the given array of string or Function objects to functions bound to the given route object.
     *
     * @param route The route object that the list of functions is bound to.
     * @param funcs The array of functions (or function names) to return.
     * @param send Set to true to have the last wrapped function send its payload to the client.
     * @returns An array of Function objects mapping to the route object.
     */
    public getFuncArray(route: any, funcs: (Function | string)[], send: boolean = false): RequestHandler[] {
        const result: RequestHandler[] = [];

        if (funcs) {
            for (let i = 0; i < funcs.length; i++) {
                const func: Function | string = funcs[i];
                if (typeof func == "string") {
                    result.push(this.wrapMiddleware(route, route[func], send && i >= funcs.length - 1));
                } else {
                    result.push(this.wrapMiddleware(route, func, send && i >= funcs.length - 1));
                }
            }
        }

        return result;
    }

    /**
     * Searches an route object for any functions that implement a `@Method` decorator.
     *
     * @param route The route object to search.
     * @returns The list of `@Method` decorated functions that were found.
     */
    public getRouteMethods(route: any): Map<string, any> {
        let results: Map<string, any> = new Map();

        for (let member in route) {
            let metadata: any = Reflect.getMetadata("rrst:route", route, member);
            if (metadata) {
                results.set(member, route[member]);
            }
        }
        let proto = Object.getPrototypeOf(route);
        while (proto) {
            for (let member of Object.getOwnPropertyNames(proto)) {
                let metadata: any = Reflect.getMetadata("rrst:route", proto, member);
                if (metadata) {
                    results.set(member, route[member]);
                }
            }
            proto = Object.getPrototypeOf(proto);
        }

        return results;
    }

    /**
     * Registers the provided route object containing a set of decorated endpoints to the server.
     *
     * @param app The HTTP application/router to register the route to.
     * @param route The route object to register.
     */
    public async registerRoute(app: any, route: any): Promise<void> {
        let routePaths: string[] = Reflect.getMetadata("rrst:routePaths", route);
        if (!routePaths) {
            throw new Error("Route must specify a path: " + JSON.stringify(route));
        }

        // Check if this route defines a class level ACL. If so, we need to store it and then add middleware to validate
        // against it.
        let defaultAcl: AccessControlList | null = Reflect.getMetadata("rrst:acl", route);
        if (defaultAcl && this.aclUtils) {
            try {
                defaultAcl = await this.aclUtils.saveDefaultACL(defaultAcl);
            } catch (err) {
                this.logger.info(`Failed to save default ACL for: ${defaultAcl?.uid}`);
            }
        }

        // Each route definition will contain a set of functions that have been decorated to include route metadata.
        // The route metadata will include what HTTP methods and paths that the endpoint is to be bound to. Multiple
        // methods and paths can be assigned to a single decorated function. Therefore, it is necessary to register
        // each combination of basePath, path and method that have been defined by the decorators.
        let methods: Map<string, any> = this.getRouteMethods(route);
        for (let entry of methods.entries()) {
            let key: string = entry[0];
            let value: any = entry[1];

            let docs: any = Reflect.getMetadata("rrst:docs", route, key) || {};
            let metadata: any = Reflect.getMetadata("rrst:route", route, key) || {};
            if (value && metadata) {
                let { authRequired } = metadata;
                const { after, before, methods, requiredRoles, validator } = metadata;
                let { authStrategies } = metadata;
                let verbMap: Map<string, string> = methods as Map<string, string>;

                // If no JWT strategies have been provided by default, always include JWT token support
                if (!authStrategies) {
                    authStrategies = ["jwt"];
                }

                // Does this endpoint have an associated ACL?
                let acl: AccessControlList | null = Reflect.getMetadata("rrst:acl", route, key);
                if (acl && this.aclUtils) {
                    acl.parentUid = defaultAcl?.uid;
                    acl = await this.aclUtils.saveDefaultACL(acl);
                }

                // Prepare the list of middleware to apply for the given endpoint.
                // The order of operations for middleware is:
                // 1. Auth Strategies
                // 2. Required Roles
                // 3. Required Permissions (Path Matching)
                // 4. Validator Function
                // 5. Before Functions
                // 6. Decorated Function
                // 7. After Functions
                let middleware: Array<RequestHandler> = new Array();
                if (requiredRoles) {
                    middleware.push(this.checkRequiredRoles(requiredRoles));
                }
                const aclUid: string | undefined = acl?.uid || defaultAcl?.uid;
                if (aclUid) {
                    middleware.push(this.checkRequiredPerms(aclUid));
                }
                if (validator) {
                    middleware = middleware.concat(this.getFuncArray(route, [validator]));
                }
                middleware = middleware.concat(this.getFuncArray(route, before));
                middleware.push(this.wrapMiddleware(route, value, after === undefined));
                middleware = middleware.concat(this.getFuncArray(route, after, true));

                // Multiple method verbs can be registered for a given route endpoint.
                for (let entry of verbMap.entries()) {
                    let verb: string = entry[0];

                    // Multiple base paths can be provided to a single route definition.
                    for (let basePath of routePaths) {
                        let subpath: string = entry[1].startsWith("/") ? entry[1].substring(1) : entry[1];
                        let path: string =
                            subpath.length === 0 || basePath.endsWith("/")
                                ? basePath + subpath
                                : basePath + "/" + subpath;

                        // If the verb is `ws` we need to translate this accordingly
                        if (verb === "ws") {
                            // Pre-upgrade auth: runs synchronously in the uWS upgrade callback
                            // before the WebSocket handshake. Clients that send an Authorization
                            // header (native apps, etc.) are authenticated here and skip the
                            // post-upgrade LOGIN message. Browsers that cannot send custom headers
                            // fall through to the message-based authWebSocket flow.
                            const upgradeAuth: WsUpgradeAuth = (req) => {
                                const result = this.jwtStrategy.authenticate(req);
                                if (result.user) {
                                    return { user: result.user, authPayload: result.authPayload, authToken: result.authToken };
                                }
                                if (result.tokenFound) {
                                    // Token was present but invalid — reject before handshake
                                    return { reject: true };
                                }
                                // No token — fall through to post-upgrade message-based auth
                                return {};
                            };

                            middleware.unshift(this.authWebSocket(authRequired));
                            // Set authRequired to false since we enforce it in the authWebSocket function
                            authRequired = false;

                            // Register with the HttpRouter's ws() method; trailing slash handled internally
                            app.ws(path, middleware, undefined, upgradeAuth);

                            // Update our OpenAPI spec — WebSocket upgrade is a GET request
                            this.apiSpec.addRoute(key, path, "get", metadata, docs, route);
                            this.logger.info("Registered Route: WS " + path);
                            continue;
                        }

                        // Build the JWT auth middleware for this route
                        if (authStrategies && authStrategies.length > 0) {
                            if (authRequired) {
                                // Required auth — reject with 401 if no valid token
                                const jwtMw: RequestHandler = (req, _res, next) => {
                                    const result = this.jwtStrategy.authenticate(req);
                                    if (result.user) {
                                        req.user = result.user;
                                        req.authPayload = result.authPayload;
                                        req.authToken = result.authToken;
                                        next();
                                    } else {
                                        next(new ApiError(ApiErrors.AUTH_FAILED, 401, ApiErrorMessages.AUTH_FAILED));
                                    }
                                };
                                app[verb](path, jwtMw, ...middleware);
                            } else {
                                // Optional auth — always proceeds; user may be undefined
                                const jwtMw: RequestHandler = (req, _res, next) => {
                                    const result = this.jwtStrategy.authenticate(req);
                                    req.user = result.user;
                                    req.authPayload = result.authPayload;
                                    req.authToken = result.authToken;
                                    next();
                                };
                                app[verb](path, jwtMw, ...middleware);
                            }
                        } else {
                            app[verb](path, ...middleware);
                        }

                        this.logger.info("Registered Route: " + verb.toUpperCase() + " " + path);

                        // Update our OpenAPI spec object with the details of this route.
                        this.apiSpec.addRoute(key, path, verb, metadata, docs, route);
                    }
                }
            }
        }
    }

    /**
     * Wraps the provided function with HTTP handling based on the function's defined decorators.
     *
     * @param obj The bound object whose middleware function will be wrapped.
     * @param func The decorated function to wrap.
     * @param send Set to true to have `func`'s result sent to the client.
     */
    public wrapMiddleware(obj: any, func: Function, send: boolean = false): RequestHandler {
        return async (req: HttpRequest, res: HttpResponse, next: NextFunction) => {
            try {
                const argMetadata: any = Reflect.getMetadata("rrst:args", Object.getPrototypeOf(obj), func.name);
                const routeMetadata: any = Reflect.getMetadata("rrst:route", Object.getPrototypeOf(obj), func.name);
                const args: any[] = [];

                const routeType = [...(routeMetadata?.methods?.keys() || [])][0];

                // this.logger.debug(`Arg metadata: ${JSON.stringify(argMetadata)}`);
                // this.logger.debug(`Route metadata: ${JSON.stringify(routeMetadata)}`);
                // this.logger.debug(`Route type: ${JSON.stringify(routeType)}`);

                // This is a hack that lets us stub out function arguments because we no longer can access
                // them directly with func.arguments. Unfortunately this means we can't get default values
                // as there's no way to reference them. =(
                for (let i = 0; i < func.length; i++) {
                    args.push(undefined);
                }

                // Populate the list of function arguments based on the metadata
                if (argMetadata) {
                    for (const key in argMetadata) {
                        const i: number = Number(key);
                        if (argMetadata[i][0] === "authPayload") {
                            args[i] = (req as any).authPayload;
                        } else if (argMetadata[i][0] === "authToken") {
                            args[i] = (req as any).authToken;
                        } else if (argMetadata[i][0] === "header") {
                            if (argMetadata[i][1]) {
                                args[i] = req.headers[argMetadata[i][1]];
                            } else {
                                args[i] = req.headers;
                            }
                        } else if (argMetadata[i][0] === "param") {
                            if (argMetadata[i][1]) {
                                args[i] = req.params[argMetadata[i][1]];
                            } else {
                                args[i] = req.params;
                            }
                        } else if (argMetadata[i][0] === "query") {
                            if (argMetadata[i][1]) {
                                args[i] = req.query[argMetadata[i][1]];
                            } else {
                                args[i] = req.query;
                            }

                            const isGetRoute = routeType === "get";
                            const isHeadRoute = routeType === "head";
                            // Raw buffer encoded query
                            if ((isGetRoute || isHeadRoute) && _.has(args[i], "q")) {
                                const bufferJsonString = Buffer.from(args[i]["q"], "base64").toString("ascii");
                                args[i] = JSON.parse(bufferJsonString);
                            }
                        } else if (argMetadata[i][0] === "request") {
                            args[i] = req;
                        } else if (argMetadata[i][0] === "response") {
                            args[i] = res;
                        } else if (argMetadata[i][0] === "user") {
                            args[i] = req.user;
                        } else if (argMetadata[i][0] === "socket") {
                            args[i] =
                                (req as RequestWS).websocket !== undefined ? (req as RequestWS).websocket : req.socket;
                        }
                    }
                }

                // If res.result is defined it means the body has already been processed by another
                // function.
                let result: any = (res as any)["result"] ? (res as any)["result"] : req.body;
                // Now add the result obj as a function argument
                if (result) {
                    let bodyInjected: boolean = false;
                    // Find the first argument without a decorator and insert the request body
                    for (let i = 0; i < args.length; i++) {
                        if (!argMetadata || !argMetadata[i]) {
                            args[i] = result;
                            bodyInjected = true;
                            break;
                        }
                    }

                    // If no undecorated arg could be found inject at the end
                    if (!bodyInjected) {
                        args.push(result);
                    }
                }

                // Call the wrapped function
                const boundFunc: Function = func.bind(obj);
                result = boundFunc(...args);
                if (result instanceof Promise) {
                    // Wait for the real result
                    result = await result;
                }

                // If this is a WebSocket request, mark it as having been handled. This will notify
                // the WebSocket middleware that the connection is active and shouldn't be closed.
                if ((req as RequestWS).websocket !== undefined) {
                    (req as RequestWS).wsHandled = true;
                }

                // If the result is a response we need to return this immediately. We don't return the original response
                // object because responses are passed by copy, not refernce and so the result will be different.
                // Also catches UWSResponse returned directly (e.g. doCount returns res.status(200)).
                const isResponse: boolean =
                    result === res || result instanceof ServerResponse || (result && result.headers && result.url);
                if (isResponse) {
                    return result.send();
                } else {
                    if (send) {
                        let returnJson: boolean = true;
                        if (
                            routeMetadata &&
                            routeMetadata.contentType &&
                            typeof routeMetadata.contentType === "string" &&
                            routeMetadata.contentType.trim().length !== 0
                        ) {
                            res.setHeader("content-type", routeMetadata.contentType.trim());
                            returnJson = routeMetadata.contentType.trim().includes("application/json");
                        }
                        // If a result was returned set it as the response body, otherwise set the status to NO_CONTENT
                        if (result !== undefined) {
                            if (!res.headersSent) {
                                res.status(200);
                            }
                            if (returnJson) {
                                res.json(result);
                            } else {
                                res.send(result);
                            }
                        } else {
                            if (!res.headersSent) {
                                res.status(204);
                            }
                        }
                    } else {
                        // Assign result to the response for other handlers to use
                        (res as any).result = result;
                    }
                }

                if (next) {
                    return next();
                } else {
                    return res.send();
                }
            } catch (err) {
                return next(err);
            }
        };
    }
}
