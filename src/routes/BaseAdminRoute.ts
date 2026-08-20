///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ApiError, ObjectDecorators, UserUtils, type JWTUser } from "@rapidrest/core";
import type { RedisClientType } from "redis";
import { importRedis } from "../database/ConnectionKinds.js";
import Transport from "winston-transport";
import {
    Auth,
    ContentType,
    Get,
    RequiresElevation,
    RequiresTrustedRole,
    Socket,
    User,
    WebSocket,
} from "../decorators/RouteDecorators.js";
import { Redis } from "../decorators/DatabaseDecorators.js";
import { type IWebSocketShim } from "../http/IWebSocketShim.js";
import { Description, Returns, Summary } from "../decorators/DocDecorators.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
const { Config, Init, Logger } = ObjectDecorators;

/**
 * Implements a Winston transport that pipes incoming log messages to a configured redis pubsub channel.
 */
export class RedisTransport extends Transport {
    private channel: string;
    private redis: RedisClientType;

    constructor(opts: any) {
        super(opts);
        this.channel = opts.channelName;
        this.redis = opts.redis;
    }

    public close(): void {
        void this.redis.disconnect();
    }

    public log(info: any, next: Function): any {
        void this.redis.publish(this.channel, JSON.stringify(info));
        next();
    }
}

/**
 * The `BaseAdminRoute` class provides a base set of endpoints that gives trusted users the ability to perform common adminstrative actions
 * with the server. Note that this route class requires elevated user privileges to perform any action.
 *
 * Exposed endpoints:
 *
 * | Name | HTTP Method | What it does |
 * | --- | --- | --- |
 * | `clearCache` | `GET /<base_path>/clear-cache` | Clears the Redis-based cache system. |
 * | `logs` | `UPGRADE /<base_path>/logs` | Live tail the service logs |
 * | `getReleaseNotes` | `GET /<base_path>/release-notes` | Retrieve the server release notes. |
 * | `restart` | `GET /<base_path>/restart` | ` Restart the server |
 *
 * !!Note!! that the `BaseAdminRoute` is not automatically registered with a server by default. You must create
 * your own class that extends `AdminRoute` and apply the desired base path with `@Route()`.
 *
 * @example
 * ```ts
 * import { BaseAdminRoute, RouteDecorators } from "@rapidrest/service-core";
 * const { Route } = RouteDecorators;
 *
 * @Route("/admin")
 * export class AdminRoute extends BaseAdminRoute {}
 * ```
 *
 * @author Jean-Philippe Steinmetz
 */
@Summary("Admin routes supporting cache-clearing, restarting, logs and release notes")
@RequiresElevation()
export class BaseAdminRoute {
    /** A map of user uid's to active sockets. */
    protected activeSockets: Map<string, any[]> = new Map();

    @Redis("cache", false)
    protected cacheClient?: RedisClientType;

    @Config("datastores:cache", null)
    protected cacheConnConfig: any;

    @Logger
    protected logger: any;

    @Config("datastores:logs", null)
    protected logsConnConfig: any;

    protected redisClient?: RedisClientType;

    /**
     * A dedicated connection for publishing admin channel messages (e.g. the `RESTART` signal).
     * `redisClient` issues `SUBSCRIBE` in `init()`, which puts it into subscriber-only mode — Redis
     * connections in that state can't also run `PUBLISH`, so a separate connection is required.
     */
    protected redisPublisher?: RedisClientType;

    /** The underlying ReleaseNotes specification. */
    protected releaseNotes?: string;

    @Config("service_name")
    protected serviceName?: string;

    @Config("trusted_roles")
    protected trustedRoles: string[] = [];

    @Init
    protected async init(): Promise<void> {
        if (this.cacheClient) {
            this.logger.info("Cache is enabled and ready.");
        } else {
            this.logger.warn("Cache is disabled.");
        }

        if (this.cacheConnConfig) {
            const adminChannel: string = this.serviceName || "service_admin";
            const { createClient } = await importRedis();
            this.redisClient = createClient({ url: this.cacheConnConfig.url });
            await this.redisClient.connect();
            this.redisPublisher = this.redisClient.duplicate();
            await this.redisPublisher.connect();
            await this.redisClient.subscribe(adminChannel, (message: string) => {
                if (message === "RESTART") {
                    this.logger.info("Received RESTART signal. Restarting service...");
                    process.kill(process.pid, "SIGINT");
                }
            });
        }

        if (this.logsConnConfig) {
            const channelName: string = this.serviceName + "-logs";
            const { createClient } = await importRedis();
            const logsRedis: RedisClientType = createClient({ url: this.logsConnConfig.url });
            await logsRedis.connect();
            this.logger.add(
                new RedisTransport({
                    channelName,
                    redis: logsRedis,
                }),
            );
        } else {
            this.logger.warn("Could not initialize `/admin/logs` route. The `logs` datasource is not not configured.");
        }

        // Discover the release notes file and load it (if available)
    }

    @Summary("{{serviceName}} flush second-level cache")
    @Description("Flushes the second-level cache so that subsequent requests will pull directly from the database.")
    @Auth(["jwt"])
    @Get("/clear-cache")
    @Returns([null])
    @RequiresTrustedRole()
    public async clearCache(@User user?: JWTUser): Promise<void> {
        if (!user || !UserUtils.hasRoles(user, this.trustedRoles)) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        if (this.cacheClient) {
            const keys: string[] = [];
            for await (const found of this.cacheClient.scanIterator({ MATCH: "cache.*" })) {
                keys.push(...found);
            }
            if (keys.length > 0) {
                await this.cacheClient.unlink(keys);
            }
        }
    }

    @Summary("{{serviceName}} websocket to view live logs")
    @Description("Establishes a connection to the live log socket.")
    @Auth(["jwt"])
    @WebSocket("/logs")
    @RequiresTrustedRole()
    public async logs(@Socket socket: IWebSocketShim, @User user: JWTUser): Promise<void> {
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
        const { createClient } = await importRedis();
        const redis: RedisClientType = createClient({ url: this.logsConnConfig.url });
        await redis.connect();

        const channelName: string = this.serviceName + "-logs";
        try {
            await redis.subscribe(channelName, (message: string, channel: string) => {
                // Forward the message to the client
                socket.send(message, (err) => {
                    if (err) {
                        this.logger.error(`Failed to forward message to client ${user.uid}, channel=${channel}.`);
                        this.logger.debug(err);
                    }
                });
            });
            this.logger.info(`User ${user.uid} successfully subscribed to logging channel.`);
            socket.send(JSON.stringify({ id: 0, type: "SUBSCRIBED", success: true, data: channelName }));

            socket.on("close", async (code: number, reason: string) => {
                // Unsubscribe from all redis pub/sub channels
                await redis.unsubscribe(channelName);
                // Disconnect the redis client
                await redis.disconnect();

                // Remove the socket from our tracked list
                const socks: any[] = this.activeSockets.get(user.uid) || [];
                const idx: number = socks.indexOf(socket);
                if (idx !== -1) {
                    socks.splice(idx, 1);
                }
                this.activeSockets.set(user.uid, socks);
            });

            // Add the socket to our tracked list. Uses an atomic get-or-create so two concurrent connections
            // for a brand-new uid can't clobber each other's tracked array.
            if (!this.activeSockets.has(user.uid)) {
                this.activeSockets.set(user.uid, []);
            }
            this.activeSockets.get(user.uid)!.push(socket);
        } catch (err: any) {
            this.logger.error(`User ${user.uid} failed to subscribe to logging channel.`);
            this.logger.debug(err);
            void redis.disconnect();
            socket.close();

            // Remove the socket from our tracked list
            const socks: any[] = this.activeSockets.get(user.uid) || [];
            const idx: number = socks.indexOf(socket);
            if (idx !== -1) {
                socks.splice(idx, 1);
            }
            this.activeSockets.set(user.uid, socks);
        }
    }

    @Summary("{{serviceName}} release notes")
    @Description("Returns the release notes file for the service.")
    @Auth(["jwt"])
    @Get("/release-notes")
    @ContentType("text/x-rst")
    @Returns([String])
    @RequiresTrustedRole()
    public getReleaseNotes(@User user?: JWTUser): string | undefined {
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
    @RequiresTrustedRole()
    public restart(@User user?: JWTUser): void {
        if (!user || !UserUtils.hasRoles(user, this.trustedRoles)) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        // Send the restart signal to all services.
        const channelName: string = this.serviceName || "service_admin";
        void this.redisPublisher?.publish(channelName, "RESTART");
    }
}
