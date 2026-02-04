///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { ObjectFactory as CoreObjectFactory } from "@rapidrest/core";
import { ConnectionManager } from "./database/ConnectionManager.js";
import { DataSource } from "typeorm";
import * as Redis from "ioredis";

interface Entity {
    datastore?: any;
}

/**
 * The `ObjectFactory` is a manager for creating objects based on registered
 * class types. This allows for the tracking of multiple instances of objects
 * so that references can be referenced by unique name.
 *
 * @author Jean-Philippe Steinmetz
 */
export class ObjectFactory extends CoreObjectFactory {
    constructor(config?: any, logger?: any) {
        super(config, logger);
    }

    /**
     * Scans the given object for any properties with the @Inject decorator and assigns the correct values.
     * @param obj The object to initialize with injected defaults
     */
    public async initialize<T>(obj: any): Promise<T> {
        let proto = Object.getPrototypeOf(obj);
        while (proto) {
            // Search for each type of injectable property
            for (const member of Object.getOwnPropertyNames(proto)) {
                const connectionManager: ConnectionManager | undefined = this.getInstance(ConnectionManager);

                // Inject @Repository
                const injectRepo: any = Reflect.getMetadata("rrst:injectRepo", proto, member);
                if (injectRepo) {
                    // Look up the connection name from the model class
                    const datastore: string = (injectRepo as Entity).datastore;
                    if (datastore) {
                        const conn: DataSource | Redis.Redis | undefined =
                            connectionManager?.connections.get(datastore);
                        if (conn instanceof DataSource) {
                            obj[member] = conn.getRepository(injectRepo);
                        } else {
                            throw new Error("Unable to find database connection with name: " + datastore);
                        }
                    } else {
                        throw new Error(
                            "The model " + injectRepo.name + " must defined as an entity in datastore config."
                        );
                    }
                }

                // Inject @MongoRepository
                const injectMongoRepo: any = Reflect.getMetadata("rrst:injectMongoRepo", proto, member);
                if (injectMongoRepo) {
                    // Look up the connection name from the model class
                    const datastore: string = (injectMongoRepo as Entity).datastore;
                    if (datastore) {
                        const conn: DataSource | Redis.Redis | undefined =
                            connectionManager?.connections.get(datastore);
                        if (conn instanceof DataSource) {
                            obj[member] = conn.getMongoRepository(injectMongoRepo);
                        } else {
                            throw new Error("Unable to find database connection with name: " + datastore);
                        }
                    } else {
                        throw new Error(
                            "The model " + injectMongoRepo.name + " must defined as an entity in datastore config."
                        );
                    }
                }

                // Inject @RedisConnection
                const injectRedisConn: string = Reflect.getMetadata("rrst:injectRedisRepo", proto, member);
                if (injectRedisConn) {
                    const conn: any = connectionManager?.connections.get(injectRedisConn);
                    if (conn) {
                        // Always create a copy of the redis connection so that the user can subscribe/publish
                        // to redis pubsub channels without error. We must also check that it is possible to duplicate
                        // the connection.
                        obj[member] = conn.duplicate ? conn.duplicate() : conn;
                        // The `cache` datastore is a special case that we don't want to fail on if it's missing
                    } else if (injectRedisConn !== "cache") {
                        throw new Error("Unable to find database connection with name: " + injectRedisConn);
                    }
                }
            }

            proto = Object.getPrototypeOf(proto);
        }

        return super.initialize(obj);
    }
}
