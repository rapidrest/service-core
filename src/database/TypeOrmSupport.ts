///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// NOTE: This is the only module in the library that is permitted to import the optional `typeorm` package at
// runtime. It is loaded dynamically by `ConnectionManager` if (and only if) a SQL datastore is configured.
import * as typeorm from "typeorm";
import { pendingTypeOrmColumns } from "../decorators/ModelDecorators.js";
import {
    ColumnInfo,
    IndexInfo,
} from "../decorators/PersistenceDecorators.js";
import { ModelUtils } from "../models/ModelUtils.js";

/**
 * Bridges framework persistence metadata (declared via the decorators in `PersistenceDecorators`) into TypeORM's
 * global metadata storage so that entity classes using framework decorators behave identically to entity classes
 * using TypeORM's own decorators. Registrations are deduplicated so that consumer entities decorated with real
 * TypeORM decorators are never modified.
 *
 * @param entities The list of entity classes to register metadata for.
 */
export function registerFrameworkMetadata(entities: any[]): void {
    const storage = typeorm.getMetadataArgsStorage();

    // Drain any pending column registrations (e.g. the `_type` column added by @ChildEntity)
    for (const column of pendingTypeOrmColumns.splice(0)) {
        const exists: boolean = storage.columns.some(
            (c) => c.target === column.target && c.propertyName === column.propertyName,
        );
        if (!exists) {
            storage.columns.push(column);
        }
    }

    for (const entity of entities) {
        // Register a table for every class in the constructor chain that declares an explicit framework entity
        // name (the framework's @Entity decorator).
        for (let c = entity; c && c !== Function.prototype; c = Object.getPrototypeOf(c)) {
            const entityName: string | undefined = Reflect.getOwnMetadata("rrst:entityName", c);
            if (entityName && !storage.tables.some((t) => t.target === c)) {
                storage.tables.push({
                    target: c,
                    name: entityName,
                    type: "regular",
                    orderBy: undefined,
                    engine: undefined,
                    database: undefined,
                    schema: undefined,
                    synchronize: undefined,
                    withoutRowid: undefined,
                });
            }

            // Register class-level (compound) indexes
            const classIndexes: IndexInfo[] = Reflect.getOwnMetadata("rrst:classIndexes", c) ?? [];
            for (const index of classIndexes) {
                registerIndex(storage, c, index);
            }
        }

        // Register columns and property-level indexes for every level of the prototype chain
        for (
            let proto = entity.prototype;
            proto && proto !== Object.prototype;
            proto = Object.getPrototypeOf(proto)
        ) {
            const target: any = proto.constructor;

            const columns: ColumnInfo[] = Reflect.getOwnMetadata("rrst:columns", proto) ?? [];
            for (const column of columns) {
                // ObjectId columns are MongoDB-specific and are not bridged
                if (column.options.isObjectId) {
                    continue;
                }
                const exists: boolean = storage.columns.some(
                    (c) => c.target === target && c.propertyName === column.propertyName,
                );
                if (exists || !column.designType) {
                    continue;
                }
                storage.columns.push({
                    target,
                    propertyName: column.propertyName,
                    mode: "regular",
                    options: {
                        type: column.designType,
                        ...(column.options.name !== undefined ? { name: column.options.name } : {}),
                        ...(column.options.nullable !== undefined ? { nullable: column.options.nullable } : {}),
                        ...(column.options.primary ? { primary: true } : {}),
                    },
                });
            }

            const indexes: IndexInfo[] = Reflect.getOwnMetadata("rrst:indexes", proto) ?? [];
            for (const index of indexes) {
                registerIndex(storage, target, index);
            }
        }
    }
}

/**
 * Registers a single framework index declaration with TypeORM's metadata storage if an equivalent registration
 * does not already exist.
 */
function registerIndex(storage: any, target: any, index: IndexInfo): void {
    const exists: boolean = storage.indices.some(
        (i: any) =>
            i.target === target &&
            i.name === index.name &&
            JSON.stringify(i.columns) === JSON.stringify(index.columns),
    );
    if (exists) {
        return;
    }
    storage.indices.push({
        target,
        name: index.name,
        columns: index.columns,
        synchronize: true,
        where: undefined,
        unique: !!index.options.unique,
        spatial: false,
        fulltext: false,
        nullFiltered: false,
        parser: undefined,
        sparse: !!index.options.sparse,
        background: !!index.options.background,
        concurrent: false,
        expireAfterSeconds: index.options.expireAfterSeconds,
    });
}

/** Tracks active DataSource instances by datastore name to support reconnection. */
const dataSources = new Map<string, typeorm.DataSource>();

/**
 * Establishes a TypeORM connection for the given SQL datastore configuration. If a connection with the given name
 * already exists it is reused (and reconnected if necessary).
 *
 * @param name The name of the datastore to connect to.
 * @param datastore The datastore configuration to pass to TypeORM.
 * @param entities The list of entity classes assigned to this connection.
 * @param url The connection URL of the database.
 */
export async function connect(name: string, datastore: any, entities: any[], url: string): Promise<typeorm.DataSource> {
    // Make TypeORM's query operators available to query building utilities
    ModelUtils.setTypeOrm(typeorm);

    // Bridge framework-declared persistence metadata into TypeORM
    registerFrameworkMetadata(entities);

    let connection: typeorm.DataSource | undefined = dataSources.get(name);

    if (connection) {
        if (!connection.isInitialized) {
            await connection.initialize();
        }
    } else {
        connection = new typeorm.DataSource({
            ...datastore,
            entities,
            url,
        });
        await connection.initialize();
        dataSources.set(name, connection);
        if (datastore.runMigrations) {
            await connection.runMigrations();
        }
    }

    return connection;
}
