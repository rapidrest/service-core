///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { ApiError, ObjectDecorators, UserUtils } from "@rapidrest/core";
import type { HttpRequest, HttpResponse, NextFunction, RequestHandler } from "../http/types.js";
import type { WsUpgradeAuth } from "../http/MiddlewareChain.js";
import type { RequestWS } from "../http/uWS/WebSocket.js";
import { ServerResponse } from "http";
import { OpenApiSpec } from "../OpenApiSpec.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import { ACLAction, ACLUtils, type AccessControlList } from "../security/index.js";
import _ from "lodash-es";
import { AuthMiddleware } from "../auth/AuthMiddleware.js";
import type { AuthResult } from "../auth/AuthStrategy.js";
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

    @Inject(AuthMiddleware)
    private authMiddleware?: AuthMiddleware;

    @Logger
    private logger?: any;

    @Config("trusted_roles", ["admin"])
    protected trustedRoles: string[] = ["admin"];

    /**
     * Creates a middleware function that checks if the user has elevated privileges and if not
     * throws the `AUTH_REQUIRES_ELEVATION` error.
     */
    public checkElevation(lastStart: number = -1): RequestHandler {
        return (req: HttpRequest, _res: HttpResponse, next: NextFunction) => {
            if (!req.user) {
                return next(new ApiError(ApiErrors.AUTH_REQUIRED, 401, ApiErrorMessages.AUTH_REQUIRED));
            }

            const err: ApiError = new ApiError(
                ApiErrors.AUTH_REQUIRES_ELEVATION,
                403,
                ApiErrorMessages.AUTH_REQUIRES_ELEVATION,
            );

            // Does the user have elevated privs?
            if (req.user.elevated && req.user.elevated > 0) {
                // Is the user's elevated privs within the specified window?
                if (lastStart > 0 && Date.now() - req.user.elevated >= lastStart * 1000) {
                    return next(err);
                }

                return next();
            }

            return next(err);
        };
    }

    /**
     * Creates a middleware function that verifies the incoming request is from a valid user with at least
     * one of the specified roles.
     */
    public checkRequiredPerms(aclUid: string): RequestHandler {
        return async (req: HttpRequest, _res: HttpResponse, next: NextFunction) => {
            if (!this.aclUtils?.enabled) {
                return next();
            }

            let granted: boolean = this.aclUtils ? await this.aclUtils.checkRequestPerms(aclUid, req.user, req) : false;

            if (granted) {
                return next();
            } else {
                const err: ApiError = new ApiError(
                    ApiErrors.AUTH_PERMISSION_FAILURE,
                    403,
                    ApiErrorMessages.AUTH_PERMISSION_FAILURE,
                );
                return next(err);
            }
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
                    ApiErrorMessages.AUTH_PERMISSION_FAILURE,
                );
                return next(err);
            }
        };
    }

    /**
     * Creates a middleware function that verifies the incoming request is from a valid user with at least
     * one of the trusted roles.
     */
    public checkTrusedRoles(): RequestHandler {
        return (req: HttpRequest, _res: HttpResponse, next: NextFunction) => {
            let foundRole: boolean = UserUtils.hasRoles(req.user, this.trustedRoles);

            if (foundRole) {
                return next();
            } else {
                const err: ApiError = new ApiError(
                    ApiErrors.AUTH_REQUIRES_TRUSTED_ROLE,
                    403,
                    ApiErrorMessages.AUTH_REQUIRES_TRUSTED_ROLE,
                );
                return next(err);
            }
        };
    }

    /**
     * Creates a middleware function that verifies the incoming request's token carries at least one of the
     * specified scopes. This is a coarse, token-level pre-check that runs before the per-resource ACL check —
     * see `RequiresScope`.
     *
     * @param requiredScopes The list of scopes of which the authenticated user's token must carry at least one.
     */
    public checkRequiredScopes(requiredScopes: string[]): RequestHandler {
        return (req: HttpRequest, _res: HttpResponse, next: NextFunction) => {
            const userScopes: string[] = req.user?.scopes ?? [];
            const hasScope: boolean =
                userScopes.includes(ACLAction.FULL) || requiredScopes.some((scope) => userScopes.includes(scope));

            if (hasScope) {
                return next();
            } else {
                const err: ApiError = new ApiError(
                    ApiErrors.AUTH_PERMISSION_FAILURE,
                    403,
                    ApiErrorMessages.AUTH_PERMISSION_FAILURE,
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
        if (this.aclUtils?.enabled && defaultAcl) {
            try {
                defaultAcl = await this.aclUtils.saveDefaultACL(defaultAcl);
            } catch (err) {
                // If the default ACL can't be persisted, `checkRequestPerms` will have nothing to find for this
                // route's uid. Registration must not proceed in that case — continuing would silently register
                // a `@Protect`-ed route with no permission enforcement at all.
                this.logger?.error(
                    `Failed to save default ACL for: ${defaultAcl?.uid}. Refusing to register this route.`,
                );
                this.logger?.debug(err);
                throw err;
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
                const { after, before, methods, requiredRoles, requiredScopes, requiresTrustedRole, validator } =
                    metadata;
                const requiresElevation =
                    metadata.requiresElevation ?? Reflect.getMetadata("rrst:requiresElevation", route);
                let { authStrategies } = metadata;
                let verbMap: Map<string, string> = methods as Map<string, string>;

                // If no JWT strategies have been provided by default, always include JWT token support
                if (!authStrategies) {
                    authStrategies = ["jwt"];
                }

                // Does this endpoint have an associated ACL?
                let acl: AccessControlList | null = this.aclUtils?.enabled
                    ? Reflect.getMetadata("rrst:acl", route, key)
                    : null;
                if (acl && this.aclUtils?.enabled) {
                    acl.parentUid = defaultAcl?.uid;
                    acl = await this.aclUtils.saveDefaultACL(acl);
                }

                // Prepare the list of middleware to apply for the given endpoint.
                // The order of operations for middleware is:
                // 1. Requires Elevation
                // 2. Auth Strategies
                // 3. Required Roles
                // 4. Required Scopes
                // 5. Required Permissions (Path Matching)
                // 6. Validator Function
                // 7. Before Functions
                // 8. Decorated Function
                // 9. After Functions
                let middleware: Array<RequestHandler> = new Array();
                if (requiresElevation !== undefined) {
                    middleware.push(this.checkElevation(requiresElevation));
                }
                if (requiresTrustedRole) {
                    middleware.push(this.checkTrusedRoles());
                }
                if (requiredRoles) {
                    middleware.push(this.checkRequiredRoles(requiredRoles));
                }
                if (requiredScopes) {
                    middleware.push(this.checkRequiredScopes(requiredScopes));
                }
                if (this.aclUtils?.enabled) {
                    const aclUid: string | undefined = acl?.uid || defaultAcl?.uid;
                    if (aclUid) {
                        middleware.push(this.checkRequiredPerms(aclUid));
                    }
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
                                if (this.authMiddleware) {
                                    try {
                                        const result: AuthResult | undefined = this.authMiddleware.authenticateSync(
                                            authStrategies,
                                            req,
                                            undefined,
                                            false,
                                        );
                                        if (result) {
                                            return result;
                                        }
                                    } catch (err: any) {
                                        return { reject: true };
                                    }
                                }
                                // No token — fall through to post-upgrade message-based auth
                                return {};
                            };

                            // Build a per-path copy of the middleware chain. `middleware` is shared across
                            // every verb/basePath combination for this decorated method (and, once
                            // registered, held by reference by the router), so mutating it in place here
                            // would corrupt other registrations sharing the same array.
                            const wsMiddleware: Array<RequestHandler> = this.authMiddleware
                                ? [this.authMiddleware.authWebSocket(authRequired), ...middleware]
                                : [...middleware];

                            // Register with the HttpRouter's ws() method; trailing slash handled internally
                            app.ws(path, wsMiddleware, undefined, upgradeAuth);

                            // Update our OpenAPI spec — WebSocket upgrade is a GET request
                            this.apiSpec.addRoute(key, path, "get", metadata, docs, route, true);
                            this.logger.info("Registered Route: WS " + path);
                            continue;
                        }

                        // Build the auth middleware for this route
                        if (this.authMiddleware && authStrategies && authStrategies.length > 0) {
                            // Required auth — reject with 401 if no valid authentication
                            const authMw: RequestHandler = async (req, _res, next) => {
                                if (!this.authMiddleware) {
                                    throw new Error("authMiddleware is not set.");
                                }
                                try {
                                    const result: AuthResult | undefined = await this.authMiddleware.authenticate(
                                        authStrategies,
                                        req,
                                        _res,
                                        authRequired,
                                    );
                                    req.auth = result;
                                    req.user = result?.user;
                                    if (!result && authRequired) {
                                        next(new ApiError(ApiErrors.AUTH_FAILED, 401, ApiErrorMessages.AUTH_FAILED));
                                        return;
                                    }
                                    next();
                                } catch (err: any) {
                                    if (authRequired) {
                                        next(new ApiError(ApiErrors.AUTH_FAILED, 401, err.message));
                                    } else {
                                        next();
                                    }
                                }
                            };
                            app[verb](path, authMw, ...middleware);
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
        // Capture at registration time — decorator metadata never changes after class definition.
        const proto = Object.getPrototypeOf(obj);
        const argMetadata: any = Reflect.getMetadata("rrst:args", proto, func.name);
        const routeMetadata: any = Reflect.getMetadata("rrst:route", proto, func.name);
        const routeType: string | undefined = [...(routeMetadata?.methods?.keys() || [])][0];
        const funcLength = func.length;
        const boundFunc: Function = func.bind(obj);

        return async (req: HttpRequest, res: HttpResponse, next: NextFunction) => {
            try {
                // Pre-sized array avoids repeated push() + dynamic growth per invocation.
                // This is a hack that lets us stub out function arguments because we no longer can access
                // them directly with func.arguments. Unfortunately this means we can't get default values
                // as there's no way to reference them. =(
                const args: any[] = new Array(funcLength);

                // Populate the list of function arguments based on the metadata
                if (argMetadata) {
                    for (const key in argMetadata) {
                        const i: number = Number(key);
                        if (argMetadata[i][0] === "authResult") {
                            args[i] = req.auth;
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
                            const MAX_Q_BYTES = 65_536;
                            if ((isGetRoute || isHeadRoute) && _.has(args[i], "q")) {
                                const qParam = args[i]["q"];
                                if (typeof qParam !== "string" || qParam.length > MAX_Q_BYTES) {
                                    throw new ApiError(
                                        ApiErrors.INVALID_REQUEST,
                                        400,
                                        "Query parameter 'q' exceeds maximum allowed size.",
                                    );
                                }
                                const bufferJsonString = Buffer.from(qParam, "base64").toString("utf-8");
                                args[i] = JSON.parse(bufferJsonString);
                            }
                        } else if (argMetadata[i][0] === "request") {
                            args[i] = req;
                        } else if (argMetadata[i][0] === "response") {
                            args[i] = res;
                        } else if (argMetadata[i][0] === "user") {
                            args[i] = req.auth?.user;
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

                // Call the wrapped function (pre-bound at registration time)
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
