///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import * as crypto from "crypto";
import type { RedisClientType } from "redis";
import { MemoryStore, ObjectDecorators } from "@rapidrest/core";
import { DatabaseDecorators } from "../../decorators/index.js";
import { RedisSessionStore } from "./RedisSessionStore.js";
import type { SessionStore } from "./SessionStore.js";
import { ObjectFactory } from "../../ObjectFactory.js";
const { Config, Init, Logger } = ObjectDecorators;
const { Redis } = DatabaseDecorators;

/**
 * Owns session-ID generation/signing and store selection (in-memory by default, Redis-backed when
 * a `cache` datasource connection is available and `session.store` isn't forced to `"memory"`).
 * Registered by `Server.ts` only when a `session` config block is present.
 *
 * @author Jean-Philippe Steinmetz
 */
export class SessionManager {
    // Automatically injected by ObjectFactory on instantiation
    private _objectFactory?: ObjectFactory;

    @Config("session", {})
    private options: any;

    @Config("cookie_secret", null)
    private globalCookieSecret?: string;

    /** The redis client used as a session store when configured. Special-cased to not throw if absent. */
    @Redis("cache", false)
    private cacheClient?: RedisClientType;

    @Logger
    private logger?: any;

    private store!: SessionStore;
    private secret!: string;

    public cookieName!: string;
    public ttlSeconds!: number;
    public cookieSecure!: boolean;
    public cookieSameSite!: string;
    public cookiePath!: string;

    @Init
    private async init() {
        if (!this._objectFactory) {
            throw new Error("objectFactory is not set.");
        }

        this.secret = this.options.secret ?? this.globalCookieSecret;
        if (!this.secret) {
            throw new Error(
                "SessionManager requires `session.secret` (or `cookie_secret`) to be configured for signing session cookies.",
            );
        }

        this.cookieName = this.options.cookieName ?? "rrst.sid";
        this.ttlSeconds = this.options.ttl ?? 3600;
        this.cookieSecure = this.options.cookieSecure ?? false;
        this.cookieSameSite = this.options.cookieSameSite ?? "Lax";
        this.cookiePath = this.options.cookiePath ?? "/";

        if (this.options.store === "redis" && !this.cacheClient) {
            throw new Error("session.store is set to 'redis' but no `cache` datasource connection was found.");
        }

        if (this.cacheClient && this.options.store !== "memory") {
            this.store = await this._objectFactory.newInstance(RedisSessionStore, { args: [this.cacheClient] });
            this.logger?.info("Session support enabled (store: redis).");
        } else {
            this.store = await this._objectFactory.newInstance(MemoryStore);
            this.logger?.info("Session support enabled (store: memory).");
        }
    }

    /** Generates a new, cryptographically random session ID. */
    public generateId(): string {
        return crypto.randomBytes(24).toString("base64url");
    }

    /** Signs a session ID for safe storage in a cookie value. */
    public signId(id: string): string {
        const signature = crypto.createHmac("sha256", this.secret).update(id).digest("base64url");
        return `${id}.${signature}`;
    }

    /**
     * Verifies a signed session ID cookie value, returning the original session ID if the
     * signature is valid, or `undefined` if it's missing, malformed, or tampered with.
     */
    public verifyId(signed: string): string | undefined {
        const idx = signed.lastIndexOf(".");
        if (idx < 0) return undefined;
        const id = signed.slice(0, idx);
        const signature = signed.slice(idx + 1);
        const expected = crypto.createHmac("sha256", this.secret).update(id).digest("base64url");
        const expectedBuf = Buffer.from(expected);
        const actualBuf = Buffer.from(signature);
        if (expectedBuf.length !== actualBuf.length) return undefined;
        if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return undefined;
        return id;
    }

    public async load(sessionId: string): Promise<Record<string, any> | undefined> {
        return this.store.load(sessionId);
    }

    public async save(sessionId: string, data: Record<string, any>): Promise<void> {
        return this.store.save(sessionId, data, this.ttlSeconds);
    }

    public async delete(sessionId: string): Promise<void> {
        return this.store.delete(sessionId);
    }
}
