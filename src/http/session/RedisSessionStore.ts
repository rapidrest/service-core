///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { Redis } from "ioredis";
import type { SessionStore } from "./SessionStore.js";

const KEY_PREFIX = "session:";

/**
 * Redis-backed session store for multi-instance/production deployments, where an in-process
 * `MemorySessionStore` would not be shared across horizontally-scaled instances.
 */
export class RedisSessionStore implements SessionStore {
    private client: Redis;

    constructor(client: Redis) {
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

    public async save(sessionId: string, data: Record<string, any>, ttlSeconds: number): Promise<void> {
        await this.client.setex(KEY_PREFIX + sessionId, ttlSeconds, JSON.stringify(data));
    }

    public async destroy(sessionId: string): Promise<void> {
        await this.client.del(KEY_PREFIX + sessionId);
    }
}
