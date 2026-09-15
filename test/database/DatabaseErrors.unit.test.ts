///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { duplicateKeyFields, isDuplicateKeyError, isIdentityDuplicate } from "../../src/database/DatabaseErrors";

const err = (props: any, message: string = "boom"): any => Object.assign(new Error(message), props);

describe("DatabaseErrors", () => {
    describe("isDuplicateKeyError()", () => {
        it.each([
            ["MongoDB 11000", err({ code: 11000 })],
            ["MongoDB 11001", err({ code: 11001 })],
            ["PostgreSQL 23505", err({ code: "23505" })],
            ["MySQL ER_DUP_ENTRY", err({ code: "ER_DUP_ENTRY" })],
            ["MySQL errno 1062", err({ errno: 1062 })],
            ["SQLite unique", err({ code: "SQLITE_CONSTRAINT_UNIQUE" })],
            ["SQLite primary key", err({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" })],
            ["sqlite3 generic constraint", err({ code: "SQLITE_CONSTRAINT" }, "SQLITE_CONSTRAINT: UNIQUE constraint failed: t.a")],
            ["TypeORM-wrapped driver error", err({ driverError: { code: "23505" } })],
        ])("recognizes %s", (_name, e) => {
            expect(isDuplicateKeyError(e)).toBe(true);
        });

        it.each([
            ["nothing", undefined],
            ["another Mongo error", err({ code: 2 })],
            ["a NOT NULL constraint", err({ code: "SQLITE_CONSTRAINT" }, "NOT NULL constraint failed: t.a")],
            ["a plain error", new Error("E11000 lookalike")],
        ])("rejects %s", (_name, e) => {
            expect(isDuplicateKeyError(e)).toBe(false);
        });
    });

    describe("duplicateKeyFields() and isIdentityDuplicate()", () => {
        it.each([
            ["MongoDB keyPattern", err({ code: 11000, keyPattern: { uid: 1, version: 1 } }), ["uid", "version"], true],
            ["MongoDB unique column", err({ code: 11000, keyPattern: { email: 1 } }), ["email"], false],
            [
                "SQLite",
                err({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" }, "UNIQUE constraint failed: note.uid, note.version"),
                ["uid", "version"],
                true,
            ],
            ["PostgreSQL detail", err({ code: "23505", detail: 'Key ("code")=(x) already exists.' }), ["code"], false],
            ["PostgreSQL PK constraint", err({ code: "23505", constraint: "PK_abc" }), ["PRIMARY"], true],
            [
                "MySQL primary",
                err({ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry 'a-1' for key 'note.PRIMARY'" }),
                ["PRIMARY"],
                true,
            ],
        ])("reads %s", (_name, e, fields, identity) => {
            expect(duplicateKeyFields(e)).toEqual(fields);
            expect(isIdentityDuplicate(e, !identity)).toBe(identity);
        });

        it("falls back when the driver doesn't name the fields", () => {
            const mysqlOther = err({ code: "ER_DUP_ENTRY", sqlMessage: "Duplicate entry 'x' for key 'idx_code'" });
            expect(duplicateKeyFields(mysqlOther)).toBeUndefined();
            expect(duplicateKeyFields(err({ code: 11000, keyPattern: {} }))).toEqual([]);
            expect(isIdentityDuplicate(err({ code: 11000, keyPattern: {} }), true)).toBe(true);
            expect(isIdentityDuplicate(err({ code: "23505" }), false)).toBe(false);
            expect(isIdentityDuplicate(err({ code: "23505" }), true)).toBe(true);
            expect(duplicateKeyFields(undefined)).toBeUndefined();
        });
    });
});
