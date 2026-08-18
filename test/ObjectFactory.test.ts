///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { Logger } from "@rapidrest/core";
import config from "./config";
import { ObjectFactory } from "../src/ObjectFactory";
import { ConnectionManager } from "../src/database/ConnectionManager";
import { MongoConnection } from "../src/database/MongoConnection";
import { DataStore } from "../src/decorators/ModelDecorators";
import { Redis, Repository } from "../src/decorators/DatabaseDecorators";

describe("ObjectFactory Tests", () => {
    function makeFactoryWithConnections(connections: Record<string, any>): ObjectFactory {
        const objectFactory = new ObjectFactory(config, Logger());
        const connectionManager = new ConnectionManager();
        for (const [name, conn] of Object.entries(connections)) {
            connectionManager.connections.set(name, conn);
        }
        (objectFactory as any).instances.set("ConnectionManager:default", connectionManager);
        return objectFactory;
    }

    class NoDatastoreEntity {}

    @DataStore("missing-ds")
    class MissingConnEntity {}

    @DataStore("sql-ds")
    class SqlEntity {}

    @DataStore("mongo-ds")
    class MongoEntity {}

    @DataStore("wrong-type-ds")
    class WrongTypeEntity {}

    describe("TypeORM @Repository injection", () => {
        it("throws when the entity type has no datasource configured", async () => {
            class Target {
                @Repository(NoDatastoreEntity)
                public repo: any;
            }
            const objectFactory = makeFactoryWithConnections({});
            await expect(objectFactory.initialize(new Target())).rejects.toThrow(/must defined as an entity/);
        });

        it("throws when no connection is registered for the datasource", async () => {
            class Target {
                @Repository(MissingConnEntity)
                public repo: any;
            }
            const objectFactory = makeFactoryWithConnections({});
            await expect(objectFactory.initialize(new Target())).rejects.toThrow(
                /Unable to find database connection with name: missing-ds/,
            );
        });

        it("throws when the connection is neither Mongo nor a SQL DataSource", async () => {
            class Target {
                @Repository(WrongTypeEntity)
                public repo: any;
            }
            const objectFactory = makeFactoryWithConnections({ "wrong-type-ds": {} });
            await expect(objectFactory.initialize(new Target())).rejects.toThrow(
                /Unable to find database connection with name: wrong-type-ds/,
            );
        });

        it("assigns the repository when the connection is a SQL DataSource", async () => {
            const fakeRepo = { kind: "sql-repo" };
            const fakeDataSource = { getRepository: () => fakeRepo };
            class Target {
                @Repository(SqlEntity)
                public repo: any;
            }
            const objectFactory = makeFactoryWithConnections({ "sql-ds": fakeDataSource });
            const target = await objectFactory.initialize<Target>(new Target());
            expect(target.repo).toBe(fakeRepo);
        });

        it("silently skips injection when no connection is registered and required is 'false'", async () => {
            class Target {
                @Repository(SqlEntity, false)
                public redis: any;
            }
            const objectFactory = makeFactoryWithConnections({});
            const target = await objectFactory.initialize<Target>(new Target());
        });
    });

    describe("MongoDB @Repository injection", () => {
        it("throws when the entity type has no datasource configured", async () => {
            class Target {
                @Repository(NoDatastoreEntity)
                public repo: any;
            }
            const objectFactory = makeFactoryWithConnections({});
            await expect(objectFactory.initialize(new Target())).rejects.toThrow(/must defined as an entity/);
        });

        it("throws when no connection is registered for the datasource", async () => {
            class Target {
                @Repository(MissingConnEntity)
                public repo: any;
            }
            const objectFactory = makeFactoryWithConnections({});
            await expect(objectFactory.initialize(new Target())).rejects.toThrow(
                /Unable to find database connection with name: missing-ds/,
            );
        });

        it("throws when the connection is not a MongoDB datasource", async () => {
            class Target {
                @Repository(WrongTypeEntity)
                public repo: any;
            }
            const objectFactory = makeFactoryWithConnections({ "wrong-type-ds": {} });
            await expect(objectFactory.initialize(new Target())).rejects.toThrow(
                /Unable to find database connection with name: wrong-type-ds/,
            );
        });

        it("assigns the repository when the connection is a MongoConnection", async () => {
            const fakeRepo = { kind: "mongo-repo" };
            const fakeDb: any = { collection: () => ({}) };
            const conn = new MongoConnection("mongo-ds", {} as any, fakeDb, [MongoEntity]);
            (conn as any).getRepository = () => fakeRepo;
            class Target {
                @Repository(MongoEntity)
                public repo: any;
            }
            const objectFactory = makeFactoryWithConnections({ "mongo-ds": conn });
            const target = await objectFactory.initialize<Target>(new Target());
            expect(target.repo).toBe(fakeRepo);
        });

        it("silently skips injection when no connection is registered and required is 'false'", async () => {
            class Target {
                @Repository(MongoEntity, false)
                public redis: any;
            }
            const objectFactory = makeFactoryWithConnections({});
            const target = await objectFactory.initialize<Target>(new Target());
        });
    });

    describe("@Redis injection", () => {
        it("assigns a duplicate of the connection when duplicate() is available", async () => {
            const duplicated = { kind: "duplicate" };
            const fakeRedis = { duplicate: () => duplicated };
            class Target {
                @Redis("events")
                public redis: any;
            }
            const objectFactory = makeFactoryWithConnections({ events: fakeRedis });
            const target = await objectFactory.initialize<Target>(new Target());
            expect(target.redis).toBe(duplicated);
        });

        it("assigns the connection directly when duplicate() is not available", async () => {
            const fakeRedis = { kind: "no-duplicate" };
            class Target {
                @Redis("events")
                public redis: any;
            }
            const objectFactory = makeFactoryWithConnections({ events: fakeRedis });
            const target = await objectFactory.initialize<Target>(new Target());
            expect(target.redis).toBe(fakeRedis);
        });

        it("throws when no connection is registered and required is 'true'", async () => {
            class Target {
                @Redis("events")
                public redis: any;
            }
            const objectFactory = makeFactoryWithConnections({});
            await expect(objectFactory.initialize(new Target())).rejects.toThrow(
                /Unable to find database connection with name: events/,
            );
        });

        it("silently skips injection when no connection is registered and required is 'false'", async () => {
            class Target {
                @Redis("cache", false)
                public redis: any;
            }
            const objectFactory = makeFactoryWithConnections({});
            const target = await objectFactory.initialize<Target>(new Target());
            expect(target.redis).toBeUndefined();
        });
    });
});
