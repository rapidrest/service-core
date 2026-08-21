import { ApiError, ObjectDecorators } from "@rapidrest/core";
import { Auth, Param, Post, Socket, User, WebSocket } from "../decorators/RouteDecorators.js";
import { ACLUtils } from "../security/ACLUtils.js";
import ws from "ws";
import type { RedisClientType } from "redis";
import { importRedis } from "../database/ConnectionKinds.js";
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

    /** Per-user in-process locks (see `runExclusive`) guarding read-modify-write access to `activeSubs`. */
    private subLocks: Map<string, Promise<void>> = new Map();

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
    private redisPub?: RedisClientType;

    @Init
    private async init(): Promise<void> {
        if (this.redisConfig) {
            const { createClient } = await importRedis();
            this.redisPub = createClient({ url: this.redisConfig.url });
            await this.redisPub.connect();
        } else {
            this.logger.warn(
                "Could not initialize the push notification publisher. The `events` datasource is not configured.",
            );
        }
    }

    /**
     * Runs `fn` exclusively with respect to any other call currently queued under the same `key` on this
     * instance — a call only starts once every call queued ahead of it under that key has fully settled. Used
     * to serialize SUBSCRIBE/UNSUBSCRIBE handling per user so two messages arriving close together (on the same
     * or different concurrent sockets for that user) can't both read the same stale `activeSubs` snapshot and
     * clobber (or exceed the cap on) each other's committed subscription list.
     */
    private async runExclusive<R>(key: string, fn: () => Promise<R>): Promise<R> {
        const previous: Promise<void> = this.subLocks.get(key) ?? Promise.resolve();
        const run: Promise<R> = previous.then(fn);
        const guard: Promise<void> = run.then(
            () => undefined,
            () => undefined,
        );
        this.subLocks.set(key, guard);
        void guard.finally(() => {
            if (this.subLocks.get(key) === guard) {
                this.subLocks.delete(key);
            }
        });
        return run;
    }

    @Summary("Push connect")
    @Description("Establishes a connection to the push notification system.")
    @Auth(["jwt"])
    @WebSocket()
    public async connect(@Socket sock: ws, @User user: any): Promise<void> {
        const onMessage = (message: string, channel: string) => {
            this.logger.debug(`Forwarding message to ${user.uid}`);
            sock.send(message, (err) => {
                if (err) {
                    this.logger.debug(`Failed to forward message to ${user.uid}`);
                }
            });
        };

        // The socket cap check, the subscribe, and the activeSocks/activeSubs bookkeeping below must all happen
        // atomically with respect to any other concurrent connect()/SUBSCRIBE/UNSUBSCRIBE for this same user
        // (e.g. a burst of connections opened milliseconds apart), or two calls could both read the same
        // pre-commit state: bypassing the per-user socket cap, or clobbering each other's committed
        // subscription list the same way the message handlers below already guard against via `runExclusive`.
        const redis: RedisClientType | undefined = await this.runExclusive(user.uid, async () => {
            // Cap the number of concurrent connections a single user may hold, to prevent an authenticated user
            // from exhausting server resources by opening unbounded sockets.
            if ((this.activeSocks.get(user.uid)?.length ?? 0) >= this.maxSocketsPerUser) {
                this.logger.debug(
                    `User ${user.uid} exceeded the maximum of ${this.maxSocketsPerUser} concurrent push connections.`,
                );
                return undefined;
            }

            // Establish a new redis pub/sub client for this connection
            const { createClient } = await importRedis();
            const conn: RedisClientType = createClient({ url: this.redisConfig.url });
            await conn.connect();

            // On a first-ever connection there's nothing stored yet, so just the user's own identity channel
            // (always implicitly permitted, same as the SUBSCRIBE message handler below never ACL-checks it).
            // On a *re*connection, activeSubs may hold channels approved during a previous session — permission
            // can have been revoked since then, so every channel other than the identity one is re-checked here
            // rather than trusted as still-valid.
            const storedSubs: string[] = this.activeSubs.get(user.uid) ?? [user.uid];
            const subs: string[] = [];
            for (const channel of storedSubs) {
                if (channel === user.uid || (await this.aclUtils?.hasPermission(user, channel, ACLAction.READ))) {
                    subs.push(channel);
                }
            }
            try {
                await conn.subscribe(subs, onMessage);
                this.logger.info(`User ${user.uid} successfully subscribed to push channels: ${subs}`);
                sock.send(JSON.stringify({ id: 0, type: "SUBSCRIBED", success: true, data: subs }));
                this.activeSubs.set(user.uid, subs);
            } catch (err) {
                this.logger.error(`Failed to subscribe to push channels: user: ${user.uid}, subs: ${subs}`);
                this.logger.debug(err);
            }

            // Track the socket so it doesn't get automatically cleaned up.
            if (!this.activeSocks.has(user.uid)) {
                this.activeSocks.set(user.uid, []);
            }
            this.activeSocks.get(user.uid)!.push(sock);

            return conn;
        });

        if (!redis) {
            sock.close(1008, "Too many concurrent connections.");
            return;
        }

        // Set up the incoming message handler from the client
        sock.on("message", async (data: any, isBinary: boolean) => {
            if (!isBinary) {
                try {
                    // Decode the incoming message
                    const message: any = JSON.parse(data);

                    if (message.type === "SUBSCRIBE") {
                        // Serialized per user: reading `activeSubs` and later committing the updated list must
                        // be atomic with respect to any other concurrent SUBSCRIBE/UNSUBSCRIBE for this same
                        // user (e.g. from a second open socket), or two messages could both compute their
                        // approved/remaining-budget delta off the same stale snapshot and the second commit
                        // would silently clobber the first's.
                        await this.runExclusive(user.uid, async () => {
                            const origSubs: string[] = this.activeSubs.get(user.uid) ?? [user.uid];
                            const requested: string[] = Array.isArray(message.data) ? message.data : [message.data];
                            // Bound the number of channels actually *checked* to the caller's remaining
                            // subscription budget, not just the number of successful grants — otherwise a client
                            // naming far more channels than it could ever be granted (each denial doesn't consume
                            // budget) forces one sequential ACL lookup (a cache-miss-prone Redis/DB round trip)
                            // per attacker-controlled entry, with no upper bound on how many it sends in one frame.
                            const remaining: number = Math.max(0, this.maxSubscriptionsPerUser - origSubs.length);
                            const subs: string[] = requested.slice(0, remaining);
                            const subd: string[] = [];
                            for (const channel of subs) {
                                if (await this.aclUtils?.hasPermission(user, channel, ACLAction.READ)) {
                                    subd.push(channel);
                                }
                            }

                            // Subscribe to all approved channels
                            if (subd.length > 0) {
                                await redis.subscribe(subd, onMessage);
                            }
                            this.activeSubs.set(user.uid, origSubs.concat(subd));
                            sock.send(
                                JSON.stringify({ id: message.id, type: "SUBSCRIBED", success: true, data: subd }),
                            );
                        });
                    } else if (message.type === "UNSUBSCRIBE") {
                        await this.runExclusive(user.uid, async () => {
                            const origSubs: string[] = this.activeSubs.get(user.uid) ?? [user.uid];
                            const subs: string[] = Array.isArray(message.data) ? message.data : [message.data];
                            // An empty channel list means "unsubscribe from everything" per the Redis protocol,
                            // which is not what an empty UNSUBSCRIBE request from the client should do.
                            if (subs.length > 0) {
                                await redis.unsubscribe(subs);
                            }
                            for (const channel of subs) {
                                const idx: number = origSubs.indexOf(channel);
                                if (idx !== -1) {
                                    origSubs.splice(idx, 1);
                                }
                            }
                            this.activeSubs.set(user.uid, origSubs);
                            sock.send(
                                JSON.stringify({ id: message.id, type: "UNSUBSCRIBED", success: true, data: subs }),
                            );
                        });
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
            // Serialized per user, same as SUBSCRIBE/UNSUBSCRIBE above: a close racing a concurrent
            // connect()/SUBSCRIBE for the same user (a second open socket) must not interleave its
            // read-modify-write of activeSocks/activeSubs with theirs, or one of the two updates is lost.
            await this.runExclusive(user.uid, async () => {
                // Unsubscribe from all redis pub/sub channels
                const subs: string[] | undefined = this.activeSubs.get(user.uid);
                if (subs && subs.length > 0) {
                    await redis.unsubscribe(subs);
                }

                // Disconnect the redis client
                await redis.disconnect();

                // Remove the socket from our tracked list
                const socks: ws[] = this.activeSocks.get(user.uid) || [];
                const idx: number = socks.indexOf(sock);
                if (idx !== -1) {
                    socks.splice(idx, 1);
                }

                // Once the user has no other open connections, drop their tracked state entirely rather than
                // leaving a stale (activeSocks) or permanently-growing (activeSubs) entry behind — otherwise
                // every distinct uid that ever connects, even once, leaks a map entry for the life of the process.
                if (socks.length === 0) {
                    this.activeSocks.delete(user.uid);
                    this.activeSubs.delete(user.uid);
                } else {
                    this.activeSocks.set(user.uid, socks);
                }
            });
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
            this.logger.error(
                `Failed to send push message to channel ${id}. The \`events\` datasource is not configured.`,
            );
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        await this.redisPub.publish(id, JSON.stringify({ type: "MESSAGE", channel: id, data: msg }));
    }
}
