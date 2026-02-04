///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Redis } from "ioredis";

/**
 * Utility functions for sending push notifications to registered clients.
 *
 * @author Jean-Philippe Steinmetz
 */
export class NotificationUtils {
    /** The redis client to use for broadcasting messages. */
    private redis: Redis;

    /**
     * Initializes the utility using the given redis connection.
     *
     * @param {any} redis The redis connection to publish to.
     */
    constructor(redis: Redis) {
        this.redis = redis;
    }

    /**
     * Sends a given message to the room or user with the specified uid(s).
     *
     * @param {string} uids The universally unique identifier of the room or user to send the message to.
     * @param {string} type The type of message being sent.
     * @param {string} action The action performed on the data (if applicable).
     * @param {string} data The contents of the message to send to the room or user.
     */
    public sendMessage(uids: string | string[], type: string, action: string, data: any): void {
        if (Array.isArray(uids)) {
            for (const uid of uids) {
                void this.redis?.publish(uid, JSON.stringify({ type, action, data }));
            }
        } else {
            void this.redis?.publish(uids, JSON.stringify({ type, action, data }));
        }
    }
}
