///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////

/**
 * A pluggable backing store for session data, keyed by session ID. Implementations must be safe
 * to call from concurrent requests.
 */
export interface SessionStore {
    /** Loads the session data for the given session ID, or `undefined` if none exists (or has expired). */
    load(sessionId: string): Promise<Record<string, any> | undefined>;
    /** Persists the given session data, resetting its expiration to `ttlSeconds` from now. */
    save(sessionId: string, data: Record<string, any>, ttlSeconds: number): Promise<void>;
    /** Removes the session data for the given session ID, if any. */
    destroy(sessionId: string): Promise<void>;
}
