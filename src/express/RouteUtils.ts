///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ApiError, JWTPayload, JWTUser, JWTUtils, ObjectDecorators, UserUtils } from "@rapidrest/core";
import { Request, Response, NextFunction, RequestHandler } from "express";
import { ServerResponse } from "http";
import { RequestWS } from "./WebSocket.js";
import { OpenApiSpec } from "../OpenApiSpec.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import { AccessControlList, ACLUtils } from "../security/index.js";
const { Config, Inject, Logger } = ObjectDecorators;
import passport from "passport";
import _ from "lodash";

/**
 * Provides a set of utilities for converting Route classes to ExpressJS middleware.
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

    /**
     * Creates an Express middleware function that verifies the incoming request is from a valid user with at least
     * one of the specified roles.
     */
    public checkRequiredPerms(aclUid: string): RequestHandler {
        return async (req: Request, res: Response, next: NextFunction) => {
            let granted: boolean = this.aclUtils
                ? await this.aclUtils.checkRequestPerms(aclUid, req.user as any, req)
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
        return (req: Request, res: Response, next: NextFunction) => {
            const sock: any = (req as RequestWS).websocket || req.socket;
            const user: JWTUser | undefined = req.user as JWTUser;

            if (user && user.uid) {
                next();
            } else {
                // Set a timer to allow the login message to arrive. If the timer expires before
                // a login message is received we'll proceed processing in order to prevent
                // blocking up the handler.
                let timer: NodeJS.Timeout = setTimeout(() => {
                    if (required) {
                        const error: ApiError = new ApiError(ApiErrors.AUTH_FAILED, 401, ApiErrorMessages.AUTH_FAILED);
                        error.status = 401;
                        sock.close(1002, error.message);
                        next(error);
                    } else {
                        // Auth isn't required so just move along
                        next();
                    }
                }, this.authSocketTimeout);

                // If no user has auth'd yet then wait for a login message to arrive.
                sock.once("message", (data: any, isBinary: boolean) => {
                    clearTimeout(timer);
                    if (!isBinary) {
                        try {
                            // Decode the incoming message
                            const message: any = JSON.parse(data);

                            // Ensure that this is a login request
                            if (message.type === "LOGIN") {
                                // Is the provided auth token valid?
                                const payload: JWTPayload = JWTUtils.decodeToken(this.authConfig, message.data);
                                const user: JWTUser | null =
                                    payload && payload.profile ? (payload.profile as JWTUser) : null;
                                if (user && user.uid) {
                                    sock.send(
                                        JSON.stringify({ id: message.id, type: "LOGIN_RESPONSE", success: true })
                                    );
                                    req.user = user;
                                    next();
                                } else if (required) {
                                    const error: ApiError = new ApiError(
                                        ApiErrors.AUTH_FAILED,
                                        401,
                                        ApiErrorMessages.AUTH_FAILED
                                    );
                                    sock.send(
                                        JSON.stringify({
                                            id: message.id,
                                            type: "LOGIN_RESPONSE",
                                            success: false,
                                            data: error.message,
                                        })
                                    );
                                    sock.close(1002, error.message);
                                    next(error);
                                } else {
                                    // Notify the client that their token was bad, but we'll proceed anyway
                                    sock.send(
                                        JSON.stringify({
                                            id: message.id,
                                            type: "LOGIN_RESPONSE",
                                            success: false,
                                            data: "Invalid authentication token.",
                                        })
                                    );
                                    // Auth isn't required so just move along
                                    next();
                                }
                            } else if (required) {
                                const error: ApiError = new ApiError(
                                    ApiErrors.INVALID_REQUEST,
                                    400,
                                    ApiErrorMessages.INVALID_REQUEST
                                );
                                sock.close(1002, error.code);
                                next(error);
                            } else {
                                // Auth isn't required so just move along
                                next();
                            }
                        } catch (err: any) {
                            if (required) {
                                const error: ApiError = new ApiError(
                                    ApiErrors.INVALID_REQUEST,
                                    400,
                                    ApiErrorMessages.INVALID_REQUEST
                                );
                                sock.close(1002, error.code);
                                next(error);
                            } else {
                                // Auth isn't required so just move along
                                next();
                            }
                        }
                    } else if (required) {
                        const error: ApiError = new ApiError(
                            ApiErrors.INVALID_REQUEST,
                            400,
                            ApiErrorMessages.INVALID_REQUEST
                        );
                        sock.close(1002, error.code);
                        next(error);
                    } else {
                        // Auth isn't required so just move along
                        next();
                    }
                });
            }
        };
    }

    /**
     * Creates an Express middleware function that verifies the incoming request is from a valid user with at least
     * one of the specified roles.
     *
     * @param requiredRoles The list of roles that the authenticated user must have.
     */
    public checkRequiredRoles(requiredRoles: string[]): RequestHandler {
        return (req: Request, res: Response, next: NextFunction) => {
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
     * @param app The Express application to register the route to.
     * @param route The route object to register with Express.
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
                        let subpath: string = entry[1].startsWith("/") ? entry[1].substr(1) : entry[1];
                        let path: string =
                            subpath.length === 0 || basePath.endsWith("/")
                                ? basePath + subpath
                                : basePath + "/" + subpath;

                        // If the verb is `ws` we need to translate this accordingly
                        if (verb === "ws") {
                            // Rewrite our verb to be `get` so that Express' internal plumbing works correctly
                            verb = "get";
                            // We add .websocket to the end of the path so that other routes using different
                            // verbs will still function correctly
                            path += ".websocket";
                            // Also add the websocket auth handler as the first middleware function
                            middleware.unshift(this.authWebSocket(authRequired));
                            // Set authRequired to false since we enforce it in the authWebSocket function
                            authRequired = false;
                        }

                        // If auth strategies are provided add the necessary passport middleware
                        if (authStrategies && authStrategies.length > 0) {
                            // Passport no longer supports the allowFailure flag so we must write our own wrapper
                            // to provide this functionality.
                            if (authRequired) {
                                app[verb](
                                    path,
                                    passport.authenticate(authStrategies, {
                                        session: false,
                                    }, undefined),
                                    ...middleware
                                );
                            } else {
                                app[verb](
                                    path,
                                    (req, res, next) => {
                                        passport.authenticate(authStrategies, {
                                            session: false,
                                        }, (err, user) => {
                                            if (err) { return next(err); }
                                            req.user = user || undefined;
                                            next();
                                        })(req, res, next);
                                    },
                                    ...middleware
                                );
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
     * Wraps the provided function with Express handling based on the function's defined decorators.
     *
     * @param obj The bound object whose middleware function will be wrapped.
     * @param func The decorated function to wrap for registration with Express.
     * @param send Set to true to have `func`'s result sent to the client.
     */
    public wrapMiddleware(obj: any, func: Function, send: boolean = false): RequestHandler {
        return async (req: Request, res: Response, next: NextFunction) => {
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
                const isResponse: boolean =
                    result instanceof ServerResponse || (result && result.headers && result.url);
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
