///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// NOTE: This is the only module in the library that is permitted to import the optional `typeorm` package at
// runtime. It is loaded dynamically by `ConnectionManager` if (and only if) a SQL datasource is configured.
import * as typeorm from "typeorm";
import { pendingTypeOrmColumns } from "../decorators/ModelDecorators.js";
import { ColumnInfo, FORWARDED_SQL_COLUMN_OPTIONS, IndexInfo } from "../decorators/PersistenceDecorators.js";
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

        // A @TrackChanges() entity stores one row per (uid, version) rather than one row per uid, so its
        // primary key must cover both columns. Otherwise, inserting a second version row always violates
        // uid's own primary key constraint. Every other entity keeps uid alone as its primary key.
        const isTrackChanges: boolean = !!entity.trackChanges;

        // Primary key columns are already guaranteed unique by the database; an additional explicit index on the
        // same single column is redundant and, for SQLite in particular, collides with the index that TypeORM
        // generates automatically to enforce uniqueness of non-integer primary keys.
        const primaryProperties: Set<string> = new Set();
        for (let proto = entity.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
            const columns: ColumnInfo[] = Reflect.getOwnMetadata("rrst:columns", proto) ?? [];
            for (const column of columns) {
                if (column.options.primary || (isTrackChanges && column.propertyName === "version")) {
                    primaryProperties.add(column.propertyName);
                }
            }
        }

        // Register columns and property-level indexes for every level of the prototype chain
        let versionColumnType: any;
        for (let proto = entity.prototype; proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
            const target: any = proto.constructor;

            const columns: ColumnInfo[] = Reflect.getOwnMetadata("rrst:columns", proto) ?? [];
            for (const column of columns) {
                // ObjectId columns are MongoDB-specific and are not bridged
                if (column.options.isObjectId) {
                    continue;
                }
                const resolvedType: any = column.options.type ?? column.designType;
                if (isTrackChanges && column.propertyName === "version") {
                    versionColumnType = resolvedType;
                }

                const exists: boolean = storage.columns.some(
                    (c) => c.target === target && c.propertyName === column.propertyName,
                );
                if (exists || !resolvedType) {
                    continue;
                }
                const options: any = { type: resolvedType };
                for (const key of FORWARDED_SQL_COLUMN_OPTIONS) {
                    if (column.options[key] !== undefined) {
                        options[key] = column.options[key];
                    }
                }
                if (column.options.primary) {
                    options.primary = true;
                }
                storage.columns.push({
                    target,
                    propertyName: column.propertyName,
                    mode: "regular",
                    options,
                });
            }

            const indexes: IndexInfo[] = Reflect.getOwnMetadata("rrst:indexes", proto) ?? [];
            for (const index of indexes) {
                if (index.columns.length === 1 && primaryProperties.has(index.columns[0])) {
                    continue;
                }
                registerIndex(storage, target, index);
            }
        }

        // Promote "version" to a primary column for this trackChanges entity specifically. This can't be done
        // by mutating the shared BaseEntity-level "version" registration above (that's visible to, and would
        // incorrectly promote, every other entity that inherits it too). So it's registered separately here,
        // under this entity's own (leaf) target instead. TypeORM resolves an entity's columns by walking its
        // whole inheritance chain and, when the same property name is registered against more than one class
        // in that chain, keeps whichever registration appears FIRST in TypeORM's metadata args storage array
        // (see MetadataArgsStorage.filterByTargetAndWithoutDuplicateProperties).
        if (
            isTrackChanges &&
            versionColumnType &&
            !storage.columns.some((c) => c.target === entity && c.propertyName === "version")
        ) {
            storage.columns.unshift({
                target: entity,
                propertyName: "version",
                mode: "regular",
                options: { type: versionColumnType, primary: true },
            });
        }

        // A @TrackChanges() entity also gets the `latest` marker the write paths keep on each record's current
        // version (see `RepoUtils`), and an index to find it by. Like "version" above it belongs to this entity
        // only, not to the shared base class. A column added to an existing table defaults to false: see
        // `backfillLatest()`.
        if (isTrackChanges) {
            if (!storage.columns.some((c) => c.target === entity && c.propertyName === "latest")) {
                storage.columns.push({
                    target: entity,
                    propertyName: "latest",
                    mode: "regular",
                    options: { type: Boolean, default: false },
                });
            }
            registerIndex(storage, entity, { columns: ["uid", "latest"], options: {} });
        }
    }
}

/**
 * Sets the `latest` marker of every row of the `@TrackChanges` entities in `entities`: `true` on the newest version
 * of each `uid`, `false` on every other one. Does nothing, after one cheap lookup per table, unless some row has no
 * `latest` row for its `uid` at all, which is the state of every tracked row written before the marker existed (the
 * column defaults to `false`). Run at connect, after the schema is in place. Also run it by hand to repair a table
 * that an older instance wrote to during a rolling deploy. Safe to run more than once.
 *
 * Two portable `UPDATE` statements in one transaction, each comparing a row's `version` with the `uid`'s maximum. On
 * MySQL and MariaDB, which refuse a subquery on the table being updated, the maximum comes from a derived table.
 *
 * @param connection The initialized connection.
 * @param entities The entity classes of the connection.
 * @returns The number of rows that were rewritten.
 */
export async function backfillLatest(connection: typeorm.DataSource, entities: any[]): Promise<number> {
    let total: number = 0;
    const done: Set<string> = new Set();
    for (const entity of entities) {
        if (!ModelUtils.isTrackChanges(entity)) {
            continue;
        }
        const metadata = connection.getMetadata(entity);
        if (done.has(metadata.tablePath)) {
            continue;
        }
        done.add(metadata.tablePath);

        // Any row that is not current and whose record has no current row at all?
        const orphan: any = await connection
            .getRepository(entity)
            .createQueryBuilder("a")
            .select("a.uid", "uid")
            .where("a.latest = :no", { no: false })
            .andWhere(
                (qb) =>
                    "NOT EXISTS " +
                    qb
                        .subQuery()
                        .select("1")
                        .from(entity, "b")
                        .where("b.uid = a.uid")
                        .andWhere("b.latest = :yes")
                        .getQuery(),
            )
            .setParameter("yes", true)
            .limit(1)
            .getRawOne();
        if (!orphan) {
            continue;
        }

        await connection.transaction(async (manager) => {
            const qb = manager.createQueryBuilder();
            const table: string = qb.escape(metadata.tableName);
            const column = (name: string): string => qb.escape(metadata.findColumnWithPropertyName(name)!.databaseName);
            const [uid, version, latest] = [column("uid"), column("version"), column("latest")];
            const maxVersion: string =
                connection.options.type === "mysql" || connection.options.type === "mariadb"
                    ? `(SELECT x.mv FROM (SELECT ${uid} AS mu, MAX(${version}) AS mv FROM ${table} GROUP BY ${uid}) x ` +
                      `WHERE x.mu = ${table}.${uid})`
                    : `(SELECT MAX(m.${version}) FROM ${table} m WHERE m.${uid} = ${table}.${uid})`;

            for (const current of [true, false]) {
                const result = await manager
                    .createQueryBuilder()
                    .update(entity)
                    .set({ latest: current })
                    .where(`${version} ${current ? "=" : "<>"} ${maxVersion}`)
                    .andWhere(`${latest} = :was`, { was: !current })
                    .execute();
                total += result.affected ?? 0;
            }
        });
    }
    return total;
}

/**
 * Registers a single framework index declaration with TypeORM's metadata storage if an equivalent registration
 * does not already exist.
 */
function registerIndex(storage: any, target: any, index: IndexInfo): void {
    const exists: boolean = storage.indices.some(
        (i: any) =>
            i.target === target && i.name === index.name && JSON.stringify(i.columns) === JSON.stringify(index.columns),
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

/** Tracks active DataSource instances by datasource name, so connecting again with the same options shares one. */
const dataSources = new Map<string, typeorm.DataSource>();

/**
 * Returns `true` when a cached DataSource can serve a new `connect()` call: it's still initialized, and it was created
 * for the same URL and exactly the same entity classes. A DataSource's entity metadata is fixed when it's built, so
 * one created for a different entity list would leave the missing entities without metadata (and `synchronize`
 * without their tables).
 */
function canReuse(connection: typeorm.DataSource, entities: any[], url: string): boolean {
    if (!connection.isInitialized) {
        return false;
    }
    const options: any = connection.options;
    if (options.url !== url) {
        return false;
    }
    const existing: any[] = Array.isArray(options.entities) ? options.entities : [];
    if (existing.length !== entities.length) {
        return false;
    }
    const wanted = new Set(entities);
    return existing.every((entity) => wanted.has(entity));
}

/**
 * Establishes a TypeORM connection for the given SQL datasource configuration. A connection with the given name is
 * reused only while it's still initialized and was created for the same URL and entities; otherwise a new
 * DataSource is created and replaces it under that name.
 *
 * @param name The name of the datasource to connect to.
 * @param datasource The datasource configuration to pass to TypeORM.
 * @param entities The list of entity classes assigned to this connection.
 * @param url The connection URL of the database.
 */
export async function connect(
    name: string,
    datasource: any,
    entities: any[],
    url: string,
): Promise<typeorm.DataSource> {
    // Make TypeORM's query operators available to query building utilities
    ModelUtils.setTypeOrm(typeorm);

    // Bridge framework-declared persistence metadata into TypeORM
    registerFrameworkMetadata(entities);

    let connection: typeorm.DataSource | undefined = dataSources.get(name);

    if (!connection || !canReuse(connection, entities, url)) {
        connection = new typeorm.DataSource({
            ...datasource,
            entities,
            url,
        });
        await connection.initialize();
        dataSources.set(name, connection);
        if (datasource.runMigrations) {
            await connection.runMigrations();
        }
        await backfillLatest(connection, entities);
    }

    registerRegexpFunction(connection);

    return connection;
}

/**
 * Removes the cached DataSource for `name` if it is `connection`, so a later `connect()` under that name creates a
 * new one. Called after the DataSource is destroyed.
 *
 * @param name The name the DataSource was connected under.
 * @param connection The DataSource being released.
 */
export function release(name: string, connection: typeorm.DataSource): void {
    if (dataSources.get(name) === connection) {
        dataSources.delete(name);
    }
}

/**
 * Registers a `REGEXP` custom SQL function on a `better-sqlite3` connection, so `ModelUtils`'s `regex()` search
 * operator (compiled to `<column> REGEXP :pattern` for this driver) works the same way it does on PostgreSQL
 * (`~*`) and MySQL/MariaDB (`REGEXP`), both of which support regex matching natively. No-op for any other
 * driver type, or if the underlying driver connection doesn't expose the synchronous `.function()` registration
 * API `better-sqlite3` provides (guarded rather than assumed, since TypeORM's `databaseConnection` is typed
 * `any` and driver internals aren't a stable contract).
 *
 * The registered function fails closed (returns 0/no-match) for a pattern `ModelUtils.isUnsafeRegexPattern`
 * flags as ReDoS-shaped, or that otherwise fails to compile as a `RegExp` - a query built through
 * `ModelUtils.buildSearchQuerySQL`/`buildQueryFromNode` already rejects such a pattern before it reaches here,
 * but this function may also be reached by a raw `Raw()`/QueryBuilder expression elsewhere that didn't go
 * through those guards.
 */
function registerRegexpFunction(connection: typeorm.DataSource): void {
    const driver: any = (connection as any).driver;
    if (driver?.options?.type !== "better-sqlite3") {
        return;
    }
    const db: any = driver.databaseConnection;
    if (typeof db?.function !== "function") {
        return;
    }
    try {
        db.function("REGEXP", { deterministic: true }, (pattern: string, value: unknown) => {
            if (value === null || value === undefined || typeof pattern !== "string") {
                return 0;
            }
            if (ModelUtils.isUnsafeRegexPattern(pattern)) {
                return 0;
            }
            try {
                return new RegExp(pattern, "i").test(String(value)) ? 1 : 0;
            } catch (err) {
                return 0;
            }
        });
    } catch (err) {
        // A `REGEXP` function may already be registered (e.g. a reused/reconnected DataSource) - better-sqlite3
        // throws on a duplicate registration. Not fatal: the existing registration is left in place.
    }
}
