///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { MongoConnection } from "./MongoConnection.js";

/**
 * Determines whether the given connection object is a TypeORM `DataSource` for a SQL database. This check is
 * performed without importing the optional `typeorm` package by duck-typing the connection object.
 *
 * @param conn The connection object to inspect.
 */
export function isSqlDataSource(conn: any): boolean {
    return !!conn && typeof conn.getRepository === "function" && !(conn instanceof MongoConnection);
}

/**
 * Dynamically imports the `redis` package, throwing a helpful error if it isn't installed. `redis` is a peer
 * dependency (like `mongodb` and `typeorm`) rather than a hard dependency of this package, so it must only be
 * loaded when a consumer actually configures a redis-backed feature — never imported at the top of a module
 * that's always loaded, or every consumer would be forced to install it regardless of whether they use it.
 */
export async function importRedis(): Promise<typeof import("redis")> {
    try {
        return await import("redis");
    } catch (err: any) {
        throw new Error("This feature requires the optional peer dependency 'redis'. Install it with: yarn add redis");
    }
}
