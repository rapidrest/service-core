///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type uWS from "uWebSockets.js";
import * as path from "path";
import * as prom from "prom-client";
import "reflect-metadata";
import { ConnectionManager } from "./database/ConnectionManager.js";
import { ApiError, ClassLoader, Logger } from "@rapidrest/core";
import { ObjectFactory } from "./ObjectFactory.js";
import { BackgroundServiceManager } from "./BackgroundServiceManager.js";
import { RouteUtils } from "./routes/RouteUtils.js";
import { BulkError } from "./BulkError.js";
import { BackgroundService } from "./BackgroundService.js";
import { OpenApiSpec } from "./OpenApiSpec.js";
import { ApiErrorMessages, ApiErrors } from "./ApiErrors.js";
import { ACLUtils } from "./security/ACLUtils.js";
import { NotificationUtils } from "./NotificationUtils.js";
import { EventListenerManager } from "./EventListenerManager.js";
import { AccessControlListMongo } from "./security/AccessControlListMongo.js";
import { AccessControlListSQL } from "./security/AccessControlListSQL.js";
import { DEFAULT_MAX_BODY_SIZE } from "./http/uWS/Adapters.js";
import type { HttpRequest, HttpResponse, IHttpRouter, NextFunction } from "./http/types.js";
import { isBunRuntime } from "./http/RuntimeDetect.js";
import { SessionManager } from "./http/session/SessionManager.js";
import { createSessionMiddleware } from "./http/session/sessionMiddleware.js";

/** The metrics label used for every request that didn't match a registered application route. */
export const UNMATCHED_ROUTE_LABEL = "<unmatched>";

/** Default time `Server.stop()` waits for in-flight requests to finish, in milliseconds (`shutdown:drain_timeout`). */
export const DEFAULT_DRAIN_TIMEOUT_MS = 10000;

/**
 * The configuration options to use when constructing a new Server instance.
 */
export interface ServerOptions {
    /** The nconf-compatible configuration object to initialize the server with. */
    config: any;
    /** The base file system path that models and routes will be searched from. Default is `.` */
    basePath?: string;
    /** The logging utility to use for outputing to console/file. Default is `Logger()` from `@rapidrest/core`. */
    logger?: any;
    /** The ClassLoader used to scan the source for all exported classes. */
    classLoader?: ClassLoader;
    /** The object factory to use for automatic dependency injection (IOC). */
    objectFactory?: ObjectFactory;
}

/**
 * Provides an HTTP server utilizing uWebSockets.js. The server automatically registers all routes, and
 * establishes database connections for all configured data stores. Additionally provides automatic authentication
 * handling using JSON Web Token (JWT) directly — no Passport dependency required. When provided an OpenAPI
 * specification object the server will also automatically serve this specification via the `GET /openapi.json` route.
 *
 * Routes are defined by creating any class definition using the various decorators found in `RouteDecorators` and
 * saving these files in the `routes` subfolder. Upon server start, the `routes` folder is scanned for any class
 * that has been decorated with `@Route` and is automatically loaded and registered. Similarly, if the
 * class is decorated with the `@Model` decorator the resulting route object will have the associated data model
 * definition object injected into the constructor.
 *
 * SSL termination is supported by providing an `ssl` configuration block with `key`, `cert`, and optionally
 * `ca` and `passphrase` file paths. When `ssl` is present the server uses `uWS.SSLApp()`.
 *
 * IPv6 is supported by setting `listen_host` to `"::"` in configuration (default `"0.0.0.0"`).
 *
 * By default all registered endpoints that do not explicitly have an `@Auth` decorator have the `JWT`
 * authentication strategy applied. This allows users to be implicitly authenticated without requiring additional
 * configuration. Once authenticated, the provided `request` argument will have the `user` property available
 * containing information about the authenticated user. If the `user` property is `undefined` then no user has
 * been authenticated or the authentication attempt failed.
 *
 * The following is an example of a simple route class.
 *
 * ```javascript
 * import { DefaultBehaviors, RouteDecorators } from "@rapidrest/service-core";
 * import { Get, Route } = RouteDecorators;
 *
 * @Route("/hello")
 * class TestRoute extends ModelRoute {
 *    constructor(model: any) {
 *        super(model);
 *    }
 *
 *    @Get()
 *    count(req: any, res: any, next: Function): any {
 *        return res.send("Hello World!");
 *    }
 * }
 *
 * export default TestRoute;
 * ```
 *
 * The following is an example of a route class that is bound to a data model providing basic CRUDS operations.
 *
 * ```javascript
 * import { DefaultBehaviors, ModelDecorators, ModelRoute, RouteDecorators } from "@rapidrest/service-core";
 * import { After, Before, Delete, Get, Post, Put, Route, Validate } = RouteDecorators;
 * import { Model } = ModelDecorators;
 * import { marshall } = DefaultBehaviors;
 *
 * @Model("Item")
 * @Route("/items")
 * class ItemRoute extends ModelRoute {
 *     constructor(model: any) {
 *       super(model);
 *   }
 *
 *   @Get()
 *   @Before(super.count)
 *   @After(marshall)
 *   count(req: any, res: any, next: Function): any {
 *       return next();
 *   }
 *
 *   @Post()
 *   @Before([super.create])
 *   @After([this.prepare, marshall])
 *   create(req: any, res: any, next: Function): any {
 *       return next();
 *   }
 *
 *   @Delete(":id")
 *   @Before([super.delete])
 *   delete(req: any, res: any, next: Function): any {
 *       return next();
 *   }
 *
 *   @Get()
 *   @Before([super.findAll])
 *   @After(this.prepareAndSend)
 *   findAll(req: any, res: any, next: Function): any {
 *       return next();
 *   }
 *
 *   @Get(":id")
 *   @Before([super.findById])
 *   @After([this.prepare, marshall])
 *   findById(req: any, res: any, next: Function): any {
 *       return next();
 *   }
 *
 *   @Put(":id")
 *   @Before([super.update])
 *   @After([this.prepare, marshall])
 *   update(req: any, res: any, next: Function): any {
 *       return next();
 *   }
 * }
 *
 * export default ItemRoute;
 * ```
 *
 * @author Jean-Philippe Steinmetz
 */
export class Server {
    /** The OpenAPI specification object to use to construct the server with. */
    protected apiSpec?: OpenApiSpec;
    /** The underlying HTTP router (uWS-backed on Node, Bun.serve()-backed under the Bun runtime) that provides HTTP processing services. */
    protected app!: IHttpRouter;
    /** The base file system path that will be searched for models and routes. */
    protected readonly basePath: string;
    /** The global object containing configuration information to use. */
    protected readonly config?: any;
    /** The manager for handling database connections. */
    protected connectionManager?: ConnectionManager;
    /** The ClassLoader used to scan the source for all exported classes. */
    protected classLoader: ClassLoader;
    /** The manager for handling events. */
    protected eventListenerManager?: EventListenerManager;
    /** The logging utility to use when outputing to console/file. */
    protected readonly logger: any;
    /** The object factory to use when injecting dependencies. */
    protected readonly objectFactory: ObjectFactory;
    /** The port that the server is listening on. */
    public readonly port: number;
    protected routeUtils?: RouteUtils;
    protected serviceManager?: BackgroundServiceManager;
    /** Manages cross-request session support. Only set when a `session` config block is present. */
    protected sessionManager?: SessionManager;

    ///////////////////////////////////////////////////////////////////////////
    // METRICS VARIABLES
    ///////////////////////////////////////////////////////////////////////////
    // The `path` label of the request metrics is the matched route pattern (e.g. `/items/:id`), or
    // `UNMATCHED_ROUTE_LABEL` for a request no route matched - never the raw request path, which a client controls and
    // which would create a new, never-released time series per distinct URL.
    protected metricRequestPath: prom.Counter<string> = new prom.Counter({
        name: "request_path",
        help: "A count of the number of handled requests by the matched route pattern.",
        labelNames: ["path"],
    });
    protected metricRequestStatus: prom.Counter<string> = new prom.Counter({
        name: "request_status",
        help: "A count of the resulting status code of handled requests by the requested method and matched route pattern.",
        labelNames: ["method", "path", "statusCode"],
    });
    protected metricRequestTime: prom.Histogram<string> = new prom.Histogram({
        name: "request_time_milliseconds",
        help: "A histogram of the response time of handled requests by the requested method, matched route pattern and code.",
        labelNames: ["method", "path", "statusCode"],
        buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 5000],
    });
    protected metricCompletedRequests: prom.Counter<string> = new prom.Counter({
        name: "num_completed_requests",
        help: "The total number of successfully completed requests.",
    });
    protected metricFailedRequests: prom.Counter<string> = new prom.Counter({
        name: "num_failed_requests",
        help: "The total number of failed requests.",
    });
    protected metricTotalRequests: prom.Counter<string> = new prom.Counter({
        name: "num_total_requests",
        help: "The total number of requests processed.",
    });

    /**
     * Creates a new instance of Server with the specified default options.
     *
     * @param options The configuration options to apply for this server.
     */
    constructor(options: ServerOptions) {
        this.config = options.config;
        this.basePath = options.basePath ?? ".";
        this.logger = options.logger ?? Logger();
        this.classLoader =
            options.classLoader ?? new ClassLoader(this.basePath, true, true, this.config.get("class_loader:ignore"));
        this.objectFactory = options.objectFactory ?? new ObjectFactory(this.config, this.logger);
        this.port = this.config.get("port") ?? 3000;
    }

    /**
     * Returns the HTTP router instance.
     */
    public getApplication(): IHttpRouter {
        return this.app;
    }

    /**
     * Returns `true` if the server is running, otherwise `false`.
     */
    public isRunning(): boolean {
        return this.app ? this.app.isListening : false;
    }

    /**
     * Override this function to add custom behavior before the server is started.
     */
    protected preStart(): void | Promise<void> {
        // Nothing to do
    }

    /**
     * Override this function to add custom behavior after the server is started.
     */
    protected postStart(): void | Promise<void> {
        // Nothing to do
    }

    /**
     * Starts an HTTP listen server based on the provided configuration and OpenAPI specification.
     */
    public start(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            try {
                this.logger.info("Starting server...");

                await this.preStart();

                // Create an OpenApiSpec object that we'll use to build an external reference of the server's API
                this.apiSpec = await this.objectFactory.newInstance(OpenApiSpec, { name: "default" });

                this.connectionManager = await this.objectFactory.newInstance(ConnectionManager, { name: "default" });
                const datastores: any = this.config.get("datastores");
                const models: Map<string, any> = new Map();

                this.logger.info("Loading all service classes...");
                try {
                    await this.classLoader.load();
                } catch (e) {
                    reject(`[server-core|Server.ts]**ERR @ start, loading service classes: ${e}`);
                    return;
                }

                // Register all found classes with the object factory
                for (const [name, clazz] of this.classLoader.getClasses().entries()) {
                    this.objectFactory.register(clazz, name);
                }

                // Load all models
                this.logger.info("Scanning for data models...");
                for (const [name, clazz] of this.classLoader.getClasses().entries()) {
                    const datasource: string | undefined = Reflect.getMetadata("rrst:datasource", clazz) || undefined;
                    if (datasource) {
                        models.set(name, clazz);
                        this.apiSpec.addModel(name, clazz);
                    }
                }

                // If ACL has been configured we need to make sure the proper models are configured and loaded
                if (datastores.acl) {
                    if (datastores.acl.type === "mongodb" || datastores.acl.type === "mongodb+srv") {
                        models?.set(AccessControlListMongo.name, AccessControlListMongo);
                        this.apiSpec.addModel(AccessControlListMongo.name, AccessControlListMongo);
                    } else {
                        models?.set(AccessControlListSQL.name, AccessControlListSQL);
                        this.apiSpec.addModel(AccessControlListSQL.name, AccessControlListSQL);
                    }
                }

                // Initiate all database connections
                this.logger.info("Initializing database connection(s)...");
                await this.connectionManager.connect(datastores, models);

                // Initialize ACL utility
                await this.objectFactory.newInstance(ACLUtils, { name: "default" });

                // Initialize push notifications utility if configured
                const pushRedis: any = this.connectionManager?.connections.get("notifications");
                if (pushRedis) {
                    await this.objectFactory.newInstance(NotificationUtils, { name: "default", args: [pushRedis] });
                }

                // Create the underlying HTTP router — Bun.serve()-backed under the Bun runtime,
                // uWS-backed (SSLApp when ssl config is present, plain App otherwise) on Node.
                // Both `uWebSockets.js` and `./http/uWS/Router.js` are dynamically imported here
                // (never statically) so neither is ever evaluated when running under Bun, where
                // uWebSockets.js's native binary does not load.
                const sslConfig: any = this.config.get("ssl");
                const maxBodySize: number = this.config.get("max_body_size") ?? DEFAULT_MAX_BODY_SIZE;

                if (isBunRuntime()) {
                    const { BunRouter } = await import("./http/bun/BunRouter.js");
                    this.app = new BunRouter(maxBodySize, sslConfig);
                } else {
                    const uWS = (await import("uWebSockets.js")).default;
                    const { HttpRouter } = await import("./http/uWS/Router.js");
                    const uwsApp: uWS.TemplatedApp = sslConfig
                        ? uWS.SSLApp({
                              key_file_name: sslConfig.key,
                              cert_file_name: sslConfig.cert,
                              ca_file_name: sslConfig.ca,
                              passphrase: sslConfig.passphrase,
                          })
                        : uWS.App();
                    this.app = new HttpRouter(uwsApp, maxBodySize);
                }

                // cors
                const corsConfig: any = this.config.get("cors") || {};
                const corsOrigins: string | string[] | undefined = corsConfig.origins;
                const corsAllowedHeaders = [
                    "Accept",
                    "Authorization",
                    "Content-Type",
                    "Location",
                    "Origin",
                    "Set-Cookie",
                    "X-Requested-With",
                ].join(", ");
                this.app.use((req: HttpRequest, res: HttpResponse, next: NextFunction) => {
                    const origin = (req.headers["origin"] as string) || "";
                    // When no allow-list is configured, permit all origins without credentials.
                    // Only reflect a specific origin (with credentials) when it matches the explicit list.
                    let allowOrigin = "";
                    let allowCredentials = false;
                    if (!corsOrigins || corsOrigins === "*") {
                        allowOrigin = "*";
                    } else if (Array.isArray(corsOrigins) ? corsOrigins.includes(origin) : corsOrigins === origin) {
                        allowOrigin = origin;
                        allowCredentials = true;
                    }
                    if (allowOrigin) {
                        res.setHeader("access-control-allow-origin", allowOrigin);
                        if (allowCredentials) {
                            res.setHeader("access-control-allow-credentials", "true");
                        }
                        res.setHeader("access-control-allow-methods", "GET,HEAD,OPTIONS,PUT,PATCH,POST,DELETE");
                        res.setHeader("access-control-allow-headers", corsAllowedHeaders);
                    }
                    // A real, app-registered `OPTIONS` route (e.g. an EAS route's `MS-ASProtocolVersions`
                    // capability-discovery response) gets a chance to run instead of the blanket preflight
                    // 204 below - checked at request time, by which point every app route has already been
                    // registered during startup. See `IHttpRouter.hasExplicitOptionsRoute()`'s own doc
                    // comment for why this can't be a build-time decision.
                    if (req.method === "OPTIONS" && !this.app.hasExplicitOptionsRoute(req.path)) {
                        res.status(204).send();
                        return;
                    }
                    return next();
                });

                // Set all custom headers
                const headers: any = this.config.get("headers") || {
                    "x-powered-by": "RapidREST",
                };
                this.app.use((_req: HttpRequest, res: HttpResponse, next: NextFunction) => {
                    for (const key in headers) {
                        res.setHeader(key, headers[key]);
                    }
                    return next();
                });

                // Stamp request start time — recorded in the terminal middleware to avoid
                // per-request closure + bound-function allocations from monkey-patching res.end.
                this.app.use((req: HttpRequest, _res: HttpResponse, next: NextFunction) => {
                    (req as any)._metricsStart = Date.now();
                    return next();
                });

                // Initialize session support if configured. Global-but-cheap: only registered when
                // a `session` config block is present, so apps that don't configure sessions pay
                // zero per-request cost (mirrors the NotificationUtils conditional-feature pattern).
                const sessionConfig: any = this.config.get("session");
                if (sessionConfig) {
                    this.sessionManager = await this.objectFactory.newInstance(SessionManager, { name: "default" });
                    this.app.use(createSessionMiddleware(this.sessionManager));
                }

                const allRoutes: Array<any> = [];

                this.routeUtils = await this.objectFactory.newInstance(RouteUtils, { name: "default" });
                if (!this.routeUtils) {
                    reject("Failed to instantiate RouteUtils.");
                    return;
                }

                // Initialize the background service manager
                this.logger.info("Starting background services...");
                const serviceClasses: any = {};
                for (const [name, clazz] of this.classLoader.getClasses().entries()) {
                    if (clazz.prototype instanceof BackgroundService) {
                        serviceClasses[name] = clazz;
                    }
                }
                this.serviceManager = await this.objectFactory.newInstance(BackgroundServiceManager, {
                    name: "default",
                    initialize: true,
                    args: [this.objectFactory, serviceClasses],
                });
                if (this.serviceManager) {
                    await this.serviceManager.startAll();
                }

                // Initialize the EventListenerManager.
                const redis: any = this.connectionManager?.connections.get("events");
                if (redis) {
                    this.logger.info("Initializing event manager...");
                    this.eventListenerManager = await this.objectFactory.newInstance(EventListenerManager, {
                        name: "default",
                        args: [this.objectFactory, redis],
                    });
                }

                // Perform automatic discovery of all other routes
                this.logger.info("Scanning for routes...");
                try {
                    for (const [fqn, clazz] of this.classLoader.getClasses().entries()) {
                        const routePaths: string[] | undefined = clazz.prototype
                            ? Reflect.getMetadata("rrst:routePaths", clazz.prototype)
                            : Reflect.getMetadata("rrst:routePaths", clazz);
                        if (routePaths) {
                            this.objectFactory.register(clazz, fqn);
                            const route: any = await this.objectFactory.newInstance(fqn, { name: "default" });
                            await this.routeUtils.registerRoute(this.app, route);
                            allRoutes.push(route);
                            // Routes are instantiated after the EventListenerManager registration pass above,
                            // so any `@OnEvent` handlers they declare must be registered here instead.
                            this.eventListenerManager?.register(route);
                        }
                    }
                } catch (err) {
                    reject(err);
                    return;
                }

                // Error handling. NOTE: Must be defined last.
                // 4-param signature signals error handler to runChain
                this.app.use(((err: any, req: HttpRequest, res: HttpResponse, next: NextFunction) =>
                    this.handleError(err, req, res, next)) as any);

                this.app.use((req: HttpRequest, res: HttpResponse) => this.recordRequestMetrics(req, res));

                await this.postStart();

                // IPv6: set listen_host to "::" in config; default binds to all IPv4 interfaces
                const listenHost: string = this.config.get("listen_host") || "0.0.0.0";
                await this.app.listen(listenHost, this.port);
                this.logger.info(`Listening on ${listenHost}:${this.port}...`);
                resolve();
            } catch (err) {
                this.logger.error(err);
                reject(err);
            }
        });
    }

    /**
     * Serializes one error for a client response. An `ApiError` keeps its own fields (`code`, `status`, `message`,
     * ...). Anything else, such as a raw database driver error carrying the failed SQL `query` and its `parameters`,
     * is replaced by the generic internal error so none of its details reach the client. Stack traces are never
     * included.
     *
     * @param err The error to serialize.
     */
    protected serializeError(err: any): any {
        if (!(err instanceof ApiError)) {
            return { code: ApiErrors.INTERNAL_ERROR, status: 500, message: ApiErrorMessages.INTERNAL_ERROR };
        }
        const result: any = {
            ...err,
            // https://stackoverflow.com/a/25245824
            level: (err as any).level ? (err as any).level.replace(/\[.*?m/g, "") : undefined,
            // `Error.message` (and `ApiError`'s own `message`) is non-enumerable, so `JSON.stringify` silently drops
            // it unless it is copied as an explicit own property.
            message: err.message,
        };
        delete result.stack;
        return result;
    }

    /**
     * The final error handling middleware. Logs the error and sends it to the client as JSON (see `serializeError()`).
     */
    protected handleError(err: any, _req: HttpRequest, res: HttpResponse, next: NextFunction): void {
        if (err) {
            // Only log 500-level errors. 400-level errors are the client's fault and
            // we don't need to spam the logs because of that.
            if (!(err instanceof ApiError) || err.status >= 500) {
                this.logger.error(err);
            } else {
                this.logger.debug(err);
            }

            if (typeof err === "string") {
                if (!res.headersSent) {
                    res.status(500);
                }
                res.json({ message: "Internal Server Error", status: 500 });
            } else if (err instanceof BulkError) {
                // Log the individual non-ApiError failures, since only a generic error is sent for them.
                for (const item of err.errors) {
                    if (item && !(item instanceof ApiError)) {
                        this.logger.error(item);
                    }
                }
                if (!res.headersSent) {
                    res.status(err.status);
                }
                res.json(err.errors.map((e) => (e ? this.serializeError(e) : e)));
            } else {
                if (!res.headersSent) {
                    res.status(err instanceof ApiError ? err.status : 500);
                }
                res.json(this.serializeError(err));
            }

            this.metricFailedRequests.inc(1);
        }

        return next();
    }

    /**
     * The final middleware of every request: records the request metrics and ends the response if nothing else did.
     * Metrics are labeled with `req.routePattern` rather than the raw path, so their cardinality is bounded by the
     * application's routes.
     */
    protected recordRequestMetrics(req: HttpRequest, res: HttpResponse): void {
        const route: string = req.routePattern ?? UNMATCHED_ROUTE_LABEL;
        const statusCode: string = String(res.statusCode);
        const start: number | undefined = (req as any)._metricsStart;
        if (start !== undefined) {
            this.metricRequestTime.labels(req.method, route, statusCode).observe(Date.now() - start);
        }
        this.metricRequestPath.labels(route).inc();
        this.metricRequestStatus.labels(req.method, route, statusCode).inc();
        this.metricTotalRequests.inc(1);
        this.metricCompletedRequests.inc(1);
        if (!res.writableEnded) {
            res.send();
        }
    }

    /**
     * Stops the server gracefully:
     *
     * 1. Stops all background services.
     * 2. Stops accepting new connections and waits up to `shutdown:drain_timeout` milliseconds (default 10000) for
     * in-flight requests to finish, then closes the remaining keep-alive and WebSocket connections.
     * 3. Destroys the event listener manager, closing its redis subscription.
     * 4. Closes all database connections.
     *
     * The whole sequence is bounded by a 30 second watchdog.
     */
    public stop(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            // Watchdog: guards the whole shutdown sequence against hanging indefinitely (e.g. a database
            // connection that never closes). `unref()`'d so it can never by itself keep the process alive,
            // and always cleared below once the promise settles.
            const timer: NodeJS.Timeout = setTimeout(() => {
                reject("Failed to shut down server.");
            }, 30000);
            timer.unref?.();

            this.logger.info("Stopping background services...");
            await this.serviceManager?.stopAll();

            this.logger.info("Stopping server...");
            try {
                if (this.app?.isListening) {
                    if (typeof this.app.shutdown === "function") {
                        const drainTimeout: number = Number(
                            this.config?.get("shutdown:drain_timeout") ?? DEFAULT_DRAIN_TIMEOUT_MS,
                        );
                        this.logger.info("Waiting for in-flight requests to finish...");
                        await this.app.shutdown(
                            Number.isFinite(drainTimeout) ? drainTimeout : DEFAULT_DRAIN_TIMEOUT_MS,
                        );
                    } else {
                        this.app.close();
                    }
                }

                if (this.eventListenerManager) {
                    this.logger.info("Stopping event manager...");
                    // Through the object factory, so the destroyed instance is also dropped from it and a restart
                    // creates a new one instead of reusing this one's closed redis client.
                    await this.objectFactory.destroy(this.eventListenerManager);
                    this.eventListenerManager = undefined;
                }

                this.logger.info("Closing database connections...");
                await this.connectionManager?.disconnect();

                clearTimeout(timer);
                resolve();
            } catch (err) {
                clearTimeout(timer);
                reject(err);
            }
        });
    }

    /**
     * Restarts the HTTP listen server using the provided configuration and OpenAPI specification.
     */
    public async restart(): Promise<void> {
        await this.stop();
        return await this.start();
    }
}
