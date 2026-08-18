///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { ObjectFactory as CoreObjectFactory } from "@rapidrest/core";
import { ConnectionManager } from "./database/ConnectionManager.js";
import { isSqlDataSource } from "./database/ConnectionKinds.js";
import { MongoConnection } from "./database/MongoConnection.js";

interface Entity {
    datasource?: any;
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

                // Inject @DataSource
                const injectDataSource: any = Reflect.getMetadata("rrst:injectDataSource", proto, member);
                if (injectDataSource) {
                    const { name, required } = injectDataSource;
                    const conn: any = connectionManager?.connections.get(name);
                    if (conn) {
                        // Always create a copy of the connection so that the user can perform context aware operations without
                        // error. We must also check that it is possible to duplicate the connection.
                        obj[member] = typeof conn.duplicate === "function" ? conn.duplicate() : conn;
                        // Also store the connection in a private map. We'll re-use this for @Transactional
                        obj._datasources = obj._datasources ?? new Map();
                        obj._datasources.set(name, obj[member]);
                        // The `cache` datasource is a special case that we don't want to fail on if it's missing
                    } else if (required) {
                        throw new Error("Unable to find database connection with name: " + name);
                    }
                }

                // Inject @Repository
                const injectRepository: any = Reflect.getMetadata("rrst:injectRepository", proto, member);
                if (injectRepository) {
                    const { type, required } = injectRepository;
                    // Look up the connection name from the model class
                    const datasource: string = (type as Entity).datasource;
                    if (datasource) {
                        const conn: any = connectionManager?.connections.get(datasource);
                        if (conn instanceof MongoConnection || isSqlDataSource(conn)) {
                            obj[member] = conn.getRepository(injectRepository);
                            // Also store the connection in a private map. We'll re-use this for @Transactional
                            obj._datasources = obj._datasources ?? new Map();
                            obj._datasources.set(injectDataSource, conn);
                        } else if (required) {
                            throw new Error("Unable to find database connection with name: " + datasource);
                        }
                    } else {
                        throw new Error("The model " + type.name + " must defined as an entity in datasource config.");
                    }
                }
            }

            proto = Object.getPrototypeOf(proto);
        }

        return super.initialize(obj);
    }
}
