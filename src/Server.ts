///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import cookieParser from "cookie-parser";
import expressResponseTime from "response-time";
import * as http from "http";
import passport from "passport";
import * as path from "path";
import * as prom from "prom-client";
import "reflect-metadata";
import express, { Application, Response, Request, NextFunction } from "express";
import { ConnectionManager } from "./database/ConnectionManager.js";
import cors, { CorsOptions } from "cors";
import { StatusRoute } from "./routes/StatusRoute.js";
import { JWTStrategy, JWTStrategyOptions } from "./passportjs/JWTStrategy.js";
import { ApiError, ClassLoader, Logger } from "@rapidrest/core";
import { OpenAPIRoute } from "./routes/OpenAPIRoute.js";
import { MetricsRoute } from "./routes/MetricsRoute.js";
import { ObjectFactory } from "./ObjectFactory.js";
import { BackgroundServiceManager } from "./BackgroundServiceManager.js";
import { RouteUtils } from "./express/RouteUtils.js";
import { WebSocketServer } from "ws";
import { addWebSocket } from "./express/WebSocket.js";
import session from "express-session";
import { BulkError } from "./BulkError.js";
import { BackgroundService } from "./BackgroundService.js";
import { AdminRoute } from "./routes/index.js";
import { OpenApiSpec } from "./OpenApiSpec.js";
import { ApiErrorMessages, ApiErrors } from "./ApiErrors.js";
import { ACLUtils } from "./security/ACLUtils.js";
import { NotificationUtils } from "./NotificationUtils.js";
import { DataSource } from "typeorm";
import { ACLRouteMongo } from "./security/ACLRouteMongo.js";
import { ACLRouteSQL } from "./security/ACLRouteSQL.js";
import { EventListenerManager } from "./EventListenerManager.js";
import { AccessControlListMongo } from "./security/AccessControlListMongo.js";
import { AccessControlListSQL } from "./security/AccessControlListSQL.js";
import { RedisStore } from "./express/RedisStore.js";

interface Entity {
    storeName?: any;
}

interface Model {
    modelClass?: any;
}

/**
 * Provides an HTTP server utilizing ExpressJS and PassportJS. The server automatically registers all routes, and
 * establishes database connections for all configured data stores. Additionally provides automatic authentication
 * handling using JSON Web Token (JWT) via PassportJS. When provided an OpenAPI specificatiion object the server will
 * also automatically serve this specification via the `GET /openapi.json` route.
 *
 * Routes are defined by creating any class definition using the various decorators found in `RouteDecorators` and
 * saving these files in the `routes` subfolder. Upon server start, the `routes` folder is scanned for any class
 * that has been decorated with `@Route` and is automatically loaded and registered with Express. Similarly, if the
 * class is decorated with the `@Model` decorator the resulting route object will have the associated data model
 * definition object injected into the constructor.
 *
 * By default all registered endpoints that do not explicit have an `@Auth` decorator have the `JWT` authentication
 * strategy applied. This allows users to be implicitly authenticated without requiring additional configuration.
 * Once authenticated, the provided `request` argument will have the `user` property available containing information
 * about the authenticated user. If the `user` property is `undefined` then no user has been authenticated or the
 * authentication attempt failed.
 *
 * The following is an example of a simple route class.
 *
 * ```javascript
 * import { DefaultBehaviors, RouteDecorators } from "@rapidrest/service_core";
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
 * import { DefaultBehaviors, ModelDecorators, ModelRoute, RouteDecorators } from "@rapidrest/service_core";
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
    /** The underlying ExpressJS application that provides HTTP processing services. */
    protected app: Application;
    /** The base file system path that will be searched for models and routes. */
    protected readonly basePath: string;
    /** The global object containing configuration information to use. */
    protected readonly config?: any;
    /** The manager for handling database connections. */
    protected connectionManager?: ConnectionManager;
    /** The manager for handling events. */
    protected eventListenerManager?: EventListenerManager;
    /** The logging utility to use when outputing to console/file. */
    protected readonly logger: any;
    /** The object factory to use when injecting dependencies. */
    protected readonly objectFactory: ObjectFactory;
    /** The port that the server is listening on. */
    public readonly port: number;
    protected routeUtils?: RouteUtils;
    /** The underlying HTTP server instance. */
    protected server?: http.Server;
    protected serviceManager?: BackgroundServiceManager;
    /** The underlying WebSocket server instance. */
    protected wss?: WebSocketServer;

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
     * Creates a new instance of Server with the specified defaults.
     *
     * @param {any} config The nconf-compatible configuration object to initialize the server with.
     * @param {string} basePath The base file system path that models and routes will be searched from.
     * @param {Logger} logger The logging utility to use for outputing to console/file.
     * @param objectFactory The object factory to use for automatic dependency injection (IOC).
     */
    constructor(config: any, basePath: string = ".", logger: any = Logger(), objectFactory?: ObjectFactory) {
        this.app = express();
        this.config = config;
        this.basePath = basePath;
        this.logger = logger;
        this.objectFactory = objectFactory ? objectFactory : new ObjectFactory(config, logger);
        this.port = config.get("port") ? config.get("port") : 3000;
    }

    /**
     * Returns the express app.
     */
    public getApplication(): Application {
        return this.app;
    }

    /**
     * Returns the http server.
     */
    public getServer(): http.Server | undefined {
        return this.server;
    }

    /**
     * Returns `true` if the server is running, otherwise `false`.
     */
    public isRunning(): boolean {
        return this.server ? this.server.listening : false;
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
                const classLoader: ClassLoader = new ClassLoader(
                    this.basePath,
                    true,
                    true,
                    this.config.get("class_loader:ignore"),
                );
                try {
                    await classLoader.load();
                } catch (e) {
                    reject(`[server-core|Server.ts]**ERR @ start, loading service classes: ${e}`);
                }

                // Register all found classes with the object factory
                for (const [name, clazz] of classLoader.getClasses().entries()) {
                    this.objectFactory.register(clazz, name);
                }

                // Load all models
                this.logger.info("Scanning for data models...");
                for (const [name, clazz] of classLoader.getClasses().entries()) {
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

                // Express configuration
                this.app = express();
                this.server = http.createServer(this.app);
                this.wss = new WebSocketServer({
                    server: this.server,
                });
                this.app = addWebSocket(this.app, this.wss);
                this.app.use(express.static(path.join(__dirname, "public")));
                this.app.use(
                    express.json({
                        verify: (req: any, res: any, buf: any) => {
                            req.rawBody = buf;
                        },
                    })
                );
                this.app.use(express.urlencoded({ extended: false, type: "application/x-www-form-urlencoded" }));
                this.app.use(cookieParser(this.config.get("cookie_secret")));
                this.app.use(passport.initialize());

                // cors
                const corsOptions: CorsOptions = {
                    origin: this.config.get("cors:origins"),
                    credentials: true,
                    methods: "GET,HEAD,OPTIONS,PUT,POST,DELETE",
                    allowedHeaders: [
                        "Accept",
                        "Authorization",
                        "Content-Type",
                        "Location",
                        "Origin",
                        "Set-Cookie",
                        "X-Requested-With",
                    ],
                    preflightContinue: false,
                    optionsSuccessStatus: 204,
                };
                this.app.use(cors(corsOptions));

                // Sessions
                const cacheClient: any = this.connectionManager.connections.get("cache");
                const sessionConfig: any = this.config.get("session");
                if (cacheClient && sessionConfig) {
                    this.app.use(
                        session({
                            cookie: {
                                sameSite: "none",
                                secure: true,
                            },
                            resave: false,
                            saveUninitialized: false,
                            secret: sessionConfig.secret,
                            store: cacheClient
                                ? new RedisStore(cacheClient)
                                : undefined,
                        })
                    );
                    this.app.use(passport.session());
                }

                // passport (authentication) setup
                passport.deserializeUser((profile: any, done: any) => {
                    done(null, profile);
                });
                passport.serializeUser((profile: any, done: any) => {
                    done(null, profile);
                });

                // Register the default auth strategy classes
                this.objectFactory.register(JWTStrategy, "passportjs.JWTStrategy");

                // Instantiate the desired auth strategy
                if (this.config.get("auth:strategy")) {
                    const jwtOptions: JWTStrategyOptions = new JWTStrategyOptions();
                    jwtOptions.config = this.config.get("auth");
                    passport.use(
                        "jwt",
                        await this.objectFactory.newInstance(this.config.get("auth:strategy"), {
                            name: "default",
                            initialize: true,
                            args: [jwtOptions],
                        })
                    );
                } else {
                    this.logger.warn("No JWT authentication strategy has been set.");
                }

                // Set all custom headers
                const headers: any = this.config.get("headers") || {
                    "x-powered-by": "RapidREST",
                };
                this.app.use((req: Request, res: Response, next: NextFunction) => {
                    for (const key in headers) {
                        res.setHeader(key, headers[key]);
                    }
                    return next();
                });

                // Track request response time
                this.app.use(
                    expressResponseTime((req: Request, res: Response, time) => {
                        this.metricRequestTime.labels(req.method, req.path, String(res.statusCode)).observe(time);
                    })
                );

                const allRoutes: Array<any> = [];

                this.routeUtils = await this.objectFactory.newInstance(RouteUtils, { name: "default" });
                if (!this.routeUtils) {
                    reject("Failed to instantiate RouteUtils.");
                    return;
                }

                // Register the index route
                const index: StatusRoute = await this.objectFactory.newInstance(StatusRoute, { name: "default" });
                allRoutes.push(index);
                await this.routeUtils.registerRoute(this.app, index);

                // Register the admin route
                const admin: AdminRoute = await this.objectFactory.newInstance(AdminRoute, { name: "default" });
                allRoutes.push(admin);
                await this.routeUtils.registerRoute(this.app, admin);

                // Register the ACLs route if configured
                const aclConn: any = this.connectionManager?.connections.get("acl");
                if (aclConn instanceof DataSource) {
                    if (aclConn.driver.constructor.name === "MongoDriver") {
                        const aclRoute: ACLRouteMongo = await this.objectFactory.newInstance(ACLRouteMongo, {
                            name: "default",
                        });
                        await this.routeUtils.registerRoute(this.app, aclRoute);
                        allRoutes.push(aclRoute);
                    } else {
                        const aclRoute: ACLRouteSQL = await this.objectFactory.newInstance(ACLRouteSQL, {
                            name: "default",
                        });
                        await this.routeUtils.registerRoute(this.app, aclRoute);
                        allRoutes.push(aclRoute);
                    }
                }

                // Register the OpenAPI route if a spec has been provided
                if (this.apiSpec) {
                    const oasRoute: OpenAPIRoute = await this.objectFactory.newInstance(OpenAPIRoute, {
                        name: "default",
                        initialize: true,
                        args: [this.apiSpec],
                    });
                    await this.routeUtils.registerRoute(this.app, oasRoute);
                    allRoutes.push(oasRoute);
                }

                // Register the metrics route
                const metricsRoute: MetricsRoute = await this.objectFactory.newInstance(MetricsRoute, {
                    name: "default",
                });
                await this.routeUtils.registerRoute(this.app, metricsRoute);

                // Initialize the background service manager
                this.logger.info("Starting background services...");
                const serviceClasses: any = {};
                for (const [name, clazz] of classLoader.getClasses().entries()) {
                    if (clazz.prototype instanceof BackgroundService) {
                        serviceClasses[name] = clazz;
                    }
                }
                this.serviceManager = await this.objectFactory.newInstance(BackgroundServiceManager, {
                    name: "default",
                    initialize: true,
                    args: [this.objectFactory, serviceClasses, this.config, this.logger],
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
                        args: [this.config, this.logger, this.objectFactory, redis],
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
                    for (const [fqn, clazz] of classLoader.getClasses().entries()) {
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
                this.app.use((err: any, req: Request, res: Response, next: NextFunction) => {
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
                            res.json(err);
                        } else if (err instanceof BulkError) {
                            const errs: (Error | null)[] = err.errors;
                            if (err.stack && process.env.NODE_ENV === "production") {
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
                                    ApiErrorMessages.INTERNAL_ERROR
                                );
                                tmp.stack = err.stack;
                                err = tmp;
                            }
                            // leverage NODE_ENV or another config?
                            if (err.stack && process.env.NODE_ENV === "production") {
                                delete err.stack;
                            }
                            if (!res.headersSent) {
                                res.status(err.status);
                            }
                            const formattedError = {
                                ...err,
                                // https://stackoverflow.com/a/25245824
                                level: err.level ? err.level.replace(/\u001b\[.*?m/g, "") : undefined, // eslint-disable-line no-control-regex
                                message: err.message
                            };
                            res.json(formattedError);
                        }

                        this.metricFailedRequests.inc(1);
                    }

                    return next();
                });

                this.app.use((req: Request, res: Response) => {
                    this.metricRequestPath.labels(req.path).inc();
                    this.metricRequestStatus.labels(req.method, req.path, String(res.statusCode)).inc();
                    this.metricTotalRequests.inc(1);
                    this.metricCompletedRequests.inc(1);
                    return !res.writableEnded ? res.send() : res;
                });

                await this.postStart();

                // Initialize the HTTP listen server
                this.server.listen(this.port, "0.0.0.0", () => {
                    this.logger.info("Listening on port " + this.port + "...");
                    resolve();
                });
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

            if (this.wss) {
                this.logger.info("Stopping server...");
                this.wss.close(async (err: any) => {
                    if (err) {
                        reject(err);
                    } else if (this.server) {
                        this.wss = undefined;

                        this.server.close(async (err: any) => {
                            this.logger.info("Closing database connections...");
                            await this.connectionManager?.disconnect();

                            if (err) {
                                reject(err);
                            } else {
                                this.server = undefined;
                                resolve();
                            }
                        });
                    }
                });

                setTimeout(() => {
                    reject("Failed to shut down server.");
                }, 30000);
            } else {
                resolve();
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
