import { ObjectDecorators } from "@rapidrest/core";
import { Auth, Param, Post, Socket, User, WebSocket } from "../decorators/RouteDecorators.js";
import { ACLUtils } from "../security/ACLUtils.js";
import ws from "ws";
import { Redis } from "ioredis";
import { Description, Summary } from "../decorators/DocDecorators.js";
import { ACLAction } from "../security/AccessControlList.js";
const { Config, Inject, Logger } = ObjectDecorators;

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

    @Summary("Push connect")
    @Description("Establishes a connection to the push notification system.")
    @Auth(["jwt"])
    @WebSocket()
    public async connect(@Socket sock: ws, @User user: any): Promise<void> {
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

        // Track the socket so it doesn't get automatically cleaned up
        const socks: ws[] = this.activeSocks.get(user.uid) || [];
        socks.push(sock);
        this.activeSocks.set(user.uid, socks);

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
                        // Check that the user has permission for each requested channel
                        for (const channel of subs) {
                            if (await this.aclUtils?.hasPermission(user, channel, ACLAction.READ)) {
                                subd.push(channel);
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
    public async send(@Param("id") id: string, msg: any, @User user: any) {
        throw new Error("Unimplemented");
    }
}
