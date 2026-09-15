///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as uuid from "uuid";
import { ConnectionManager } from "../../src/database/ConnectionManager";
import { connect, release } from "../../src/database/TypeOrmSupport";
import { Column, Entity, PrimaryColumn } from "../../src/decorators/PersistenceDecorators";

@Entity({ name: "connect_first_entity" })
class ConnectFirstEntity {
    @PrimaryColumn()
    public uid: string = "";
}

@Entity({ name: "connect_second_entity" })
class ConnectSecondEntity {
    @PrimaryColumn()
    public uid: string = "";

    @Column()
    public name: string = "";
}

describe("TypeOrmSupport connect() Tests [SQL]", () => {
    const files: string[] = [];
    const tempFile = (): string => {
        const file = path.join(os.tmpdir(), `rrst-connect-${uuid.v4()}.sqlite`);
        files.push(file);
        return file;
    };
    const datasource = (file: string): any => ({ type: "better-sqlite3", database: file, synchronize: true });

    const manager = (): ConnectionManager => {
        const result: any = new ConnectionManager();
        result.logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
        return result;
    };

    afterAll(() => {
        for (const file of files) {
            fs.rmSync(file, { force: true });
        }
    });

    it("reuses a connection made with the same URL and entities", async () => {
        const file = tempFile();
        const name = `same-${uuid.v4()}`;
        const first = await connect(name, datasource(file), [ConnectFirstEntity], "");
        try {
            const second = await connect(name, datasource(file), [ConnectFirstEntity], "");
            expect(second).toBe(first);
        } finally {
            await first.destroy();
            release(name, first);
        }
    });

    it("creates a new connection when the entities differ, instead of reusing one without their metadata", async () => {
        const file = tempFile();
        const name = `entities-${uuid.v4()}`;
        const narrow = await connect(name, datasource(file), [ConnectFirstEntity], "");
        const wide = await connect(name, datasource(file), [ConnectFirstEntity, ConnectSecondEntity], "");
        try {
            expect(wide).not.toBe(narrow);
            expect(wide.hasMetadata(ConnectSecondEntity)).toBe(true);
            const tables = await wide.query("SELECT name FROM sqlite_master WHERE type = 'table'");
            expect(tables.map((t: any) => t.name)).toEqual(
                expect.arrayContaining(["connect_first_entity", "connect_second_entity"]),
            );
        } finally {
            await narrow.destroy();
            await wide.destroy();
            release(name, wide);
        }
    });

    it("creates a new connection when the URL differs", async () => {
        const file = tempFile();
        const name = `url-${uuid.v4()}`;
        const first = await connect(name, datasource(file), [ConnectFirstEntity], "");
        const second = await connect(name, datasource(file), [ConnectFirstEntity], "file:other");
        try {
            expect(second).not.toBe(first);
        } finally {
            await first.destroy();
            await second.destroy();
            release(name, second);
        }
    });

    it("creates a new connection after the cached one was destroyed", async () => {
        const file = tempFile();
        const name = `destroyed-${uuid.v4()}`;
        const first = await connect(name, datasource(file), [ConnectFirstEntity], "");
        await first.destroy();
        const second = await connect(name, datasource(file), [ConnectFirstEntity, ConnectSecondEntity], "");
        try {
            expect(second).not.toBe(first);
            expect(second.hasMetadata(ConnectSecondEntity)).toBe(true);
        } finally {
            await second.destroy();
            release(name, second);
        }
    });

    it("release() only forgets the connection it's given", async () => {
        const file = tempFile();
        const name = `release-${uuid.v4()}`;
        const first = await connect(name, datasource(file), [ConnectFirstEntity], "");
        try {
            release(name, {} as any);
            expect(await connect(name, datasource(file), [ConnectFirstEntity], "")).toBe(first);
            release(name, first);
            const second = await connect(name, datasource(file), [ConnectFirstEntity], "");
            expect(second).not.toBe(first);
            await second.destroy();
            release(name, second);
        } finally {
            await first.destroy();
        }
    });

    it("ConnectionManager.disconnect() releases its SQL connections so a later connect gets its own entities", async () => {
        const file = tempFile();
        const name = `manager-${uuid.v4()}`;
        const narrow = manager();
        await narrow.connect(
            { [name]: { ...datasource(file), host: "localhost", entities: ["ConnectFirstEntity"] } },
            new Map<string, any>([["ConnectFirstEntity", ConnectFirstEntity]]),
        );
        const narrowConnection: any = narrow.connections.get(name);
        await narrow.disconnect();

        const wide = manager();
        await wide.connect(
            {
                [name]: {
                    ...datasource(file),
                    host: "localhost",
                    entities: ["ConnectFirstEntity", "ConnectSecondEntity"],
                },
            },
            new Map<string, any>([
                ["ConnectFirstEntity", ConnectFirstEntity],
                ["ConnectSecondEntity", ConnectSecondEntity],
            ]),
        );
        const wideConnection: any = wide.connections.get(name);
        try {
            expect(wideConnection).not.toBe(narrowConnection);
            expect(wideConnection.hasMetadata(ConnectSecondEntity)).toBe(true);
        } finally {
            await wide.disconnect();
        }
    });
});
