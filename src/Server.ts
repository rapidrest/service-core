///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import uWS from "uWebSockets.js";
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
import { HttpRouter } from "./http/Router.js";
import type { HttpRequest, HttpResponse, NextFunction } from "./http/types.js";

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
    /** The underlying HTTP router (uWS-backed) that provides HTTP processing services. */
    protected app!: HttpRouter;
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

    ///////////////////////////////////////////////////////////////////////////
    // METRICS VARIABLES
    ///////////////////////////////////////////////////////////////////////////
    protected metricRequestPath: prom.Counter<string> = new prom.Counter({
        name: "request_path",
        help: "A acount of the number of handled requests by the requested path.",
        labelNames: ["path"],
    });
    protected metricRequestStatus: prom.Counter<string> = new prom.Counter({
        name: "request_status",
        help: "A count of the resulting status code of handled requests by the requested method and path.",
        labelNames: ["method", "path", "statusCode"],
    });
    protected metricRequestTime: prom.Histogram<string> = new prom.Histogram({
        name: "request_time_milliseconds",
        help: "A histogram of the response time of handled requests by the requested method, path and code.",
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
    public getApplication(): HttpRouter {
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
                }

                // Register all found classes with the object factory
                for (const [name, clazz] of this.classLoader.getClasses().entries()) {
                    this.objectFactory.register(clazz, name);
                }

                // Load all models
                this.logger.info("Scanning for data models...");
                for (const [name, clazz] of this.classLoader.getClasses().entries()) {
                    const datastore: string | undefined = Reflect.getMetadata("rrst:datastore", clazz) || undefined;
                    if (datastore) {
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

                // Create the uWS app — SSLApp when ssl config is present, plain App otherwise
                const sslConfig: any = this.config.get("ssl");
                const uwsApp: uWS.TemplatedApp = sslConfig
                    ? uWS.SSLApp({
                          key_file_name: sslConfig.key,
                          cert_file_name: sslConfig.cert,
                          ca_file_name: sslConfig.ca,
                          passphrase: sslConfig.passphrase,
                      })
                    : uWS.App();

                this.app = new HttpRouter(uwsApp);

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
                        res.setHeader("access-control-allow-methods", "GET,HEAD,OPTIONS,PUT,POST,DELETE");
                        res.setHeader("access-control-allow-headers", corsAllowedHeaders);
                    }
                    if (req.method === "OPTIONS") {
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

                // Initialize the EventListenerManager
                const redis: any = this.connectionManager?.connections.get("events");
                if (redis) {
                    this.logger.info("Initializing event manager...");
                    this.eventListenerManager = await this.objectFactory.newInstance(EventListenerManager, {
                        name: "default",
                        args: [this.objectFactory, redis],
                    });
                    if (this.eventListenerManager) {
                        await this.eventListenerManager.init();
                        this.objectFactory.instances.forEach((obj: any) => {
                            this.eventListenerManager?.register(obj);
                        });
                        allRoutes.forEach((obj: any) => {
                            this.eventListenerManager?.register(obj);
                        });
                    }
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
                        }
                    }
                } catch (err) {
                    reject(err);
                    return;
                }

                // Error handling. NOTE: Must be defined last.
                // 4-param signature signals error handler to runChain
                this.app.use(((err: any, _req: HttpRequest, res: HttpResponse, next: NextFunction) => {
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
                            const errs: (Error | null)[] = err.errors;
                            if (err.stack && process.env.NODE_ENV !== "development") {
                                for (const err of errs) {
                                    if (err) {
                                        delete err.stack;
                                    }
                                }
                            }

                            if (!res.headersSent) {
                                res.status(err.status);
                            }

                            res.json(errs);
                        } else {
                            if (!(err instanceof ApiError)) {
                                const tmp: ApiError = new ApiError(
                                    ApiErrors.INTERNAL_ERROR,
                                    500,
                                    ApiErrorMessages.INTERNAL_ERROR,
                                );
                                tmp.stack = err.stack;
                                err = tmp;
                            }
                            // leverage NODE_ENV or another config?
                            if (err.stack && process.env.NODE_ENV !== "development") {
                                delete err.stack;
                            }
                            if (!res.headersSent) {
                                res.status(err.status);
                            }
                            const formattedError = {
                                ...err,
                                // https://stackoverflow.com/a/25245824
                                level: err.level ? err.level.replace(/\[.*?m/g, "") : undefined, // eslint-disable-line no-control-regex
                                message: err.message,
                            };
                            res.json(formattedError);
                        }

                        this.metricFailedRequests.inc(1);
                    }

                    return next();
                }) as any);

                this.app.use((req: HttpRequest, res: HttpResponse) => {
                    const start: number | undefined = (req as any)._metricsStart;
                    if (start !== undefined) {
                        this.metricRequestTime
                            .labels(req.method, req.path, String(res.statusCode))
                            .observe(Date.now() - start);
                    }
                    this.metricRequestPath.labels(req.path).inc();
                    this.metricRequestStatus.labels(req.method, req.path, String(res.statusCode)).inc();
                    this.metricTotalRequests.inc(1);
                    this.metricCompletedRequests.inc(1);
                    if (!res.writableEnded) {
                        res.send();
                    }
                });

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
     * Stops the HTTP listen server.
     */
    public stop(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            this.logger.info("Stopping background services...");
            await this.serviceManager?.stopAll();

            this.logger.info("Stopping server...");
            try {
                if (this.app?.isListening) {
                    this.app.close();
                }

                this.logger.info("Closing database connections...");
                await this.connectionManager?.disconnect();

                resolve();
            } catch (err) {
                reject(err);
            }

            setTimeout(() => {
                reject("Failed to shut down server.");
            }, 30000);
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
