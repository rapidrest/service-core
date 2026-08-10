///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { ACLAction, type AccessControlList } from "../security/AccessControlList.js";

/**
 * Retrieves a copy of the `rrst:route` metadata for the given target/propertyKey. `Reflect.getMetadata` walks the
 * prototype chain, so when a subclass overrides a decorated method without having its own metadata yet, it would
 * otherwise receive the *same* metadata object instance stored on the base class. Mutating that shared object (as
 * the decorators below do) would corrupt the base class's metadata for every other subclass. Cloning here ensures
 * each class's metadata is independent while still inheriting the base's values at decoration time.
 *
 * @param target The class prototype to retrieve metadata for.
 * @param propertyKey The name of the method to retrieve metadata for.
 */
function getRouteMetadata(target: any, propertyKey: string): any {
    const existing: any = Reflect.getMetadata("rrst:route", target, propertyKey);
    return {
        ...existing,
        methods: existing?.methods ? new Map(existing.methods) : undefined,
    };
}

/**
 * Retrieves a copy of the `rrst:args` metadata for the given target/propertyKey, for the same reason described
 * above for `getRouteMetadata`: overriding a decorated method requires re-declaring its parameter decorators, which
 * would otherwise mutate the args metadata object inherited from the overridden ancestor method.
 *
 * @param target The class prototype to retrieve metadata for.
 * @param propertyKey The name of the method to retrieve metadata for.
 */
function getArgsMetadata(target: any, propertyKey: string): any {
    return { ...Reflect.getMetadata("rrst:args", target, propertyKey) };
}

/**
 * Concatenates all the provided strings and joins them with `/`.
 *
 * @param paths The list of strings to join with `/`.
 */
function join(...paths: string[]): string {
    let result = "";
    paths.forEach((val) => (result += val.startsWith("/") ? val : `/${val}`));
    return result;
}

/**
 * Indicates a provided function or list of functions to execute *after* the decorated function and before the response
 * is sent to a client. Note that the function must call `next()` in order for this decorator to work.
 *
 * @param func The function or list of functions to execute *after* the decorated function.
 */
export function After(func: Function | string | (Function | string)[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        let route: any = getRouteMetadata(target, propertyKey);

        // Ensure we always have an array of functions. Also, append the new list of functions to any existing list.
        let funcs: (Function | string)[] = Array.isArray(func) ? func : [func];
        route.after = route.after ? route.after.concat(funcs) : funcs;

        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Indicates that the decorated class contains route definitions. This prepends `/api` or `/api/v{version}` to
 * all provided path(s). e.g. `@ApiRoute('my-api')` results in `/api/my-api`. `@ApiRoute('my-api',2) results in
 * `/api/v2/my-api`.
 *
 * @param paths The base path(s) that all route definitions will use.
 * @param version The optional version number to prepend the path with. Prefixes the provided version with `v` in the path.
 */
export function ApiRoute(paths: string | string[], version?: string | number) {
    let tPaths: string[] = Array.isArray(paths) ? paths : [paths];
    tPaths = tPaths.map((path) => (version ? join("api", `v${version}`, path) : join("api", path)));
    return Route(tPaths);
}

/**
 * Applies authentication to the decorated route or method for the provided strategy or list of strategies
 * should be attempted before processing the route.
 *
 * @param strategies The strategies that will be applied when incoming requests are processed.
 * @param require Set to `true` to indicate that at least one of the specified authentication strategies must pass to
 * proceed, otherwise set to `false`. Default is `true`.
 */
export function Auth(strategies: string | string[], require: boolean = true) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        let route: any = getRouteMetadata(target, propertyKey);
        route.authStrategies = strategies;
        route.authRequired = require;
        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Injects the authenticated authentication result as the value of the decorated argument.
 */
export function AuthResult(target: any, propertyKey: string, index: number) {
    let args: any = getArgsMetadata(target, propertyKey);
    args[index] = ["authResult"];
    Reflect.defineMetadata("rrst:args", args, target, propertyKey);
}

/**
 * Indicates a provided function or list of functions to execute *before* the decorated function.
 *
 * @param func The function or list of functions to execute *before* the decorated function.
 */
export function Before(func: Function | string | (Function | string)[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        let route: any = getRouteMetadata(target, propertyKey);

        // Ensure we always have an array of functions. Also, append the new list of functions to any existing list.
        let funcs: (Function | string)[] = Array.isArray(func) ? func : [func];
        route.before = route.before ? route.before.concat(funcs) : funcs;

        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Indicates that the decorated function will return content encoded with the specified content type.
 *
 * @param type The content type that the function will return.
 */
export function ContentType(type: string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const route: any = getRouteMetadata(target, propertyKey);
        route.contentType = type;
        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Indicates that the decorated function handles incoming `DELETE` requests at the given sub-path.
 *
 * @param path The sub-path that the route will handle requests for.
 */
export function Delete(path?: string) {
    return Method("delete", path);
}

/**
 * Indicates that the decorated function handles incoming `GET` requests at the given sub-path.
 *
 * @param path The sub-path that the route will handle requests for.
 */
export function Get(path?: string) {
    return Method("get", path);
}

/**
 * Indicates that the decorated function handles incoming `HEAD` requests at the given sub-path.
 *
 * @param path The sub-path that the route will handle requests for.
 */
export function Head(path?: string) {
    return Method("head", path);
}

/**
 * Injects the value of the specified request header with the given name as the value of the decorated argument.
 *
 * @param name The name of the header whose value will be injected.
 */
export function Header(name: string) {
    return function (target: any, propertyKey: string, index: number) {
        let args: any = getArgsMetadata(target, propertyKey);
        args[index] = ["header", name];
        Reflect.defineMetadata("rrst:args", args, target, propertyKey);
    };
}

/**
 * Indicates that the decorated function handles incoming HTTP requests for the specified HTTP method(s) at the given sub-path.
 *
 * @param method The HTTP method(s) to handle requests for.
 * @param path The sub-path that the route handles requests for.
 */
export function Method(method: string | string[], path?: string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        let route: any = getRouteMetadata(target, propertyKey);
        const pathFinal: string = path ? path : "";

        if (!route.methods) {
            route.methods = new Map();
        }

        let methods: string[] = Array.isArray(method) ? method : [method];
        for (let key of methods) {
            route.methods.set(key, pathFinal);
        }

        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Indicates that the class utilizes is a manager for the specified class type.
 *
 * @param type The data model class type to associate the class with.
 */
export function Model(type: any) {
    return function <T extends { new (...args: any[]): {} }>(constructor: T) {
        return class extends constructor {
            /** The class type of the data model type associated with this class. */
            public static readonly modelClass: any = type;
        };
    };
}

/**
 * Indicates that the decorated function handles incoming `OPTIONS` requests at the given sub-path.
 *
 * @param path The sub-path that the route will handle requests for.
 */
export function Options(path?: string) {
    return Method("options", path);
}

/**
 * Injects the value of the specified URI parameter with the given name as the value of the decorated argument. If no
 * name is specified the entire request parameter will be injected.
 *
 * @param name The name of the URI parameter whose value will be injected.
 */
export function Param(name: string | undefined = undefined) {
    return function (target: any, propertyKey: string, index: number) {
        let args: any = getArgsMetadata(target, propertyKey);
        args[index] = ["param", name];
        Reflect.defineMetadata("rrst:args", args, target, propertyKey);
    };
}

/**
 * Indicates that the decorated function handles incoming `PATCH` requests at the given sub-path.
 *
 * @param path The sub-path that the route will handle requests for.
 */
export function Patch(path?: string) {
    return Method("patch", path);
}

/**
 * Indicates that the decorated function handles incoming `POST` requests at the given sub-path.
 *
 * @param path The sub-path that the route will handle requests for.
 */
export function Post(path?: string) {
    return Method("post", path);
}

/**
 * Indicates that the decorated function handles incoming `PUT` requests at the given sub-path.
 *
 * @param path The sub-path that the route will handle requests for.
 */
export function Put(path?: string) {
    return Method("put", path);
}

type PartialACL = Partial<AccessControlList> & Pick<AccessControlList, "records">;

/**
 * Apply this to any route handler class or an individual route handler function to indicate that it should be
 * protected by the AccessControlList security system. The `acl` parameter specifies the ACL governing access
 * to the HTTP resource(s) defined. If a class and a given route handler function both have this decorator
 * applied, the class ACL will be listed as the parent to the function's ACL object, thus inheriting
 * whatever permissions applied to the class level.
 *
 * @param acl The access control list to define for this route class or handler. Not specifying a value here
 * *          will default to the behavior of denying anonymous access to the resource and allowing any authenticated
 * *         user CRUD access.
 */
export function Protect(
    acl: PartialACL = {
        uid: "<UniqueName>",
        records: [
            {
                userOrRoleId: "anonymous",
                actions: [],
            },
            {
                userOrRoleId: ".*",
                actions: [
                    ACLAction.COUNT,
                    ACLAction.CREATE,
                    ACLAction.DELETE,
                    ACLAction.EXISTS,
                    ACLAction.READ,
                    ACLAction.LIST,
                    ACLAction.TRUNCATE,
                    ACLAction.UPDATE,
                ],
            },
        ],
    },
) {
    return function (target: any, propertyKey?: string) {
        if (!acl.uid || acl.uid === "<UniqueName>") {
            acl.uid = propertyKey ? `${target.constructor.name}.${propertyKey}` : `${target.name}`;
        }
        if (propertyKey) {
            Reflect.defineMetadata("rrst:acl", acl, target, propertyKey);
        } else {
            Reflect.defineMetadata("rrst:acl", acl, target.prototype);
        }
    };
}

/**
 * Injects the value of the specified query parameter with the given name as the value of the decorated argument. If
 * no name is specified the entire request query will be injected.
 *
 * @param name THe name of the query parameter whose value will be injected.
 */
export function Query(name: string | undefined = undefined) {
    return function (target: any, propertyKey: string, index: number) {
        let args: any = getArgsMetadata(target, propertyKey);
        args[index] = ["query", name];
        Reflect.defineMetadata("rrst:args", args, target, propertyKey);
    };
}

/**
 * Injects the HTTP request object as the value of the decorated argument.
 */
export function Request(target: any, propertyKey: string, index: number) {
    let args: any = getArgsMetadata(target, propertyKey);
    args[index] = ["request"];
    Reflect.defineMetadata("rrst:args", args, target, propertyKey);
}

/**
 * Injects the HTTP response object as the value of the decorated argument.
 */
export function Response(target: any, propertyKey: string, index: number) {
    let args: any = getArgsMetadata(target, propertyKey);
    args[index] = ["response"];
    Reflect.defineMetadata("rrst:args", args, target, propertyKey);
}

/**
 * Indicates that elevated user permissions is required to perform the action. Optionally, set a `lastStart` which is the number
 * of seconds that the user has most recently confirmed elevation. A negative value indicates until the end of the elevated
 * window. Default is `-1`.
 */
export function RequiresElevation(lastStart: number = -1) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        let route: any = getRouteMetadata(target, propertyKey);
        route.requiresElevation = lastStart;
        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Indicates that the client must be an authenticated user with at least one of the specified role(s) to process the
 * request.
 *
 * @param roles The role(s) that an authenticated user must have to make the request.
 */
export function RequiresRole(roles: string | string[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        let route: any = getRouteMetadata(target, propertyKey);
        route.requiredRoles = Array.isArray(roles) ? roles : [roles];
        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Indicates that the client's token must carry at least one of the specified OAuth-style scope(s) to process the
 * request. This is a coarse, token-level pre-check performed before the per-resource `AccessControlList` check —
 * it answers "can this token ever perform this class of action" rather than "can this user perform this action on
 * this specific resource".
 *
 * @param scopes The scope(s) that the authenticated user's token must carry to make the request. The sentinel
 * value `ACLAction.FULL` (`"*"`) also satisfies any required scope.
 */
export function RequiresScope(scopes: string | string[]) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        let route: any = getRouteMetadata(target, propertyKey);
        route.requiredScopes = Array.isArray(scopes) ? scopes : [scopes];
        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Indicates that the client must be an authenticated user with at least one trusted role(s) to process the
 * request.
 */
export function RequiresTrustedRole() {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        let route: any = getRouteMetadata(target, propertyKey);
        route.requiresTrustedRole = true;
        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Indicates that the decorated class contains route definitions.
 *
 * @param paths The base path(s) that all route definitions will use.
 */
export function Route(paths: string | string[]) {
    return function (target: Function) {
        let routePaths: string[] = Reflect.getMetadata("rrst:routePaths", target.prototype) || [];
        routePaths = routePaths.concat(Array.isArray(paths) ? paths : [paths]);
        Reflect.defineMetadata("rrst:routePaths", routePaths, target.prototype);
    };
}

/**
 * Injects the underlying Socket object associated with the request as the value of the decorated argument.
 * When the handler function is for a WebSocket request, the returned socket will be the newly established
 * WebSocket connection.
 */
export function Socket(target: any, propertyKey: string, index: number) {
    let args: any = getArgsMetadata(target, propertyKey);
    args[index] = ["socket"];
    Reflect.defineMetadata("rrst:args", args, target, propertyKey);
}

/**
 * Injects the authenticated user object as the value of the decorated argument.
 */
export function User(target: any, propertyKey: string, index: number) {
    let args: any = getArgsMetadata(target, propertyKey);
    args[index] = ["user"];
    Reflect.defineMetadata("rrst:args", args, target, propertyKey);
}

/**
 * Indicates a validation function to execute in order to verify an incoming requests payload.
 *
 * @param func The validation function to execute that will verify the request payload.
 */
export function Validate(func: Function | string) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        let route: any = getRouteMetadata(target, propertyKey);
        route.validator = func;
        Reflect.defineMetadata("rrst:route", route, target, propertyKey);
    };
}

/**
 * Indicates that the decorated function handles incoming `WebSocket` upgrade requests at the given sub-path.
 *
 * @param path The sub-path that the route will handle requests for.
 */
export function WebSocket(path?: string) {
    return Method("ws", path);
}
