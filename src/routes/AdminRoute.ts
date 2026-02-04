///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ApiError, JWTUser, ObjectDecorators, UserUtils } from "@rapidrest/core";
import { Redis, ScanStream } from "ioredis";
import Transport from "winston-transport";
import { Auth, ContentType, Get, Route, Socket, User, WebSocket } from "../decorators/RouteDecorators.js";
import { RedisConnection } from "../decorators/DatabaseDecorators.js";
import ws, { createWebSocketStream } from "ws";
import { Description, Returns, Summary } from "../decorators/DocDecorators.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
const { Config, Init, Logger } = ObjectDecorators;

/**
 * Implements a Winston transport that pipes incoming log messages to a configured redis pubsub channel.
 */
export class RedisTransport extends Transport {
    private channel: string;
    private redis: Redis;

    constructor(opts: any) {
        super(opts);
        this.channel = opts.channelName;
        this.redis = opts.redis;
    }

    public close(): void {
        this.redis.disconnect();
    }

    public log(info: any, next: Function): any {
        void this.redis.publish(this.channel, JSON.stringify(info));
        next();
    }
}

/**
 * The `AdminRoute` provides a default `/admin` endpoint that gives trusted users the following abilities:
 * 
 * * Clear cache via `GET /admin/clear-cache`
 * * Live tail the service logs via `GET /admin/logs`
 * * Retrieve service dependencies via `GET /admin/dependencies`
 * * Retrieve service release notes via `GET /admin/release-notes`
 * * Restart the service via `GET /admin/restart`
 *
 * @author Jean-Philippe Steinmetz
 */
@Summary("Admin routes supporting cache-clearing, restarting, logs and release notes")
@Route("/admin")
export class AdminRoute {
    /** A map of user uid's to active sockets. */
    private activeSockets: Map<string, any[]> = new Map();

    @RedisConnection("cache")
    protected cacheClient?: Redis;

    @Config("datastores:cache", null)
    private cacheConnConfig: any;

    @Logger
    private logger: any;

    @Config("datastores:logs", null)
    private logsConnConfig: any;

    private redisClient?: Redis;

    /** The underlying ReleaseNotes specification. */
    private releaseNotes: string;

    @Config("service_name")
    private serviceName?: string;

    @Config("trusted_roles")
    private trustedRoles: string[] = [];

    /**
     * Constructs a new `ReleaseNotesRoute` object with the specified defaults.
     *
     * @param releaseNotes The ReleaseNotes specification object to serve.
     */
    constructor(releaseNotes: string) {
        this.releaseNotes = releaseNotes;
    }

    @Init
    private async init(): Promise<void> {
        if (this.cacheConnConfig) {
            const adminChannel: string = this.serviceName || "service_admin";
            this.redisClient = new Redis(this.cacheConnConfig.url, this.cacheConnConfig.options);
            void this.redisClient.subscribe(adminChannel);
            this.redisClient.on("message", (channel: string, message: string) => {
                if (channel === adminChannel) {
                    if (message === "RESTART") {
                        this.logger.info("Received RESTART signal. Restarting service...");
                        process.kill(process.pid, "SIGINT");
                    }
                }
            });
        }

        if (this.logsConnConfig) {
            const channelName: string = this.serviceName + "-logs";
            this.logger.add(new RedisTransport({
                channelName,
                redis: new Redis(this.logsConnConfig.url, this.logsConnConfig.options)
            }));
        } else {
            this.logger.warn("Could not initialize `/admin/logs` route. The `logs` datastore is not not configured.");
        }
    }

    @Summary("{{serviceName}} flush second-level cache")
    @Description("Flushes the second-level cache so that subsequent requests will pull directly from the database.")
    @Auth(["jwt"])
    @Get("/clear-cache")
    @Returns([null])
    private async clearCache(@User user?: JWTUser): Promise<void> {
        if (!user || !UserUtils.hasRoles(user, this.trustedRoles)) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        if (this.cacheClient) {
            const task: Promise<void> = new Promise((resolve, reject) => {
                const stream: ScanStream | undefined = this.cacheClient?.scanStream({ match: "db.cache.*" });
                if (stream) {
                    let keys: string[] = [];
                    stream.on("data", (k: string[]) => {
                        keys = keys.concat(k);
                    });
                    stream.on("end", () => {
                        void this.cacheClient?.unlink(keys);
                    });
                }
            });
            await task;
        }
    }

    @Summary("{{serviceName}} websocket for NodeJS debug inspector")
    @Description("Establishes a connection to the remote NodeJS debug inspector.")
    @Auth(["jwt"])
    @WebSocket("/inspect")
    private async inspect(@Socket socket: ws, @User user: JWTUser): Promise<void> {
        if (!UserUtils.hasRoles(user, this.trustedRoles)) {
            socket.close(1002, ApiErrors.AUTH_PERMISSION_FAILURE);
            return;
        }

        // Create a websocket connection to the debug inspector and forward all traffic between the two
        const sDuplex = createWebSocketStream(socket);
        const iws: ws = new ws("ws://localhost:9229");
        const iDuplex = createWebSocketStream(iws);
        sDuplex.pipe(iDuplex);
        iDuplex.pipe(sDuplex);

        // Add the sockets to our tracked list
        const socks: any[] = this.activeSockets.get(user.uid) || [];
        socks.push(sDuplex);
        socks.push(iDuplex);
        this.activeSockets.set(user.uid, socks);

        socket.on("close", async (code: number, reason: string) => {
            iws.close();

            // Remove the sockets from our tracked list
            const socks: any[] = this.activeSockets.get(user.uid) || [];
            socks.splice(socks.indexOf(sDuplex));
            socks.splice(socks.indexOf(iDuplex));
            this.activeSockets.set(user.uid, socks);
        });
    }

    @Summary("{{serviceName}} websocket to view live logs")
    @Description("Establishes a connection to the live log socket.")
    @Auth(["jwt"])
    @WebSocket("/logs")
    private async logs(@Socket socket: ws, @User user: JWTUser): Promise<void> {
        if (!UserUtils.hasRoles(user, this.trustedRoles)) {
            socket.close(1002, ApiErrors.AUTH_PERMISSION_FAILURE);
            return;
        }
        if (!this.logsConnConfig) {
            this.logger.error("Failed to establish logs connection. `logs` connection config is not set.");
            socket.close(1002, ApiErrors.INTERNAL_ERROR);
            return;
        }
        if (!this.serviceName) {
            this.logger.error("Failed to establish logs connection. serviceName is not set.");
            socket.close(1002, ApiErrors.INTERNAL_ERROR);
            return;
        }

        // Create a new redis connection for this client
        const redis: Redis = new Redis(this.logsConnConfig.url, this.logsConnConfig.options);

        const channelName: string = this.serviceName + "-logs";
        try {
            await redis.subscribe(channelName);
            this.logger.info(`User ${user.uid} successfully subscribed to logging channel.`);
            redis.on("message", (channel: string, message: string) => {
                // Forward the message to the client
                socket.send(message, (err) => {
                    if (err) {
                        this.logger.error(`Failed to forward message to client ${user.uid}, channel=${channel}.`);
                        this.logger.debug(err);
                    }
                });
            });
            socket.send(JSON.stringify({ id: 0, type: "SUBSCRIBED", success: true, data: channelName }));

            socket.on("close", async (code: number, reason: string) => {
                // Unsubscribe from all redis pub/sub channels
                await redis.unsubscribe(channelName);
                // Disconnect the redis client
                redis.disconnect();

                // Remove the socket from our tracked list
                const socks: any[] = this.activeSockets.get(user.uid) || [];
                socks.splice(socks.indexOf(socket), 1);
                this.activeSockets.set(user.uid, socks);
            });

            // Add the socket to our tracked list
            const socks: any[] = this.activeSockets.get(user.uid) || [];
            socks.push(socket);
            this.activeSockets.set(user.uid, socks);
        } catch (err: any) {
            this.logger.error(`User ${user.uid} failed to subscribe to logging channel.`);
            this.logger.debug(err);
            socket.close();

            // Remove the socket from our tracked list
            const socks: any[] = this.activeSockets.get(user.uid) || [];
            socks.splice(socks.indexOf(socket), 1);
            this.activeSockets.set(user.uid, socks);
        }
    }

    @Summary("{{serviceName}} release notes")
    @Description("Returns the release notes file for the service.")
    @Auth(["jwt"])
    @Get("/release-notes")
    @ContentType("text/x-rst")
    @Returns([String])
    private get(@User user?: JWTUser): string {
        if (user && user.uid && UserUtils.hasRoles(user, this.trustedRoles)) {
            return this.releaseNotes;
        } else {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
    }

    @Summary("{{serviceName}} Restart")
    @Description("Immediately restarts the service.")
    @Auth(["jwt"])
    @Get("/restart")
    @Returns([null])
    private restart(@User user?: JWTUser): void {
        if (!user || !UserUtils.hasRoles(user, this.trustedRoles)) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        // Send the restart signal to all services.
        const channelName: string = this.serviceName || "service_admin";
        void this.redisClient?.publish(channelName, "RESTART");
    }
}
