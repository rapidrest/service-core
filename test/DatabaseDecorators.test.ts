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
    TransactionalMode,
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
        // `@Transactional` resolves its connection via `this._objectFactory.getInstance(ConnectionManager)` -
        // the same `_objectFactory` reference every framework-managed object already carries (see core
        // ObjectFactory's `initialize()`), not a per-instance map that classes would otherwise need to
        // populate themselves. This fakes just enough of that DI surface for the decorator to resolve `conn`.
        function makeObjectFactory(connections: Record<string, any>): any {
            const connectionManager = { connections: new Map(Object.entries(connections)) };
            return { getInstance: vi.fn().mockReturnValue(connectionManager) };
        }

        function makeMongoConnection(session: any, supportsTransactions: boolean = true): MongoConnection {
            const conn: any = Object.create(MongoConnection.prototype);
            conn.startSession = vi.fn().mockReturnValue(session);
            conn.supportsTransactions = supportsTransactions;
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

        it("runs the method directly (no throw, no silent no-op) when there is no object factory to resolve a connection through", async () => {
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
                public _objectFactory = makeObjectFactory({});
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
                public _objectFactory = makeObjectFactory({ mongodb: { getRepository: vi.fn() } });
                @Transactional()
                public async doIt(): Promise<string> {
                    return "ran";
                }
            }
            await expect(new Foo().doIt()).resolves.toBe("ran");
        });

        it("runs the method directly, without starting a session, when the Mongo connection doesn't support transactions", async () => {
            // A standalone `mongod` (no replica set) doesn't support multi-document transactions at all —
            // ConnectionManager's detectMongoTransactionSupport() detects this at connection time and sets
            // `supportsTransactions: false`, which must stop @Transactional from ever calling startSession()
            // (which would just fail against a standalone deployment).
            const session = makeMongoSession();
            const conn = makeMongoConnection(session, false);

            class Foo {
                public modelClass = { datasource: "mongodb" };
                public _objectFactory = makeObjectFactory({ mongodb: conn });
                @Transactional()
                public async doIt(): Promise<string> {
                    return "ran";
                }
            }

            await expect(new Foo().doIt()).resolves.toBe("ran");
            expect((conn as any).startSession).not.toHaveBeenCalled();
        });

        it("wraps the call in a MongoDB session/transaction and makes it available via transactionContext", async () => {
            const session = makeMongoSession();
            const conn = makeMongoConnection(session);

            class Foo {
                public modelClass = { datasource: "mongodb" };
                public _objectFactory = makeObjectFactory({ mongodb: conn });
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
                public _objectFactory = makeObjectFactory({ mongodb: conn });
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
                public _objectFactory = makeObjectFactory({ mongodb: conn });
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
                public _objectFactory = makeObjectFactory({ mongodb: conn });
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
                public _objectFactory = makeObjectFactory({ mongodb: conn });
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
                public _objectFactory = makeObjectFactory({ sqlite: conn });
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
                public _objectFactory = makeObjectFactory({ sqlite: conn });
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
                public _objectFactory = makeObjectFactory({ mongodb: conn });
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
                public _objectFactory = makeObjectFactory({ mongodb: connA });

                @Transactional()
                public async doIt(delayMs: number): Promise<any> {
                    await new Promise((resolve) => setTimeout(resolve, delayMs));
                    return transactionContext.getStore();
                }
            }

            const foo: any = new Foo();
            // Call B starts second but resolves first, and swaps `_objectFactory` out from under call A to
            // prove the two calls' contexts are independent of shared instance state, not just of timing.
            const pA = foo.doIt(20);
            foo._objectFactory = makeObjectFactory({ mongodb: connB });
            const pB = foo.doIt(0);

            const [resultA, resultB] = await Promise.all([pA, pB]);
            expect(resultA?.session).toBe(sessionA);
            expect(resultB?.session).toBe(sessionB);
        });

        describe("nested calls (merge vs. create)", () => {
            it("merges into an existing MongoDB context by default instead of opening a second session", async () => {
                const session = makeMongoSession();
                const conn = makeMongoConnection(session);

                class Foo {
                    public modelClass = { datasource: "mongodb" };
                    public _objectFactory = makeObjectFactory({ mongodb: conn });

                    @Transactional()
                    public async outer(): Promise<any> {
                        return this.inner();
                    }

                    @Transactional()
                    public async inner(): Promise<any> {
                        return transactionContext.getStore();
                    }
                }

                const result = await new Foo().outer();

                expect((conn as any).startSession).toHaveBeenCalledTimes(1);
                expect(result?.session).toBe(session);
            });

            it("opens a second, independent session when the inner call specifies TransactionalMode.CREATE", async () => {
                const sessionA = makeMongoSession();
                const sessionB = makeMongoSession();
                const conn: any = Object.create(MongoConnection.prototype);
                conn.supportsTransactions = true;
                conn.startSession = vi.fn().mockReturnValueOnce(sessionA).mockReturnValueOnce(sessionB);

                class Foo {
                    public modelClass = { datasource: "mongodb" };
                    public _objectFactory = makeObjectFactory({ mongodb: conn });

                    @Transactional()
                    public async outer(): Promise<any> {
                        const outerSession = transactionContext.getStore()?.session;
                        const innerContext = await this.inner();
                        return { outerSession, innerSession: innerContext?.session };
                    }

                    @Transactional(undefined, { mode: TransactionalMode.CREATE })
                    public async inner(): Promise<any> {
                        return transactionContext.getStore();
                    }
                }

                const result = await new Foo().outer();

                expect(conn.startSession).toHaveBeenCalledTimes(2);
                expect(result.outerSession).toBe(sessionA);
                expect(result.innerSession).toBe(sessionB);
                expect(result.innerSession).not.toBe(result.outerSession);
            });

            it("injects the merged session into a @MongoSession-decorated argument on the inner call", async () => {
                const session = makeMongoSession();
                const conn = makeMongoConnection(session);

                class Foo {
                    public modelClass = { datasource: "mongodb" };
                    public _objectFactory = makeObjectFactory({ mongodb: conn });

                    @Transactional()
                    public async outer(): Promise<any> {
                        return this.inner();
                    }

                    @Transactional()
                    public async inner(@MongoSession() injected?: any): Promise<any> {
                        return injected;
                    }
                }

                await expect(new Foo().outer()).resolves.toBe(session);
            });

            it("merges into an existing SQL entityManager context by default instead of opening a second transaction", async () => {
                const entityManager = { save: vi.fn() };
                const conn = makeSqlConnection(entityManager);

                class Foo {
                    public modelClass = { datasource: "sqlite" };
                    public _objectFactory = makeObjectFactory({ sqlite: conn });

                    @Transactional()
                    public async outer(): Promise<any> {
                        return this.inner();
                    }

                    @Transactional()
                    public async inner(): Promise<any> {
                        return transactionContext.getStore();
                    }
                }

                const result = await new Foo().outer();

                expect(conn.transaction).toHaveBeenCalledTimes(1);
                expect(result?.entityManager).toBe(entityManager);
            });

            it("merges into the outer context even when the inner call's own datasource can't be resolved", async () => {
                // Mirrors ModelRoute methods calling into RepoUtils: the inner call's own datasource lookup may
                // miss, but it must still participate in whatever transaction the outer call already
                // established rather than silently running unscoped.
                const session = makeMongoSession();
                const conn = makeMongoConnection(session);

                class Foo {
                    public modelClass = { datasource: "mongodb" };
                    public _objectFactory = makeObjectFactory({ mongodb: conn });

                    @Transactional()
                    public async outer(): Promise<any> {
                        return this.inner();
                    }

                    @Transactional("unresolvable-datasource")
                    public async inner(): Promise<any> {
                        return transactionContext.getStore();
                    }
                }

                const result = await new Foo().outer();
                expect(result?.session).toBe(session);
            });

            it("rolls back both the outer and inner writes when the merged transaction fails", async () => {
                const session = makeMongoSession();
                const conn = makeMongoConnection(session);
                const innerWrite = vi.fn();

                class Foo {
                    public modelClass = { datasource: "mongodb" };
                    public _objectFactory = makeObjectFactory({ mongodb: conn });

                    @Transactional()
                    public async outer(): Promise<void> {
                        await this.inner();
                        throw new Error("boom");
                    }

                    @Transactional()
                    public async inner(): Promise<void> {
                        innerWrite();
                    }
                }

                await expect(new Foo().outer()).rejects.toThrow("boom");
                // Only one real session/transaction was ever opened - the inner write ran inside it, so its
                // rollback (via withTransaction's automatic abort) covers the inner write too.
                expect((conn as any).startSession).toHaveBeenCalledTimes(1);
                expect(innerWrite).toHaveBeenCalledTimes(1);
                expect(session.endSession).toHaveBeenCalledTimes(1);
            });
        });
    });
});
