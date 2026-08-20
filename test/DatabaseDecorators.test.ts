///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import {
    DataSource,
    EntityManager,
    MongoSession,
    Redis,
    Repository,
    Transactional,
    transactionContext,
} from "../src/decorators/DatabaseDecorators";
import { MongoConnection } from "../src/database/MongoConnection";

describe("DatabaseDecorators Tests", () => {
    it("@DataSource stores the connection name and default required flag as metadata and defines an undefined property", () => {
        class Foo {
            @DataSource("source")
            public source: any;
        }

        const metadata = Reflect.getMetadata("rrst:injectDataSource", Foo.prototype, "source");
        expect(metadata).toBeDefined();
        expect(metadata.name).toBe("source");
        expect(metadata.required).toBeTruthy();
        expect(new Foo().source).toBeUndefined();
    });
    it("@DataSource stores the connection name and required flag override as metadata and defines an undefined property", () => {
        class Foo {
            @DataSource("source", false)
            public source: any;
        }

        const metadata = Reflect.getMetadata("rrst:injectDataSource", Foo.prototype, "source");
        expect(metadata).toBeDefined();
        expect(metadata.name).toBe("source");
        expect(metadata.required).toBeFalsy();
        expect(new Foo().source).toBeUndefined();
    });

    it("@Repository stores the entity type and required flag as metadata and defines an undefined property", () => {
        class Foo {
            @Repository(String)
            public repo: any;
        }

        const metadata: any = Reflect.getMetadata("rrst:injectRepository", Foo.prototype, "repo");
        expect(metadata).toBeDefined();
        expect(metadata.required).toBeTruthy();
        expect(metadata.type).toBe(String);
        expect(new Foo().repo).toBeUndefined();
    });

    it("@Repository stores the entity type and required flag as metadata and defines an undefined property", () => {
        class Foo {
            @Repository(Number, false)
            public repo: any;
        }

        const metadata: any = Reflect.getMetadata("rrst:injectRepository", Foo.prototype, "repo");
        expect(metadata).toBeDefined();
        expect(metadata.required).toBeFalsy();
        expect(metadata.type).toBe(Number);
        expect(new Foo().repo).toBeUndefined();
    });

    it("@Redis stores the connection name and required flag as metadata and defines an undefined property", () => {
        class Foo {
            @Redis("cache")
            public redis: any;
        }

        const metadata = Reflect.getMetadata("rrst:injectDataSource", Foo.prototype, "redis");
        expect(metadata).toBeDefined();
        expect(metadata.name).toBe("cache");
        expect(metadata.required).toBeTruthy();
        expect(new Foo().redis).toBeUndefined();
    });

    it("@Redis stores the connection name and required flag override as metadata and defines an undefined property", () => {
        class Foo {
            @Redis("cache", false)
            public redis: any;
        }

        const metadata = Reflect.getMetadata("rrst:injectDataSource", Foo.prototype, "redis");
        expect(metadata).toBeDefined();
        expect(metadata.name).toBe("cache");
        expect(metadata.required).toBeFalsy();
        expect(new Foo().redis).toBeUndefined();
    });

    describe("@Transactional", () => {
        function makeMongoConnection(session: any): MongoConnection {
            const conn: any = Object.create(MongoConnection.prototype);
            conn.startSession = vi.fn().mockReturnValue(session);
            return conn as MongoConnection;
        }

        function makeMongoSession() {
            return {
                withTransaction: vi.fn(async (fn: () => Promise<any>) => fn()),
                endSession: vi.fn().mockResolvedValue(undefined),
            };
        }

        function makeSqlConnection(entityManager: any): any {
            return {
                getRepository: vi.fn(),
                transaction: vi.fn(async (fn: (em: any) => Promise<any>) => fn(entityManager)),
            };
        }

        it("runs the method directly (no throw, no silent no-op) when there are no active datasources", async () => {
            class Foo {
                public modelClass = { datasource: "mongodb" };
                @Transactional()
                public async doIt(): Promise<string> {
                    return "ran";
                }
            }
            await expect(new Foo().doIt()).resolves.toBe("ran");
        });

        it("runs the method directly when the resolved datasource has no active connection", async () => {
            class Foo {
                public modelClass = { datasource: "mongodb" };
                public _datasources = new Map();
                @Transactional()
                public async doIt(): Promise<string> {
                    return "ran";
                }
            }
            await expect(new Foo().doIt()).resolves.toBe("ran");
        });

        it("runs the method directly when the connection is neither Mongo nor a transactional SQL DataSource", async () => {
            class Foo {
                public modelClass = { datasource: "mongodb" };
                public _datasources = new Map([["mongodb", { getRepository: vi.fn() }]]);
                @Transactional()
                public async doIt(): Promise<string> {
                    return "ran";
                }
            }
            await expect(new Foo().doIt()).resolves.toBe("ran");
        });

        it("wraps the call in a MongoDB session/transaction and makes it available via transactionContext", async () => {
            const session = makeMongoSession();
            const conn = makeMongoConnection(session);

            class Foo {
                public modelClass = { datasource: "mongodb" };
                public _datasources = new Map([["mongodb", conn]]);
                @Transactional()
                public async doIt(): Promise<any> {
                    return transactionContext.getStore();
                }
            }

            const result = await new Foo().doIt();
            expect(result?.session).toBe(session);
            expect(session.withTransaction).toHaveBeenCalledTimes(1);
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });

        it("injects the MongoDB session into a @MongoSession-decorated argument", async () => {
            const session = makeMongoSession();
            const conn = makeMongoConnection(session);

            class Foo {
                public modelClass = { datasource: "mongodb" };
                public _datasources = new Map([["mongodb", conn]]);
                @Transactional()
                public async doIt(@MongoSession() injected?: any): Promise<any> {
                    return injected;
                }
            }

            await expect(new Foo().doIt()).resolves.toBe(session);
        });

        it("resolves the datasource from a plain string source", async () => {
            const session = makeMongoSession();
            const conn = makeMongoConnection(session);

            class Foo {
                public _datasources = new Map([["mongodb", conn]]);
                @Transactional("mongodb")
                public async doIt(): Promise<any> {
                    return transactionContext.getStore();
                }
            }

            const result = await new Foo().doIt();
            expect(result?.session).toBe(session);
        });

        it("does not inject the session into a @MongoSession(datasource) argument naming a different datasource", async () => {
            const session = makeMongoSession();
            const conn = makeMongoConnection(session);

            class Foo {
                public modelClass = { datasource: "mongodb" };
                public _datasources = new Map([["mongodb", conn]]);
                @Transactional()
                public async doIt(@MongoSession("other-datasource") injected?: any): Promise<any> {
                    return injected;
                }
            }

            await expect(new Foo().doIt()).resolves.toBeUndefined();
        });

        it("propagates (does not swallow) an error thrown inside a MongoDB transaction, and still ends the session", async () => {
            const session = makeMongoSession();
            const conn = makeMongoConnection(session);

            class Foo {
                public modelClass = { datasource: "mongodb" };
                public _datasources = new Map([["mongodb", conn]]);
                @Transactional()
                public async doIt(): Promise<void> {
                    throw new Error("boom");
                }
            }

            await expect(new Foo().doIt()).rejects.toThrow("boom");
            expect(session.endSession).toHaveBeenCalledTimes(1);
        });

        it("wraps the call in a SQL transaction and makes the entityManager available via transactionContext", async () => {
            const entityManager = { save: vi.fn() };
            const conn = makeSqlConnection(entityManager);

            class Foo {
                public modelClass = { datasource: "sqlite" };
                public _datasources = new Map([["sqlite", conn]]);
                @Transactional()
                public async doIt(): Promise<any> {
                    return transactionContext.getStore();
                }
            }

            const result = await new Foo().doIt();
            expect(result?.entityManager).toBe(entityManager);
            expect(conn.transaction).toHaveBeenCalledTimes(1);
        });

        it("injects the entityManager into an @EntityManager-decorated argument", async () => {
            const entityManager = { save: vi.fn() };
            const conn = makeSqlConnection(entityManager);

            class Foo {
                public modelClass = { datasource: "sqlite" };
                public _datasources = new Map([["sqlite", conn]]);
                @Transactional()
                public async doIt(@EntityManager() injected?: any): Promise<any> {
                    return injected;
                }
            }

            await expect(new Foo().doIt()).resolves.toBe(entityManager);
        });

        it("resolves the datasource by an explicit class-type source rather than this.modelClass", async () => {
            const session = makeMongoSession();
            const conn = makeMongoConnection(session);
            const SomeModel = { datasource: "mongodb" };

            class Foo {
                public modelClass = { datasource: "unrelated" };
                public _datasources = new Map([["mongodb", conn]]);
                @Transactional(SomeModel)
                public async doIt(): Promise<any> {
                    return transactionContext.getStore();
                }
            }

            const result = await new Foo().doIt();
            expect(result?.session).toBe(session);
        });

        it("does not leak transaction context between two concurrent calls sharing the same instance", async () => {
            // Regression test: @Transactional used to stash the session/entityManager on `this`, which is a
            // shared (often singleton) instance across concurrent requests. A second call starting before the
            // first finished would clobber the first's transaction context. AsyncLocalStorage scopes the
            // context to each call's own async chain instead, so concurrent calls must never see each other's.
            const sessionA = makeMongoSession();
            const sessionB = makeMongoSession();
            const connA = makeMongoConnection(sessionA);
            const connB = makeMongoConnection(sessionB);

            class Foo {
                public modelClass = { datasource: "mongodb" };
                public _datasources = new Map([["mongodb", connA]]);

                @Transactional()
                public async doIt(delayMs: number): Promise<any> {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    return transactionContext.getStore();
                }
            }

            const foo: any = new Foo();
            // Call B starts second but resolves first, and swaps `_datasources` out from under call A to
            // prove the two calls' contexts are independent of shared instance state, not just of timing.
            const pA = foo.doIt(20);
            foo._datasources = new Map([["mongodb", connB]]);
            const pB = foo.doIt(0);

            const [resultA, resultB] = await Promise.all([pA, pB]);
            expect(resultA?.session).toBe(sessionA);
            expect(resultB?.session).toBe(sessionB);
        });
    });
});
