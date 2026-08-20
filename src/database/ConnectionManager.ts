////////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ObjectDecorators } from "@rapidrest/core";
import type { DataSource } from "typeorm";
import { importRedis, isSqlDataSource } from "./ConnectionKinds.js";
import { MongoConnection } from "./MongoConnection.js";
import { MongoSchemaSync } from "./MongoSchemaSync.js";
import type { RedisClientType } from "redis";
const { Destroy, Logger } = ObjectDecorators;

/**
 * Provides database connection management.
 *
 * @author Jean-Philippe Steinmetz
 */
export class ConnectionManager {
    public connections: Map<string, DataSource | MongoConnection | RedisClientType> = new Map();
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
                throw new Error(`Invalid datasource config: ${JSON.stringify(config)}.`);
            }
            return `${config.protocol ? config.protocol : config.type}://${config.username && config.password ? `${config.username}:${config.password}@` : ""}${config.host}${config.port ? `:${config.port}` : ""}${config.database ? `/${config.database}` : ""}${config.options ? `?${config.options}` : ""}`;
        }
    }

    /**
     * Redacts the userinfo (credentials) portion of a connection URI for safe logging, regardless of
     * whether the URI came from a `url` config field or was built from separate username/password fields.
     */
    private redactUri(uri: string): string {
        return uri.replace(/:\/\/[^@/]+@/, "://****@");
    }

    /**
     * Dynamically imports the given optional peer dependency, throwing a helpful error if it is not installed.
     *
     * @param pkg The name of the package to import.
     * @param datastoreName The name of the datasource requiring the package.
     * @param datastoreType The type of the datasource requiring the package.
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
     * Determines whether the given MongoDB deployment supports multi-document transactions (i.e. is configured
     * as a replica set or a sharded cluster) by inspecting the `hello` handshake response. A standalone
     * `mongod` responds with neither `setName` (replica set membership) nor `msg: "isdbgrid"` (mongos), and
     * doesn't support transactions at all.
     *
     * @param db The database to check.
     * @param name The name of the datastore, used only for the log message if transactions aren't supported.
     */
    private async detectMongoTransactionSupport(db: any, name: string): Promise<boolean> {
        try {
            const hello: any = await db.admin().command({ hello: 1 });
            const supported: boolean = !!hello.setName || hello.msg === "isdbgrid";
            if (!supported) {
                this.logger.warn(
                    `Datastore '${name}' is a standalone MongoDB instance and does not support multi-document ` +
                        `transactions. @Transactional will run without a transaction for models on this ` +
                        `datastore. Configure MongoDB as a replica set (or sharded cluster) to enable it.`,
                );
            }
            return supported;
        } catch (err: any) {
            this.logger.warn(
                `Datastore '${name}': failed to determine whether the MongoDB deployment supports ` +
                    `transactions (${err.message}). Assuming it does not; @Transactional will run without a ` +
                    `transaction for models on this datastore.`,
            );
            return false;
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

        // Redis-type datastores are connected sequentially, separately from the concurrent Promise.all below
        // for every other datastore. Two concurrent *first* dynamic imports of the same module can, under
        // some tooling that mocks dynamic imports (e.g. Vitest), non-deterministically resolve to a mix of
        // the mocked and the real module instead of consistently returning the mock — sequencing avoids ever
        // having two redis connection attempts in flight at once, which is where that surfaces. Redis
        // connections are cheap enough that this isn't a meaningful hit to startup concurrency.
        const redisNames: string[] = Object.keys(datastores).filter((name) => datastores[name]?.type === "redis");
        for (const name of redisNames) {
            await this.connectDatastore(name, datastores[name], models, processedModels);
        }

        const pending: Promise<void>[] = [];
        for (const name in datastores) {
            if (!redisNames.includes(name)) {
                pending.push(this.connectDatastore(name, datastores[name], models, processedModels));
            }
        }
        await Promise.all(pending);

        this.logger.info(`Successfully connected to all configured databases.`);
    }

    /**
     * Establishes (or reconnects) a single configured datasource connection and stores it in `this.connections`.
     *
     * @param name The configured name of the datasource.
     * @param datasource The datasource's configuration.
     * @param models A map of model names and associated class definitions to establish database connections for.
     * @param processedModels Tracks which datasource each model class has already been claimed as an entity for,
     * shared across every concurrent call from `connect()` so a model claimed by two datastores is still caught.
     */
    private async connectDatastore(
        name: string,
        datasource: any,
        models: Map<string, any>,
        processedModels: Map<string, string>,
    ): Promise<void> {
        // It's possible that the connection was already configured during a previous run. In that case we will
        // attempt to reconnect instead of creating a new connection.
        let connection: DataSource | MongoConnection | RedisClientType | undefined = this.connections.get(name);

        if (connection && isSqlDataSource(connection) && !(connection as DataSource).isInitialized) {
            this.logger.info(`Reconnecting to database ${name}...`);
            await (connection as DataSource).initialize();
        }

        if (!connection) {
            datasource.name = name;
            const url: string = this.buildConnectionUri(datasource);

            this.logger.info(`Connecting to database ${name} [${this.redactUri(url)}]...`);

            if (datasource.type === "redis") {
                // Uses a literal `import("redis")` specifier (via importRedis()) rather than this class's
                // generic importOptionalDependency(pkg, ...) helper, whose variable specifier bundler/test
                // tooling (e.g. Vitest's module mocking) can't always statically analyze and intercept.
                const { createClient } = await importRedis();
                const redisConn: RedisClientType = createClient({ url });
                await redisConn.connect();
                connection = redisConn;
            } else {
                // Make an array of all entities associated with this connection
                const entities: any[] = [];
                for (const className of models.keys()) {
                    // Get the class type
                    const clazz = models.get(className);
                    const ds: string = Reflect.getMetadata("rrst:datasource", clazz);
                    // Search for the associated datasource with the model via either config or @Model decorator
                    if (ds === name || (datasource.entities && datasource.entities.includes(className))) {
                        const processedDatastore = processedModels.get(clazz.name);
                        if (processedDatastore) {
                            throw new Error(
                                `Model ${clazz.name} already defined as an entity for ${processedDatastore}`,
                            );
                        }
                        clazz.datasource = name;
                        entities.push(clazz);
                        processedModels.set(clazz.name, name);
                    }
                }

                if (datasource.type === "mongodb" || datasource.type === "mongodb+srv") {
                    // Connect using the native MongoDB driver
                    const { MongoClient } = await this.importOptionalDependency("mongodb", name, datasource.type);
                    const client = new MongoClient(url, datasource.clientOptions);
                    await client.connect();
                    const db = client.db(datasource.database);
                    const supportsTransactions: boolean = await this.detectMongoTransactionSupport(db, name);
                    connection = new MongoConnection(name, client, db, entities, supportsTransactions);

                    // Perform structure synchronization when requested
                    if (datasource.synchronize) {
                        const schemaSync: MongoSchemaSync = new MongoSchemaSync(db, this.logger);
                        await schemaSync.synchronize(entities);
                    }
                } else {
                    // Connect using TypeORM
                    await this.importOptionalDependency("typeorm", name, datasource.type);
                    const orm = await import("./TypeOrmSupport.js");
                    connection = await orm.connect(name, datasource, entities, url);
                }
            }
        }

        this.connections.set(name, connection);
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
                } else if (isSqlDataSource(conn)) {
                    const sqlConn: DataSource = conn as DataSource;
                    if (sqlConn.isInitialized) {
                        await sqlConn.destroy();
                    }
                } else if (typeof (conn as any).disconnect === "function") {
                    // The only other connection kind this class ever creates is a redis client. Duck-typed
                    // (rather than `instanceof RedisClient`) so `redis` doesn't need to be imported here just
                    // to identify a connection this class already knows isn't Mongo or SQL — it's a peer
                    // dependency, loaded dynamically only where actually needed (see connectDatastore()).
                    const redis: RedisClientType = conn as RedisClientType;
                    // Disconnect regardless of whether the connection ever reached "ready" — one
                    // stuck retrying against an unreachable server (isOpen stays true while it keeps
                    // retrying in the background) must still be torn down here, or it leaks an
                    // endlessly-retrying client with active reconnect timers past this
                    // ConnectionManager's lifetime. `isOpen` is false only once the client has actually
                    // closed, so a redundant disconnect() call is skipped in that case.
                    if (redis.isOpen) {
                        await redis.disconnect();
                    }
                }
            }
        }

        this.connections.clear();
        this.logger.info(`Successfully disconnected from all configured databases.`);
    }
}
