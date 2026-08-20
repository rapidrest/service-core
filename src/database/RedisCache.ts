///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { RedisStore } from "@rapidrest/core";
import { Init } from "@rapidrest/core/dist/types/decorators/ObjectDecorators.js";
import type { RedisClientType } from "redis";
import { Redis } from "../decorators/DatabaseDecorators.js";
import { BaseEntity } from "typeorm";
import { SimpleEntity } from "../models/SimpleEntity.js";

/**
 * Implements a cache system for storing entities. Uses the `cache` Redis datastore (when configured) as the
 * backing database. Otherwise, provides an in-memory cache store for entities.
 *
 * @author Jean-Philippe Steinmetz
 */
export class RedisCache<T extends BaseEntity | SimpleEntity> extends RedisStore {
    // Inject the redis 'cache' connection
    @Redis("cache", false)
    protected redisClient?: RedisClientType;

    /** The entity type that is to be stored in this cache. */
    protected readonly type: any;

    constructor(type: any) {
        super(`cache.${type.name}.`);
        this.type = type;
    }

    @Init
    private init() {
        // Assign the injected redis client to the internal client RedisStore needs
        this.client = this.redisClient;

        // If the model class supports caching it will have a @Cache() decorator. We
        // extract that here to get the default TTL.
        this.defaultTTL = this.type.cacheTTL ?? this.defaultTTL;
    }

    public load(id: string, skipRedis?: boolean): Promise<T | undefined> {
        return super.load(id, skipRedis) as Promise<T | undefined>;
    }

    public loadMany(ids: string[]): Promise<(T | undefined)[]> {
        return super.loadMany(ids) as Promise<(T | undefined)[]>;
    }

    public loadSet(id: string): Promise<(T | undefined)[] | undefined> {
        return super.loadSet(id) as Promise<(T | undefined)[] | undefined>;
    }

    public save(id: string, data: T, ttl: number = this.defaultTTL, skipRedis: boolean = false): Promise<void> {
        return super.save(id, data, ttl, skipRedis);
    }

    public saveMany(ids: string[], data: T[], ttl?: number): Promise<void> {
        return super.saveMany(ids, data, ttl);
    }

    public saveSet(id: string, data: T[], idProp: string = "uid", ttl: number = this.defaultTTL): Promise<void> {
        return super.saveSet(id, data, idProp, ttl);
    }
}
