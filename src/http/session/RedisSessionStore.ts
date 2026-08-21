///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { RedisClientType } from "redis";
import type { SessionStore } from "./SessionStore.js";

const KEY_PREFIX = "session:";

/**
 * Redis-backed session store for multi-instance/production deployments, where an in-process
 * `MemorySessionStore` would not be shared across horizontally-scaled instances.
 */
export class RedisSessionStore implements SessionStore {
    private client: RedisClientType;

    /** The default record TTL (in seconds). */
    public defaultTTL: number = 60;

    constructor(client: RedisClientType) {
        this.client = client;
    }

    public async load(sessionId: string): Promise<Record<string, any> | undefined> {
        const raw = await this.client.get(KEY_PREFIX + sessionId);
        if (!raw) return undefined;
        try {
            return JSON.parse(raw);
        } catch {
            return undefined;
        }
    }

    public async save(
        sessionId: string,
        data: Record<string, any>,
        ttlSeconds: number = this.defaultTTL,
    ): Promise<void> {
        await this.client.setEx(KEY_PREFIX + sessionId, ttlSeconds, JSON.stringify(data));
    }

    public async delete(sessionId: string): Promise<void> {
        await this.client.del(KEY_PREFIX + sessionId);
    }
}
