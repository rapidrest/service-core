import { ApiError, ObjectDecorators } from "@rapidrest/core";
import { Auth, Param, Post, Socket, User, WebSocket } from "../decorators/RouteDecorators.js";
import { ACLUtils } from "../security/ACLUtils.js";
import ws from "ws";
import { Redis } from "ioredis";
import { Description, Summary } from "../decorators/DocDecorators.js";
import { ACLAction } from "../security/AccessControlList.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
const { Config, Init, Inject, Logger } = ObjectDecorators;

/**
 * The `BasePushRoute` class provides a base set of endpoints for implement client push notifications.
 *
 * Exposed endpoints:
 *
 * | Name | HTTP Method | What it does |
 * | --- | --- | --- |
 * | `connect` | `UPGRADE /<base_path>/connect` | Establishes a connection to the push notification system. |
 * | `send` | `POST /<base_path>/:id` | Sends a push notification message to the channel with the given id |
 *
 * !!Note!! that the `BasePushRoute` is not automatically registered with a server by default. You must create
 * your own class that extends `AdminRoute` and apply the desired base path with `@Route()`.
 *
 * @example
 * ```ts
 * import { BasePushRoute, RouteDecorators } from "@rapidrest/service-core";
 * const { Route } = RouteDecorators;
 *
 * @Route("/push")
 * export class PushRoute extends BasePushRoute {}
 * ```
 *
 * @author Jean-Philippe Steinmetz
 */
export class BasePushRoute {
    @Inject(ACLUtils)
    private aclUtils?: ACLUtils;

    /** A map of active socket connections to users.  */
    private activeSocks: Map<string, ws[]> = new Map();

    /** A map of active subscription uids to users. */
    private activeSubs: Map<string, string[]> = new Map();

    @Logger
    private logger: any;

    @Config("datastores:events")
    private redisConfig: any;

    /** The maximum number of concurrent sockets a single user may hold open at once. */
    @Config("push:max_sockets_per_user", 10)
    private maxSocketsPerUser: number = 10;

    /** The maximum number of channels a single user may be subscribed to at once. */
    @Config("push:max_subscriptions_per_user", 50)
    private maxSubscriptionsPerUser: number = 50;

    /** A persistent redis client used to publish outgoing push messages. */
    private redisPub?: Redis;

    @Init
    private init(): void {
        if (this.redisConfig) {
            this.redisPub = new Redis(this.redisConfig.url, this.redisConfig.options);
        } else {
            this.logger.warn("Could not initialize the push notification publisher. The `events` datastore is not configured.");
        }
    }

    @Summary("Push connect")
    @Description("Establishes a connection to the push notification system.")
    @Auth(["jwt"])
    @WebSocket()
    public async connect(@Socket sock: ws, @User user: any): Promise<void> {
        // Cap the number of concurrent connections a single user may hold, to prevent an authenticated user
        // from exhausting server resources by opening unbounded sockets.
        if ((this.activeSocks.get(user.uid)?.length ?? 0) >= this.maxSocketsPerUser) {
            this.logger.debug(`User ${user.uid} exceeded the maximum of ${this.maxSocketsPerUser} concurrent push connections.`);
            sock.close(1008, "Too many concurrent connections.");
            return;
        }

        // Establish a new redis pub/sub client for this connection
        const redis: Redis = new Redis(this.redisConfig.url, this.redisConfig.options);
        const subs: string[] = this.activeSubs.get(user.uid) ?? [user.uid];
        try {
            await redis.subscribe(...subs);
            this.logger.info(`User ${user.uid} successfully subscribed to push channels: ${subs}`);
            sock.send(JSON.stringify({ id: 0, type: "SUBSCRIBED", success: true, data: subs }));
            this.activeSubs.set(user.uid, subs);
        } catch (err) {
            this.logger.error(`Failed to subscribe to push channels: user: ${user.uid}, subs: ${subs}`);
            this.logger.debug(err);
        }

        // Track the socket so it doesn't get automatically cleaned up. Uses an atomic get-or-create so two
        // concurrent connect() calls for a brand-new uid can't clobber each other's tracked array.
        if (!this.activeSocks.has(user.uid)) {
            this.activeSocks.set(user.uid, []);
        }
        this.activeSocks.get(user.uid)!.push(sock);

        // Set up the outgoing message forwarding handler to the client
        redis.on("message", (channel: string, message: string) => {
            this.logger.debug(`Forwarding message to ${user.uid}`);
            sock.send(message, (err) => {
                if (err) {
                    this.logger.debug(`Failed to forward message to ${user.uid}`);
                }
            });
        });

        // Set up the incoming message handler from the client
        sock.on("message", async (data: any, isBinary: boolean) => {
            if (!isBinary) {
                try {
                    // Decode the incoming message
                    const message: any = JSON.parse(data);
                    const origSubs: string[] = this.activeSubs.get(user.uid) ?? [user.uid];

                    if (message.type === "SUBSCRIBE") {
                        const subs: string[] = Array.isArray(message.data) ? message.data : [message.data];
                        const subd: string[] = [];
                        // Check that the user has permission for each requested channel, up to the per-user
                        // subscription cap — once the budget is exhausted further requested channels are
                        // silently dropped from the approved set, same as a channel lacking ACL permission.
                        let remaining: number = this.maxSubscriptionsPerUser - origSubs.length;
                        for (const channel of subs) {
                            if (remaining <= 0) break;
                            if (await this.aclUtils?.hasPermission(user, channel, ACLAction.READ)) {
                                subd.push(channel);
                                remaining--;
                            }
                        }

                        // Subscribe to all approved channels
                        await redis.subscribe(...subd);
                        this.activeSubs.set(user.uid, origSubs.concat(subd));
                        sock.send(JSON.stringify({ id: message.id, type: "SUBSCRIBED", success: true, data: subd }));
                    }
                    if (message.type === "UNSUBSCRIBE") {
                        const subs: string[] = Array.isArray(message.data) ? message.data : [message.data];
                        await redis.unsubscribe(...subs);
                        for (const channel of subs) {
                            origSubs.splice(origSubs.indexOf(channel), 1);
                        }
                        this.activeSubs.set(user.uid, origSubs);
                        sock.send(JSON.stringify({ id: message.id, type: "UNSUBSCRIBED", success: true, data: subs }));
                    } else {
                        this.logger.debug(`Received invalid message from user ${user.uid}.`);
                    }
                } catch (err: any) {
                    this.logger.debug(`Received invalid message from user ${user.uid}.`);
                }
            }
        });

        // Set up the close connection handler
        sock.on("close", async (code: number, reason: string) => {
            // Unsubscribe from all redis pub/sub channels
            const subs: string[] | undefined = this.activeSubs.get(user.uid);
            if (subs) {
                await redis.unsubscribe(...subs);
            }

            // Disconnect the redis client
            redis.disconnect();

            // Remove the socket from our tracked list
            const socks: ws[] = this.activeSocks.get(user.uid) || [];
            socks.splice(socks.indexOf(sock), 1);
            this.activeSocks.set(user.uid, socks);
        });
    }

    @Summary("Send push")
    @Description("Sends a push notification message to the channel with the given id.")
    @Auth(["jwt"])
    @Post("/:id")
    public async send(@Param("id") id: string, msg: any, @User user: any): Promise<void> {
        if (!(await this.aclUtils?.hasPermission(user, id, ACLAction.CREATE))) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        if (!this.redisPub) {
            this.logger.error(`Failed to send push message to channel ${id}. The \`events\` datastore is not configured.`);
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        await this.redisPub.publish(id, JSON.stringify({ type: "MESSAGE", channel: id, data: msg }));
    }
}
