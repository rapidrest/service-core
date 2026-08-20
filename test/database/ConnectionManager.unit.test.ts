///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// A synchronous factory (backed by a normal, statically-resolved import rather than a dynamic one inside the
// factory) avoids a race where ConnectionManager.connect() dynamically imports "redis" for two datastores
// concurrently (see connect() redis path below) before an async factory's own internal import has resolved.
import { createFakeRedisModule } from "../helpers/FakeRedis.js";
vi.mock("redis", () => createFakeRedisModule());

import "reflect-metadata";
import { ConnectionManager } from "../../src/database/ConnectionManager";
import { MongoConnection } from "../../src/database/MongoConnection";
import { RedisClient } from "redis";

function makeManager(): any {
    const manager: any = new ConnectionManager();
    manager.logger = { info: vi.fn(), debug: vi.fn(), error: vi.fn(), warn: vi.fn() };
    return manager;
}

describe("ConnectionManager Tests", () => {
    describe("importOptionalDependency", () => {
        it("throws a helpful error naming the missing package when the dynamic import fails", async () => {
            const manager = makeManager();
            await expect(
                manager.importOptionalDependency("this-package-does-not-exist-xyz", "mydb", "mongodb"),
            ).rejects.toThrow(
                "Datastore 'mydb' is of type 'mongodb' which requires the optional peer dependency 'this-package-does-not-exist-xyz'. Install it with: yarn add this-package-does-not-exist-xyz",
            );
        });

        it("resolves with the module when the package is actually installed", async () => {
            const manager = makeManager();
            const mod = await manager.importOptionalDependency("redis", "cache", "redis");
            expect(mod).toBeDefined();
        });
    });

    describe("buildConnectionUri", () => {
        it("uses the url verbatim when provided", () => {
            const manager = makeManager();
            expect(manager.buildConnectionUri({ url: "mongodb://custom/uri" })).toBe("mongodb://custom/uri");
        });

        it("throws when neither type nor host is configured and no url is given", () => {
            const manager = makeManager();
            expect(() => manager.buildConnectionUri({})).toThrow(/Invalid datasource config/);
        });

        it("builds a URI from discrete config fields, including credentials and options", () => {
            const manager = makeManager();
            const uri = manager.buildConnectionUri({
                type: "mongodb",
                host: "localhost",
                port: 27017,
                database: "mydb",
                username: "user",
                password: "pass",
                options: "retryWrites=true",
            });
            expect(uri).toBe("mongodb://user:pass@localhost:27017/mydb?retryWrites=true");
        });

        it("prefers an explicit protocol over the datasource type for the URI scheme", () => {
            const manager = makeManager();
            const uri = manager.buildConnectionUri({ type: "mongodb", protocol: "mongodb+srv", host: "localhost" });
            expect(uri).toBe("mongodb+srv://localhost");
        });
    });

    describe("connect() reconnect path", () => {
        it("reinitializes an existing SQL DataSource that is no longer initialized, instead of creating a new one", async () => {
            const manager = makeManager();
            const initialize = vi.fn().mockResolvedValue(undefined);
            const staleConnection: any = {
                isInitialized: false,
                initialize,
                // isSqlDataSource() duck-types on getRepository being a function -- see ConnectionKinds.ts
                getRepository: vi.fn(),
            };
            manager.connections.set("sqlite", staleConnection);

            await manager.connect({ sqlite: { type: "better-sqlite3", database: "test" } }, new Map());

            expect(initialize).toHaveBeenCalledTimes(1);
            expect(manager.connections.get("sqlite")).toBe(staleConnection);
        });
    });

    describe("detectMongoTransactionSupport", () => {
        function makeDb(helloResult: any): any {
            return { admin: () => ({ command: vi.fn().mockResolvedValue(helloResult) }) };
        }

        it("returns true and does not warn for a replica set (setName present)", async () => {
            const manager = makeManager();
            const supported = await manager.detectMongoTransactionSupport(makeDb({ setName: "rs0" }), "mongodb");
            expect(supported).toBe(true);
            expect(manager.logger.warn).not.toHaveBeenCalled();
        });

        it("returns true and does not warn for a sharded cluster (msg: isdbgrid)", async () => {
            const manager = makeManager();
            const supported = await manager.detectMongoTransactionSupport(makeDb({ msg: "isdbgrid" }), "mongodb");
            expect(supported).toBe(true);
            expect(manager.logger.warn).not.toHaveBeenCalled();
        });

        it("returns false and warns for a standalone deployment (neither setName nor isdbgrid)", async () => {
            const manager = makeManager();
            const supported = await manager.detectMongoTransactionSupport(makeDb({}), "mongodb");
            expect(supported).toBe(false);
            expect(manager.logger.warn).toHaveBeenCalledWith(
                expect.stringContaining("does not support multi-document"),
            );
        });

        it("returns false and warns when the hello command itself fails", async () => {
            const manager = makeManager();
            const db: any = { admin: () => ({ command: vi.fn().mockRejectedValue(new Error("boom")) }) };
            const supported = await manager.detectMongoTransactionSupport(db, "mongodb");
            expect(supported).toBe(false);
            expect(manager.logger.warn).toHaveBeenCalledWith(expect.stringContaining("boom"));
        });
    });

    describe("connect() redis path", () => {
        it("creates and connects a redis client for a 'redis' type datastore", async () => {
            const manager = makeManager();
            await manager.connect({ cache: { type: "redis", url: "redis://localhost:6379" } }, new Map());

            const conn: any = manager.connections.get("cache");
            expect(conn).toBeInstanceOf(RedisClient);
            expect(conn.isOpen).toBe(true);
        });
    });

    describe("connect() duplicate model registration", () => {
        it("throws when the same model class is claimed as an entity by two different datastores", async () => {
            const manager = makeManager();
            class MyModel {}
            const models = new Map<string, any>([["MyModel", MyModel]]);

            await expect(
                manager.connect(
                    {
                        ds1: { type: "better-sqlite3", database: ":memory:", host: "localhost", entities: ["MyModel"] },
                        ds2: { type: "better-sqlite3", database: ":memory:", host: "localhost", entities: ["MyModel"] },
                    },
                    models,
                ),
            ).rejects.toThrow("Model MyModel already defined as an entity for ds1");
        });
    });

    describe("disconnect()", () => {
        it("closes a connected MongoConnection and skips one that's already disconnected", async () => {
            const manager = makeManager();
            const connectedClose = vi.fn().mockResolvedValue(undefined);
            const connected: any = Object.create(MongoConnection.prototype);
            connected.connected = true; // isConnected is a read-only getter backed by this field
            connected.close = connectedClose;

            const disconnectedClose = vi.fn().mockResolvedValue(undefined);
            const disconnected: any = Object.create(MongoConnection.prototype);
            disconnected.connected = false;
            disconnected.close = disconnectedClose;

            manager.connections.set("a", connected);
            manager.connections.set("b", disconnected);

            await manager.disconnect();

            expect(connectedClose).toHaveBeenCalledTimes(1);
            expect(disconnectedClose).not.toHaveBeenCalled();
            expect(manager.connections.size).toBe(0);
        });

        it("disconnects a Redis client that is still open", async () => {
            const manager = makeManager();
            const redis: any = Object.create(RedisClient.prototype);
            // `isOpen` is a getter-only accessor on the real prototype, so it must be shadowed via
            // defineProperty rather than a plain assignment.
            Object.defineProperty(redis, "isOpen", { value: true, configurable: true });
            redis.disconnect = vi.fn().mockResolvedValue(undefined);
            manager.connections.set("cache", redis);

            await manager.disconnect();

            expect(redis.disconnect).toHaveBeenCalledTimes(1);
        });

        it("does not call disconnect() again on a Redis client that is already closed", async () => {
            const manager = makeManager();
            const redis: any = Object.create(RedisClient.prototype);
            Object.defineProperty(redis, "isOpen", { value: false, configurable: true });
            redis.disconnect = vi.fn().mockResolvedValue(undefined);
            manager.connections.set("cache", redis);

            await manager.disconnect();

            expect(redis.disconnect).not.toHaveBeenCalled();
        });

        it("destroys an initialized SQL DataSource and skips one that's not initialized", async () => {
            const manager = makeManager();
            const initializedDestroy = vi.fn().mockResolvedValue(undefined);
            const initialized: any = { getRepository: vi.fn(), isInitialized: true, destroy: initializedDestroy };

            const notInitializedDestroy = vi.fn().mockResolvedValue(undefined);
            const notInitialized: any = {
                getRepository: vi.fn(),
                isInitialized: false,
                destroy: notInitializedDestroy,
            };

            manager.connections.set("sqlA", initialized);
            manager.connections.set("sqlB", notInitialized);

            await manager.disconnect();

            expect(initializedDestroy).toHaveBeenCalledTimes(1);
            expect(notInitializedDestroy).not.toHaveBeenCalled();
        });

        it("skips a falsy connection entry without throwing", async () => {
            const manager = makeManager();
            manager.connections.set("broken", undefined);
            await expect(manager.disconnect()).resolves.toBeUndefined();
        });
    });
});
