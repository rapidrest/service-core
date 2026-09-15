///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Integration tests for the SQL `@Column` options bridged into TypeORM by `registerFrameworkMetadata()`, against a
// real file-backed SQLite database, so `synchronize` really alters a table that already has rows.
import "reflect-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as uuid from "uuid";
import * as typeorm from "typeorm";
import { registerFrameworkMetadata } from "../../src/database/TypeOrmSupport";
import { Column, Entity } from "../../src/decorators/PersistenceDecorators";

const TABLE = "column_options_item";

@Entity({ name: TABLE })
class ItemV1 {
    @Column({ primary: true })
    public uid: string = "";

    @Column()
    public name: string = "";
}

// The same table after a model change: new NOT NULL columns with defaults, plus the other forwarded options.
@Entity({ name: TABLE })
class ItemV2 {
    @Column({ primary: true })
    public uid: string = "";

    @Column()
    public name: string = "";

    @Column({ default: false })
    public flag: boolean = false;

    @Column({ length: 16, default: "none" })
    public code: string = "";

    @Column({ type: "decimal", precision: 10, scale: 2, default: 0 })
    public price: number = 0;

    @Column({ type: "varchar", nullable: true, unique: true })
    public email?: string;
}

// The same change without a default, which is what fails without the `default` option.
@Entity({ name: TABLE })
class ItemV2NoDefault {
    @Column({ primary: true })
    public uid: string = "";

    @Column()
    public name: string = "";

    @Column()
    public flag: boolean = false;
}

async function open(file: string, entity: any): Promise<typeorm.DataSource> {
    registerFrameworkMetadata([entity]);
    const ds = new typeorm.DataSource({
        type: "better-sqlite3",
        database: file,
        entities: [entity],
        synchronize: true,
    });
    try {
        await ds.initialize();
    } catch (err) {
        if (ds.isInitialized) {
            await ds.destroy();
        }
        throw err;
    }
    return ds;
}

async function seed(file: string): Promise<void> {
    const ds = await open(file, ItemV1);
    await ds.getRepository(ItemV1).insert([
        { uid: "a", name: "first" },
        { uid: "b", name: "second" },
    ]);
    await ds.destroy();
}

describe("TypeORM column options Tests [SQL]", () => {
    const files: string[] = [];
    const tempFile = (): string => {
        const file = path.join(os.tmpdir(), `rrst-column-options-${uuid.v4()}.sqlite`);
        files.push(file);
        return file;
    };

    afterAll(() => {
        for (const file of files) {
            fs.rmSync(file, { force: true });
        }
    });

    it("Fails to add a NOT NULL column without a default to a table with rows (the case `default` fixes).", async () => {
        const file = tempFile();
        await seed(file);
        await expect(open(file, ItemV2NoDefault)).rejects.toThrow(/NOT NULL/);
    });

    it("Adds NOT NULL columns with defaults to a table with existing rows via synchronize.", async () => {
        const file = tempFile();
        await seed(file);

        const ds = await open(file, ItemV2);
        try {
            const repo = ds.getRepository(ItemV2);
            const rows = await repo.find({ order: { uid: "ASC" } });
            expect(rows.map((r) => [r.uid, r.flag, r.code, Number(r.price)])).toEqual([
                ["a", false, "none", 0],
                ["b", false, "none", 0],
            ]);

            // Defaults also apply to new inserts that omit the column.
            await repo.insert({ uid: "c", name: "third" });
            expect((await repo.findOneByOrFail({ uid: "c" })).code).toBe("none");

            const metadata = ds.getMetadata(ItemV2);
            const code = metadata.findColumnWithPropertyName("code")!;
            expect(code.length).toBe("16");
            expect(code.isNullable).toBe(false);
            const price = metadata.findColumnWithPropertyName("price")!;
            expect(price.precision).toBe(10);
            expect(price.scale).toBe(2);

            // `unique` is enforced by the database.
            await repo.update({ uid: "a" }, { email: "x@example.com" });
            await expect(repo.update({ uid: "b" }, { email: "x@example.com" })).rejects.toThrow(/UNIQUE/);
        } finally {
            await ds.destroy();
        }
    });
});
