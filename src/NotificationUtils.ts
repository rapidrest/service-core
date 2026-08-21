///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import type { RedisClientType } from "redis";

const { Logger } = ObjectDecorators;

/**
 * Utility functions for sending push notifications to registered clients.
 *
 * @author Jean-Philippe Steinmetz
 */
export class NotificationUtils {
    /** The redis client to use for broadcasting messages. */
    private redis: RedisClientType;

    @Logger
    private logger?: any;

    /**
     * Initializes the utility using the given redis connection.
     *
     * @param {any} redis The redis connection to publish to.
     */
    constructor(redis: RedisClientType) {
        this.redis = redis;
    }

    /**
     * Sends a given message to the room or user with the specified uid(s). Publishing is fire-and-forget: a
     * broadcast failure will never propagate back into whatever write triggered the notification.
     *
     * @param {string} uids The universally unique identifier of the room or user to send the message to.
     * @param {string} type The type of message being sent.
     * @param {string} action The action performed on the data (if applicable).
     * @param {string} data The contents of the message to send to the room or user.
     */
    public sendMessage(uids: string | string[], type: string, action: string, data: any): void {
        const targets: string[] = Array.isArray(uids) ? uids : [uids];
        for (const uid of targets) {
            this.redis?.publish(uid, JSON.stringify({ type, action, data }))?.catch((err) => {
                this.logger?.warn(`NotificationUtils: Failed to publish message to ${uid}.`);
                this.logger?.debug(err);
            });
        }
    }
}
