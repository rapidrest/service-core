///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as uuid from "uuid";
import { backfillLatest, connect, release } from "../../src/database/TypeOrmSupport";
import { Column, Entity } from "../../src/decorators/PersistenceDecorators";
import { TrackChanges } from "../../src/decorators/ModelDecorators";
import { BaseEntity } from "../../src/models/BaseEntity";

@Entity({ name: "latest_sql_tracked" })
@TrackChanges()
class SqlTracked extends BaseEntity {
    @Column({ nullable: true })
    public status: string = "";
}

@Entity({ name: "latest_sql_alias" })
@TrackChanges(2)
class SqlAlias extends BaseEntity {
    @Column({ nullable: true })
    public status: string = "";
}

@Entity({ name: "latest_sql_zero" })
@TrackChanges(0)
class SqlZero extends BaseEntity {
    @Column({ nullable: true })
    public status: string = "";
}

@Entity({ name: "latest_sql_plain" })
class SqlPlain extends BaseEntity {
    @Column({ nullable: true })
    public status: string = "";
}

/** A row as an older release would have written it: the system columns set, and no `latest` marker. */
const row = (values: any): any => ({ dateCreated: new Date(), dateModified: new Date(), ...values });

describe("TypeOrmSupport latest marker Tests [SQL]", () => {
    const files: string[] = [];
    const entities = [SqlTracked, SqlAlias, SqlZero, SqlPlain];
    const tempFile = (): string => {
        const file = path.join(os.tmpdir(), `rrst-latest-${uuid.v4()}.sqlite`);
        files.push(file);
        return file;
    };
    const datasource = (file: string): any => ({ type: "better-sqlite3", database: file, synchronize: true });

    afterAll(() => {
        for (const file of files) {
            fs.rmSync(file, { force: true });
        }
    });

    const currentOf = async (conn: any, clazz: any): Promise<string[]> =>
        (await conn.getRepository(clazz).find({ where: { latest: true } }))
            .map((row: any) => `${row.uid}${row.version}`)
            .sort();

    it("adds a latest column and a (uid, latest) index to a tracked entity only", async () => {
        const name = `cols-${uuid.v4()}`;
        const conn = await connect(name, datasource(tempFile()), entities, "");
        try {
            for (const clazz of [SqlTracked, SqlAlias]) {
                const metadata = conn.getMetadata(clazz);
                expect(metadata.findColumnWithPropertyName("latest")).toBeDefined();
                expect(metadata.indices.some((i) => i.columns.map((c) => c.propertyName).join() === "uid,latest")).toBe(true);
            }
            // @TrackChanges(0) is untracked, like an entity without the decorator.
            for (const clazz of [SqlZero, SqlPlain]) {
                expect(conn.getMetadata(clazz).findColumnWithPropertyName("latest")).toBeUndefined();
            }
        } finally {
            await conn.destroy();
            release(name, conn);
        }
    });

    it("backfills rows without a marker when it connects, and is idempotent", async () => {
        const file = tempFile();
        const name = `backfill-${uuid.v4()}`;
        let conn = await connect(name, datasource(file), entities, "");
        try {
            const repo: any = conn.getRepository(SqlTracked);
            for (const [uid, version] of [
                ["a", 1],
                ["a", 0],
                ["a", 2],
                ["b", 0],
                ["b", 1],
                ["c", 0],
            ] as [string, number][]) {
                // `latest` defaults to false: this is a pre-existing row, written before the marker existed.
                await repo.insert(row({ uid, version, status: "x" }));
            }
            await conn.getRepository(SqlPlain).insert(row({ uid: "p", version: 0, status: "x" }));
            await conn.destroy();
            release(name, conn);

            // The next startup finds records with no current row and fixes them.
            conn = await connect(name, datasource(file), entities, "");
            expect(await currentOf(conn, SqlTracked)).toEqual(["a2", "b1", "c0"]);
            expect(await conn.getRepository(SqlTracked).count({ where: { latest: false } })).toBe(3);

            expect(await backfillLatest(conn, entities)).toBe(0);
            expect(await currentOf(conn, SqlTracked)).toEqual(["a2", "b1", "c0"]);
        } finally {
            await conn.destroy();
            release(name, conn);
        }
    });

    it("repairs every record of the table once any record has no current version", async () => {
        const name = `repair-${uuid.v4()}`;
        const conn = await connect(name, datasource(tempFile()), entities, "");
        try {
            const repo: any = conn.getRepository(SqlTracked);
            await repo.insert(row({ uid: "r", version: 0, status: "x", latest: true }));
            await repo.insert(row({ uid: "r", version: 1, status: "x", latest: true }));
            await repo.insert(row({ uid: "r", version: 2, status: "x", latest: false }));
            await repo.insert(row({ uid: "s", version: 0, status: "x", latest: true }));

            // Every record has a current row, however wrong: the cheap check finds nothing to do.
            expect(await backfillLatest(conn, entities)).toBe(0);

            // Once a record has none, the whole table is recomputed: r2 becomes current, r0 and r1 stop being.
            await repo.update({ uid: "s" }, { latest: false });
            expect(await backfillLatest(conn, entities)).toBe(4);
            expect(await currentOf(conn, SqlTracked)).toEqual(["r2", "s0"]);
        } finally {
            await conn.destroy();
            release(name, conn);
        }
    });

    it("backfills a table once when two entities share it", async () => {
        const name = `shared-${uuid.v4()}`;
        const conn = await connect(name, datasource(tempFile()), entities, "");
        try {
            await conn.getRepository(SqlTracked).insert(row({ uid: "a", version: 0, status: "x" }));
            expect(await backfillLatest(conn, [SqlTracked, SqlTracked, SqlZero])).toBe(1);
            expect(await currentOf(conn, SqlTracked)).toEqual(["a0"]);
        } finally {
            await conn.destroy();
            release(name, conn);
        }
    });

    it("counts nothing when the driver doesn't report the rows it changed", async () => {
        const name = `unreported-${uuid.v4()}`;
        const conn = await connect(name, datasource(tempFile()), entities, "");
        try {
            await conn.getRepository(SqlTracked).insert(row({ uid: "a", version: 0, status: "x" }));
            const query: any = { escape: (n: string) => `"${n}"`, update: () => query, set: () => query };
            query.where = () => query;
            query.andWhere = () => query;
            query.execute = async () => ({});
            const quiet: any = Object.create(conn, {
                transaction: { value: (work: any) => work({ createQueryBuilder: () => query }) },
            });
            expect(await backfillLatest(quiet, [SqlTracked])).toBe(0);
        } finally {
            await conn.destroy();
            release(name, conn);
        }
    });

    it("uses a derived table for the newest version on MySQL and MariaDB", async () => {
        const name = `mysql-${uuid.v4()}`;
        const conn = await connect(name, datasource(tempFile()), entities, "");
        try {
            const repo: any = conn.getRepository(SqlTracked);
            await repo.insert(row({ uid: "a", version: 0, status: "x" }));
            await repo.insert(row({ uid: "a", version: 1, status: "x" }));

            // The statement text is valid SQLite too, so the MySQL variant can be run here.
            const asMysql: any = Object.create(conn, { options: { value: { type: "mysql" } } });
            expect(await backfillLatest(asMysql, [SqlTracked])).toBe(1);
            expect(await currentOf(conn, SqlTracked)).toEqual(["a1"]);
        } finally {
            await conn.destroy();
            release(name, conn);
        }
    });
});
