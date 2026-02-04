////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import { Redis } from "ioredis";
import * as typeorm from "typeorm";
const { Destroy, Logger } = ObjectDecorators;

/**
 * Provides database connection management.
 *
 * @author Jean-Philippe Steinmetz
 */
export class ConnectionManager {
    public connections: Map<string, typeorm.DataSource | Redis> = new Map();
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
            let connection: typeorm.DataSource | Redis | undefined = this.connections.get(name);
            try {
                if (!connection) {
                    connection = typeorm.getConnection(name);
                }
            } catch (err) {
                // We don't care if a connection was not found
            }

            if (connection) {
                if (connection instanceof typeorm.DataSource && !connection.isConnected) {
                    this.logger.info(`Reconnecting to database ${name}...`);
                    await connection.connect();
                }
            } else {
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

                    connection = await typeorm.createConnection({
                        ...datastore,
                        entities,
                        url,
                    });
                    if (datastore.runMigrations) {
                        await connection.runMigrations();
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
                if (conn instanceof typeorm.DataSource && conn.isConnected) {
                    await conn.close();
                } else if (conn instanceof Redis && conn.status === "ready") {
                    conn.disconnect();
                }
            }
        }

        this.connections.clear();
        this.logger.info(`Successfully disconnected from all configured databases.`);
    }
}