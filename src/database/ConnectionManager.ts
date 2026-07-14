////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { Redis } from "ioredis";
import type { DataSource } from "typeorm";
import { isSqlDataSource } from "./ConnectionKinds.js";
import { MongoConnection } from "./MongoConnection.js";
import { MongoSchemaSync } from "./MongoSchemaSync.js";
const { Destroy, Logger } = ObjectDecorators;

/**
 * Provides database connection management.
 *
 * @author Jean-Philippe Steinmetz
 */
export class ConnectionManager {
    public connections: Map<string, DataSource | MongoConnection | Redis> = new Map();
    @Logger
    private logger: any;

    /**
     * Builds a compatible connection URI for the database by the provided configuration.
     */
    private buildConnectionUri(config: any): string {
        // If a url is provided use that verbatim. We assume it's correct.
        if (config.url) {
            return config.url;
        } else {
            if (!config.type || !config.host) {
                throw new Error(`Invalid datastore config: ${JSON.stringify(config)}.`);
            }
            return `${config.protocol ? config.protocol : config.type}://${config.username && config.password ? `${config.username}:${config.password}@` : ""}${config.host}${config.port ? `:${config.port}` : ""}${config.database ? `/${config.database}` : ""}${config.options ? `?${config.options}` : ""}`;
        }
    }

    /**
     * Dynamically imports the given optional peer dependency, throwing a helpful error if it is not installed.
     *
     * @param pkg The name of the package to import.
     * @param datastoreName The name of the datastore requiring the package.
     * @param datastoreType The type of the datastore requiring the package.
     */
    private async importOptionalDependency(pkg: string, datastoreName: string, datastoreType: string): Promise<any> {
        try {
            return await import(pkg);
        } catch (err: any) {
            throw new Error(
                `Datastore '${datastoreName}' is of type '${datastoreType}' which requires the optional peer dependency '${pkg}'. Install it with: yarn add ${pkg}`,
            );
        }
    }

    /**
     * Attempts to initiate all database connections as defined in the config.
     *
     * @param datastores A map of configured datastores to be passed to the underlying engine.
     * @param models A map of model names and associated class definitions to establish database connections for.
     */
    public async connect(datastores: any, models: Map<string, any>): Promise<void> {
        const processedModels: Map<string, string> = new Map();
        // Go through each datastore in the configuration and attempt to make a connection
        for (const name in datastores) {
            const datastore: any = datastores[name];

            // It's possible that the connection was already configured during a previous run. In that case we will
            // attempt to reconnect instead of creating a new connection.
            let connection: DataSource | MongoConnection | Redis | undefined = this.connections.get(name);

            if (connection && isSqlDataSource(connection) && !(connection as DataSource).isInitialized) {
                this.logger.info(`Reconnecting to database ${name}...`);
                await (connection as DataSource).initialize();
            }

            if (!connection) {
                datastore.name = name;
                const url: string = this.buildConnectionUri(datastore);

                this.logger.info(`Connecting to database ${name} [${url.replace(datastore.username, "****").replace(datastore.password, "****")}]...`);

                if (datastore.type === "redis") {
                    connection = new Redis(url);
                } else {
                    // Make an array of all entities associated with this connection
                    const entities: any[] = [];
                    for (const className of models.keys()) {
                        // Get the class type
                        const clazz = models.get(className);
                        const ds: string = Reflect.getMetadata("rrst:datastore", clazz);
                        // Search for the associated datastore with the model via either config or @Model decorator
                        if (ds === name || (datastore.entities && datastore.entities.includes(className))) {
                            const processedDatastore = processedModels.get(clazz.name);
                            if (processedDatastore) {
                                throw new Error(
                                    `Model ${clazz.name} already defined as an entity for ${processedDatastore}`
                                );
                            }
                            clazz.datastore = name;
                            entities.push(clazz);
                            processedModels.set(clazz.name, name);
                        }
                    }

                    if (datastore.type === "mongodb" || datastore.type === "mongodb+srv") {
                        // Connect using the native MongoDB driver
                        const { MongoClient } = await this.importOptionalDependency("mongodb", name, datastore.type);
                        const client = new MongoClient(url, datastore.clientOptions);
                        await client.connect();
                        const db = client.db(datastore.database);
                        connection = new MongoConnection(name, client, db, entities);

                        // Perform structure synchronization when requested
                        if (datastore.synchronize) {
                            const schemaSync: MongoSchemaSync = new MongoSchemaSync(db, this.logger);
                            await schemaSync.synchronize(entities);
                        }
                    } else {
                        // Connect using TypeORM
                        await this.importOptionalDependency("typeorm", name, datastore.type);
                        const orm = await import("./TypeOrmSupport.js");
                        connection = await orm.connect(name, datastore, entities, url);
                    }
                }
            }

            this.connections.set(name, connection);
        }

        this.logger.info(`Successfully connected to all configured databases.`);
    }

    /**
     * Attempts to disconnect all active database connections.
     */
    @Destroy
    public async disconnect(): Promise<void> {
        for (const conn of this.connections.values()) {
            if (conn) {
                if (conn instanceof MongoConnection) {
                    if (conn.isConnected) {
                        await conn.close();
                    }
                } else if (conn instanceof Redis) {
                    // Disconnect regardless of whether the connection ever reached "ready" — one
                    // stuck retrying against an unreachable server (status stays "connecting" /
                    // "reconnecting" forever) must still be torn down here, or it leaks an
                    // endlessly-retrying client with active reconnect timers past this
                    // ConnectionManager's lifetime. "end" is the only state where disconnect()
                    // would be a redundant no-op.
                    if (conn.status !== "end") {
                        conn.disconnect();
                    }
                } else if (isSqlDataSource(conn) && conn.isInitialized) {
                    await conn.destroy();
                }
            }
        }

        this.connections.clear();
        this.logger.info(`Successfully disconnected from all configured databases.`);
    }
}
