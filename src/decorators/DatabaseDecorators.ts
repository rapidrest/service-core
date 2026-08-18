///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////

import { isSqlDataSource } from "../database/ConnectionKinds.js";
import { MongoConnection } from "../database/MongoConnection.js";

/**
 * Apply this to a property to have the datasource connection with the given name injected at instantiation.
 *
 * @param name The name of the datasource or class type.
 * @param required Set to `true` to indicate this injection must resolve, otherwise set to `false`. Default is `true`.
 */
export function DataSource(name: string, required: boolean = true) {
    return function (target: any, propertyKey: string | symbol) {
        Reflect.defineMetadata("rrst:injectDataSource", { name, required }, target, propertyKey);
        Object.defineProperty(target, propertyKey, {
            enumerable: true,
            writable: true,
            value: undefined,
        });
    };
}

/**
 * Injects the entity manager as the value of the decorated argument.
 *
 * @param name The name of the datasource or class type.
 */
export function EntityManager(nameOrType?: string | any) {
    return function (target: any, propertyKey: string, index: number) {
        const datasource: string = typeof nameOrType === "string" ? nameOrType : nameOrType.datasource;
        let args: any = Reflect.getMetadata("rrst:args", target, propertyKey);
        args[index] = ["entityManager", datasource];
        Reflect.defineMetadata("rrst:args", args, target, propertyKey);
    };
}

/**
 * Injects the MongoDB session (used by @Transactional) as the value of the decorated argument.
 */
export function MongoSession(nameOrType?: string | any) {
    return function (target: any, propertyKey: string, index: number) {
        const datasource: string = typeof nameOrType === "string" ? nameOrType : nameOrType.datasource;
        let args: any = Reflect.getMetadata("rrst:args", target, propertyKey);
        args[index] = ["mongoSession", datasource];
        Reflect.defineMetadata("rrst:args", args, target, propertyKey);
    };
}

/**
 * Apply this to a property to have the datasource repository for the given entity type injected at instantiation.
 *
 * @param {any} type The entity type whose repository will be injected.
 * @param required Set to `true` to indicate this injection must resolve, otherwise set to `false`. Default is `true`.
 */
export function Repository(type: any, required: boolean = true) {
    return function (target: any, propertyKey: string | symbol) {
        Reflect.defineMetadata("rrst:injectRepository", { type, required }, target, propertyKey);
        Object.defineProperty(target, propertyKey, {
            enumerable: true,
            writable: true,
            value: undefined,
        });
    };
}

/**
 * Apply this to a property to have the `Redis` connection with the given name injected at instantiation.
 *
 * @param {string} name The name of the datasource connection to inject.
 * @param required Set to `true` to indicate this injection must resolve, otherwise set to `false`. Default is `true`.
 */
export function Redis(name: string = "redis", required: boolean = true) {
    return DataSource(name, required);
}

/**
 * Apply this to perform all operations for the given datasource in a single transaction. The specified datasource can
 * be the name of a connection or the class type of a persistent data model.
 *
 * For MongoDB, this has the effect of creating a new session and wrapping the function call in
 * `session.withTransaction()`. Note that you must pass in the `session` to each `MongoRepository` function you wish
 * to use the transaction. The `session` will be automatically injected when one of the function arguments is decorated
 * with `@MongoSession`.
 *
 * For TypeORM, this has the effect of creating a new transaction and wrapping the function call in
 * `datasource.transaction()`. Note that you must use the provided `EntityManager` for all database actions. The
 * `entityManager` will be automatically injected when one of the function arguments is decorated with `@EntityManager`.
 *
 * Note: A `@Transactional` method *MUST* always return a promise (e.g. is async).
 *
 * @example
 * ```ts
 * class MyClass {
 *   // Note: You *must* declare an injected repository for you class
 *   @Repository(MongoModel)
 *   private myRepo: MongoRepository<MongoModel>;
 *
 *   @Transactional(MongoModel)
 *   public myFunc(obj: MongoModel, @MongoSession session) {
 *     await this.myRepo.save(obj, { session });
 *   }
 * }
 * ```
 * @example
 * ```ts
 * class MyClass {
 *   // Note: You *must* declare an injected repository for you class, even if you don't use it.
 *   @Repository(SQLModel)
 *   private myRepo: Repository<SQLModel>;
 *
 *   @Transactional(SQLModel)
 *   public myFunc(obj: SQLModel, @EntityManager em) {
 *     await em.save(obj);
 *   }
 * }
 * ```
 * @param datasource The name of the datasource or the class type that a transaction will be created for.
 * @param options The transcation options to pass to the underlying datasource connection.
 */
export function Transactional(source: string | any, options?: any) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const original: Function = descriptor.value;
        const argMetadata: any = Reflect.getMetadata("rrst:args", target, propertyKey);

        descriptor.value = async function (this: any, ...args: any[]) {
            if (!this._datasources) {
                throw new Error(
                    `${target.name} uses @Transactional (on ${propertyKey}) that has no active datasources.`,
                );
            }

            const datasource: string = typeof source === "string" ? source : source.datasource;
            const conn: any = this._datasources.get(datasource);
            if (!conn) {
                throw new Error(`${target.name} does not have an active datasource named: '${datasource}'`);
            }

            let result = undefined;

            if (conn instanceof MongoConnection) {
                // Implement transactions according to the MongoDB docs:
                // https://www.mongodb.com/docs/manual/core/transactions/?language-no-dependencies=nodejs
                const session = conn.startSession(options);
                try {
                    await session.withTransaction(async () => {
                        // Inject the session into the function arguments
                        let injected: boolean = false;
                        for (const key in argMetadata) {
                            const i: number = Number(key);
                            if (argMetadata[i][0] === "mongoSession") {
                                if (!argMetadata[i][1] || argMetadata[i][1] === datasource) {
                                    args[i] = session;
                                    injected = true;
                                    break;
                                }
                            }
                        }

                        if (!injected) {
                            throw new Error(
                                `Failed to inject session into function ${target.name}:${propertyKey}. Did you add an arg with @MongoSession() ?`,
                            );
                        }

                        result = await original.apply(this, args);
                    });
                } catch (err) {
                    await session.abortTransaction();
                } finally {
                    await session.endSession();
                }
            } else if (isSqlDataSource(conn) && typeof conn.transaction === "function") {
                // Implement transaction according to the TypeORM docs:
                // https://typeorm.io/docs/transactions/
                // TODO Use QueryRunner instead
                await conn.transaction(async (entityManager) => {
                    // Inject the entity manager into the function arguments+
                    let injected: boolean = false;
                    for (const key in argMetadata) {
                        const i: number = Number(key);
                        if (argMetadata[i][0] === "entityManager") {
                            if (!argMetadata[i][1] || argMetadata[i][1] === datasource) {
                                args[i] = entityManager;
                                injected = true;
                                break;
                            }
                        }
                    }

                    if (!injected) {
                        throw new Error(
                            `Failed to inject entity manager into function ${target.name}:${propertyKey}. Did you add an arg with @EntityManager() ?`,
                        );
                    }

                    result = await original.apply(this, args);
                });
            }

            return result;
        };

        return descriptor;
    };
}
