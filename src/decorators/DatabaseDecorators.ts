///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////

import { AsyncLocalStorage } from "node:async_hooks";
import { ConnectionManager } from "../database/ConnectionManager.js";
import { isSqlDataSource } from "../database/ConnectionKinds.js";
import { MongoConnection } from "../database/MongoConnection.js";

/** The transactional context (`session` and/or `entityManager`) established by `@Transactional`, if any. */
export interface TransactionContext {
    session?: any;
    entityManager?: any;
}

/**
 * Carries the transactional context established by `@Transactional` through the async call chain of the
 * decorated method, keyed to that specific invocation rather than to the object instance the method runs on.
 */
export const transactionContext = new AsyncLocalStorage<TransactionContext>();

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
        const datasource: string | undefined = typeof nameOrType === "string" ? nameOrType : nameOrType?.datasource;
        // Falls back to a fresh object rather than assuming some other parameter decorator (e.g. `@Param`)
        // already initialized this metadata — a `@Transactional` method using only `@EntityManager` has no
        // such decorator, and indexing into `undefined` here would throw at class-definition time.
        const args: any = Reflect.getMetadata("rrst:args", target, propertyKey) ?? {};
        args[index] = ["entityManager", datasource];
        Reflect.defineMetadata("rrst:args", args, target, propertyKey);
    };
}

/**
 * Injects the MongoDB session (used by @Transactional) as the value of the decorated argument.
 */
export function MongoSession(nameOrType?: string | any) {
    return function (target: any, propertyKey: string, index: number) {
        const datasource: string | undefined = typeof nameOrType === "string" ? nameOrType : nameOrType?.datasource;
        const args: any = Reflect.getMetadata("rrst:args", target, propertyKey) ?? {};
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
 * Describes the opertaing mode for transaction support and how existing context should be
 * reconciled. When @Transactional is used multiple times in a single callstack, the
 * context can either be merged in a single transaction and nested.
 */
export enum TransactionalMode {
    /** Always creates a new transactional context for the current function. */
    CREATE,
    /** Merges existing transactional context instead of creating a new one. */
    MERGE,
}

export interface TransactionalOptions {
    /** The merge mode to apply when multiple transactions are declared in the same call stack. */
    mode: TransactionalMode;
    /** The set of options to pass to the underlying datastore driver. */
    driverOptions?: any;
}

/**
 * Apply this to perform all operations in a single transaction. The specified `source` can
 * be the name of a connection or the class type of a persistent data model. If no `source` is specified it is inferred
 * by lookup via `this.modelClass` which is injected when `@Model` is added to a class.
 *
 * For MongoDB, this has the effect of creating a new session and wrapping the function call in
 * `session.withTransaction()`. Note that you must pass in the `session` to each `MongoRepository` function you wish
 * to use the transaction. The `session` is automatically made available for the duration of the call via
 * `transactionContext` (an `AsyncLocalStorage` that is scoped to this call). Optionally, it can also be injected to a
 * function argument that is decorated with `@MongoSession`.
 *
 * For TypeORM, this has the effect of creating a new transaction and wrapping the function call in
 * `datasource.transaction()`. Note that you must use the provided `EntityManager` for all database actions. The
 * `entityManager` is automatically made available for the duration of the call via `transactionContext`. Optionally,
 * it can be injected to a function argument that is decorated with `@EntityManager`.
 *
 * If `@Transactional` was already in effect earlier in the current call stack (e.g. a `RepoUtils` method called
 * from a `ModelRoute` method that's also `@Transactional`), the existing transaction is reused by default rather
 * than opening a second, nested one. See `TransactionalOptions.mode`.
 *
 * Note: A `@Transactional` method *MUST* always return a promise (e.g. is async).
 *
 * @example
 * ```ts
 * @Model(MongoModel)
 * class MyClass {
 *   @Repository(MongoModel)
 *   private myRepo: MongoRepository<MongoModel>;
 *
 *   @Transactional()
 *   public myFunc(obj: MongoModel, @MongoSession() session) {
 *     await this.myRepo.save(obj, { session });
 *   }
 * }
 * ```
 * @example
 * ```ts
 * class MyClass {
 *   @Repository(MongoModel)
 *   private myRepo: MongoRepository<MongoModel>;
 *
 *   @Repository(MongoModel2)
 *   private myRepo2: MongoRepository<MongoModel2>;
 *
 *   @Transactional(MongoModel)
 *   public myFunc(obj: MongoModel, @MongoSession() session) {
 *     await this.myRepo.save(obj, { session });
 *   }
 * }
 * ```
 * @example
 * ```ts
 * class MyClass {
 *   @Repository(SQLModel)
 *   private myRepo: Repository<SQLModel>;
 *
 *   @Transactional(SQLModel)
 *   public myFunc(obj: SQLModel, @EntityManager() em) {
 *     await em.save(obj);
 *   }
 * }
 * ```
 * @param source The name of the datasource or the class type that a transaction will be created for. If none specified,
 * the source is inferred using `this.modelClass`.
 * @param options The transcation options to pass to the underlying datasource connection.
 */
export function Transactional(source?: string | any, options?: TransactionalOptions) {
    return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const original: Function = descriptor.value;
        const argMetadata: any = Reflect.getMetadata("rrst:args", target, propertyKey);

        descriptor.value = async function (this: any, ...args: any[]) {
            // Resolved into a local rather than reassigning the closed-over `source` param, which is shared by
            // every invocation of this decorated method across every instance it's ever called on.
            const resolvedSource: string | any = source ?? this.modelClass;
            const datasource: string | undefined =
                typeof resolvedSource === "string" ? resolvedSource : resolvedSource?.datasource;
            // Resolve the datasource directly from the ConnectionManager using `this._objectFactory`
            // which ObjectFactory always injects into every object it manages.
            const connectionManager: ConnectionManager | undefined =
                this._objectFactory?.getInstance(ConnectionManager);
            const conn: any = datasource ? connectionManager?.connections.get(datasource) : undefined;

            // Check if the connection supports transactions. If it doesn't we will fallback to the default
            // (non-transactional) behavior. A log message warns the developer at startup about the missing
            // transaction support.
            const canUseMongoTransaction: boolean = conn instanceof MongoConnection && conn.supportsTransactions;
            const canUseSqlTransaction: boolean = isSqlDataSource(conn) && typeof conn.transaction === "function";
            if (!canUseMongoTransaction && !canUseSqlTransaction) {
                return await original.apply(this, args);
            }

            // Injects the active session/entityManager into any @MongoSession/@EntityManager-decorated argument
            // whose named datasource (if any) matches the one this call resolved above. Note that `ctx` is not
            // re-verified against `datasource` when it was inherited from an outer call (the merge case below).
            // An outer @Transactional for a *different* datasource being merged into is a caller error, and the
            // resulting session/entityManager mismatch will surface loudly via the driver rather than silently.
            const injectContextArgs = (ctx: TransactionContext) => {
                for (const key in argMetadata) {
                    const i: number = Number(key);
                    const [kind, argDatasource] = argMetadata[i];
                    if (argDatasource && argDatasource !== datasource) {
                        continue;
                    }
                    if (kind === "mongoSession" && ctx.session !== undefined) {
                        args[i] = ctx.session;
                    } else if (kind === "entityManager" && ctx.entityManager !== undefined) {
                        args[i] = ctx.entityManager;
                    }
                }
            };

            // Also check if @Transactional was already used earlier in the call stack. By default (i.e. when
            // `options.mode` is omitted, or explicitly TransactionalMode.MERGE) that existing context is reused
            // instead of opening a second, nested transaction of its own. Pass `{ mode: TransactionalMode.CREATE }`
            // to always start a fresh transaction regardless of any outer one.
            const existingContext: TransactionContext | undefined = transactionContext.getStore();
            if (existingContext !== undefined && options?.mode !== TransactionalMode.CREATE) {
                injectContextArgs(existingContext);
                return await original.apply(this, args);
            }

            let result = undefined;

            if (canUseMongoTransaction) {
                // Implement transactions according to the MongoDB docs:
                // https://www.mongodb.com/docs/manual/core/transactions/?language-no-dependencies=nodejs
                const session = conn.startSession(options?.driverOptions);
                try {
                    // `withTransaction()` already aborts the transaction automatically if the callback throws
                    // or its returned promise rejects, so no explicit `abortTransaction()` call is needed here
                    // — and the error must be allowed to propagate to the caller rather than being swallowed.
                    await session.withTransaction(async () => {
                        injectContextArgs({ session });

                        // Scope the session to this call's async context (see `transactionContext`) rather than
                        // stashing it on `this`, which may be a singleton shared with concurrent, unrelated calls.
                        result = await transactionContext.run({ session }, () => original.apply(this, args));
                    });
                } finally {
                    await session.endSession();
                }
            } else {
                // Implement transaction according to the TypeORM docs:
                // https://typeorm.io/docs/transactions/
                // TODO Use QueryRunner instead
                await conn.transaction(async (entityManager) => {
                    injectContextArgs({ entityManager });

                    // Scope the entityManager to this call's async context (see `transactionContext`) rather than
                    // stashing it on `this`, which may be a singleton shared with concurrent, unrelated calls.
                    result = await transactionContext.run({ entityManager }, () => original.apply(this, args));
                });
            }

            return result;
        };

        // A plain `descriptor.value = async function (...) {}` assignment doesn't trigger JS's function-name
        // inference (that only applies to identifier/object-literal-property assignment, not this kind of
        // member expression), so the wrapper would otherwise have `.name === ""`. That breaks
        // `RouteUtils.wrapMiddleware`, which looks up @Param/@Query/@User/etc. argument metadata via
        // `Reflect.getMetadata("rrst:args", proto, func.name)` — losing the name silently drops every HTTP
        // route handler's arguments the moment it's also decorated with `@Transactional`.
        Object.defineProperty(descriptor.value, "name", { value: propertyKey, configurable: true });

        return descriptor;
    };
}
