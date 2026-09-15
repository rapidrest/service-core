///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////

/**
 * Returns the underlying driver error of `err`: TypeORM wraps a driver error in a `QueryFailedError` (copying most
 * of its properties onto the wrapper, and keeping the original as `driverError`).
 */
function driverErrorOf(err: any): any {
    return err?.driverError ?? err;
}

/**
 * Determines whether `err` is a unique/primary key violation reported by any of the supported database drivers:
 * - MongoDB: code `11000` (or `11001`);
 * - PostgreSQL: SQLSTATE `23505`;
 * - MySQL/MariaDB: `ER_DUP_ENTRY` (errno `1062`);
 * - SQLite (`better-sqlite3`/`sqlite3`): `SQLITE_CONSTRAINT_UNIQUE`/`SQLITE_CONSTRAINT_PRIMARYKEY`, or a generic
 * `SQLITE_CONSTRAINT` whose message is a `UNIQUE constraint failed` error.
 *
 * @param err The error to inspect.
 */
export function isDuplicateKeyError(err: any): boolean {
    if (!err) {
        return false;
    }
    for (const e of [err, driverErrorOf(err)]) {
        const code: any = e?.code;
        if (code === 11000 || code === 11001 || code === "23505" || code === "ER_DUP_ENTRY" || e?.errno === 1062) {
            return true;
        }
        if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") {
            return true;
        }
        if (typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT") && /UNIQUE constraint failed/i.test(e?.message ?? "")) {
            return true;
        }
    }
    return false;
}

/**
 * Best-effort extraction of the field names involved in a duplicate key error, for telling a primary key/version
 * clash apart from a clash on some other unique column. Returns `undefined` when the driver's error doesn't say.
 * The special value `"PRIMARY"` is returned when the driver only names the primary key (MySQL, a PostgreSQL `PK_`
 * constraint).
 */
export function duplicateKeyFields(err: any): string[] | undefined {
    const e: any = driverErrorOf(err);
    if (e?.keyPattern && typeof e.keyPattern === "object") {
        return Object.keys(e.keyPattern);
    }
    const message: string = String(e?.message ?? err?.message ?? "");
    // SQLite: "UNIQUE constraint failed: table.uid, table.version"
    const sqlite: RegExpMatchArray | null = message.match(/UNIQUE constraint failed: (.+)$/im);
    if (sqlite) {
        return sqlite[1].split(",").map((col) => col.trim().split(".").pop() as string);
    }
    // PostgreSQL: detail "Key (uid, version)=(a, 1) already exists."
    const pg: RegExpMatchArray | null = String(e?.detail ?? "").match(/^Key \(([^)]*)\)=/);
    if (pg) {
        return pg[1].split(",").map((col) => col.trim().replace(/^"|"$/g, ""));
    }
    if (typeof e?.constraint === "string" && e.constraint.startsWith("PK_")) {
        return ["PRIMARY"];
    }
    // MySQL: "Duplicate entry 'a-1' for key 'PRIMARY'" (or 'table.PRIMARY')
    const mysql: RegExpMatchArray | null = String(e?.sqlMessage ?? message).match(/for key '([^']+)'/);
    if (mysql) {
        const key: string = mysql[1].split(".").pop() as string;
        return key === "PRIMARY" ? ["PRIMARY"] : undefined;
    }
    return undefined;
}

/**
 * Determines whether a duplicate key error is a clash on a record's identity - its `_id`/primary key or its
 * `(uid, version)` pair - rather than on some other unique column.
 *
 * @param err The duplicate key error.
 * @param fallback The answer to give when the driver's error doesn't name the fields involved.
 */
export function isIdentityDuplicate(err: any, fallback: boolean): boolean {
    const fields: string[] | undefined = duplicateKeyFields(err);
    if (!fields || fields.length === 0) {
        return fallback;
    }
    const identity: Set<string> = new Set(["_id", "id", "uid", "version", "PRIMARY"]);
    return fields.every((field) => identity.has(field));
}
