///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { SessionStore } from "./SessionStore.js";

interface Entry {
    data: Record<string, any>;
    expiresAt: number;
}

/** How often the sweep interval reclaims expired, never-reloaded sessions. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * Default in-process session store. Suitable for single-instance deployments; sessions do not
 * survive a process restart and are not shared across horizontally-scaled instances — use
 * `RedisSessionStore` for those cases.
 */
export class MemorySessionStore implements SessionStore {
    private entries: Map<string, Entry> = new Map();
    private sweepTimer: ReturnType<typeof setInterval>;

    constructor() {
        this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
        this.sweepTimer.unref?.();
    }

    public async load(sessionId: string): Promise<Record<string, any> | undefined> {
        const entry = this.entries.get(sessionId);
        if (!entry) return undefined;
        if (entry.expiresAt <= Date.now()) {
            this.entries.delete(sessionId);
            return undefined;
        }
        return entry.data;
    }

    public async save(sessionId: string, data: Record<string, any>, ttlSeconds: number): Promise<void> {
        this.entries.set(sessionId, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
    }

    public async destroy(sessionId: string): Promise<void> {
        this.entries.delete(sessionId);
    }

    private sweep(): void {
        const now = Date.now();
        for (const [sessionId, entry] of this.entries.entries()) {
            if (entry.expiresAt <= now) this.entries.delete(sessionId);
        }
    }

    /** Stops the background sweep timer. Call when the owning `SessionManager` is destroyed. */
    public dispose(): void {
        clearInterval(this.sweepTimer);
    }
}
