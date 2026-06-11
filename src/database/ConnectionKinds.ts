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
