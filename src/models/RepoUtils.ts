///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
////////////////////////////////////////////////////////////////////////////////
import * as crypto from "crypto";
import type { EntityManager, Repository } from "typeorm";
import { MongoRepository } from "../database/MongoRepository.js";
import { MongoConnection } from "../database/MongoConnection.js";
import { isSqlDataSource } from "../database/ConnectionKinds.js";
import { resolveCollectionName } from "../database/NamingUtils.js";
import { ModelUtils } from "../models/ModelUtils.js";
import { BaseEntity } from "../models/BaseEntity.js";
import { SimpleEntity } from "../models/SimpleEntity.js";
import { BaseMongoEntity } from "../models/BaseMongoEntity.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import { ApiError, ObjectDecorators, ObjectUtils, UserUtils, type JWTUser } from "@rapidrest/core";
import { ObjectFactory } from "../ObjectFactory.js";
import { NotificationUtils } from "../NotificationUtils.js";
import { RecoverableBaseEntity } from "./RecoverableBaseEntity.js";
import { ACLAction, type AccessControlList } from "../security/index.js";
import type { ACLUtils } from "../security/ACLUtils.js";
import { ConnectionManager, RedisCache } from "../database/index.js";
import { registerRollbackHook, Transactional, transactionContext } from "../decorators/DatabaseDecorators.js";
import { getColumnMetadata } from "../decorators/PersistenceDecorators.js";
import type { ClientSession } from "mongodb";
const { Config, Init, Inject, Logger } = ObjectDecorators;

const _hashCache = new Map();

/** The actions `RepoUtils.create()` grants a record's creator on a freshly created per-record ACL. */
const CREATOR_ACTIONS: string[] = [
    ACLAction.COUNT,
    ACLAction.CREATE,
    ACLAction.DELETE,
    ACLAction.EXISTS,
    ACLAction.READ,
    ACLAction.LIST,
    ACLAction.TRUNCATE,
    ACLAction.UPDATE,
];

/** The explicit `@Column({ type })` values that store a date/time (compared lower-cased). */
const DATE_COLUMN_TYPES: Set<string> = new Set([
    "date",
    "datetime",
    "datetime2",
    "datetimeoffset",
    "smalldatetime",
    "timestamp",
    "timestamptz",
    "timestamp with time zone",
    "timestamp without time zone",
    "timestamp with local time zone",
]);

export interface TransactionInfo {
    entityManager?: EntityManager;
    session?: ClientSession;
}

/**
 * The available options used for `RepoUtils` operations.
 */
export interface RepoOperationOptions {
    /** Set to `true` to ignore the ACL permissions check. */
    ignoreACL?: boolean;
    /** An additional list of channel names to send push notifications to. */
    pushChannels?: string[];
    /** Indicates if a telemetry event should be broadcast for the request. */
    recordEvent?: boolean;
    /** Set to `true` to not send a push notification. */
    skipPush?: boolean;
    /** The transactional session to execute the operation within. */
    transaction?: TransactionInfo;
    /** The authenticated user making the request. */
    user?: JWTUser;
}

/**
 * The available options for the `RepoUtils.create()` operation.
 */
export interface RepoCreateOptions extends RepoOperationOptions {
    /** The AccessControlList to use when creating a new object. */
    acl?: AccessControlList;
    /**
     * Set to `true` to let a record-level-ACL create adopt an ACL that already exists at the new record's uid even
     * though no record of this model exists there yet and the caller doesn't already hold every creator right on
     * it. The existing ACL is used as-is (the creator is not added to it). Defaults to `false`, in which case such
     * a create is refused with `IDENTIFIER_EXISTS` - see `create()`.
     *
     * For trusted server-side code only (e.g. code that deliberately saves a record's ACL before the record
     * itself) - this must never be derived from a client request.
     */
    allowExistingACL?: boolean;
    /**
     * Set to `true` to keep the `_id` carried by the object being created instead of discarding it. The object is
     * still always inserted, never merged into an existing document: a create whose `_id` is already taken fails
     * with `IDENTIFIER_EXISTS`. Defaults to `false`.
     *
     * For trusted server-side code only (e.g. restoring or migrating documents with their original `_id`) - this
     * must never be derived from a client request.
     */
    preserveId?: boolean;
}

/**
 * The available options for the `RepoUtils.delete()` operation.
 */
export interface RepoDeleteOptions extends RepoOperationOptions {
    /** Set to true to permanently remove the object from the database (if applicable). */
    purge?: boolean;
    /** The desired version number of the resource to delete. */
    version?: number | string;
}

export interface RepoFindOptions extends RepoOperationOptions {
    /**
     * Overrides the `ACLAction` checked for this operation instead of its usual default (`COUNT` for `count()`,
     * `LIST` for `find()`, `READ` for `findOne()`). Used by callers layering a different operation on top of one
     * of these (e.g. `exists()` checking `ACLAction.EXISTS` instead of `COUNT` when reusing `count()`).
     */
    action?: string;
    /**
     * Set to `true` to include soft-deleted `RecoverableBaseEntity` rows/documents that would otherwise be
     * excluded by default. Has no effect for a non-recoverable model class.
     */
    includeDeleted?: boolean;
    /** The total number of resources to retrieve. */
    limit?: number;
    /** The page number of the paginated results to retrieve. */
    page?: number;
    /** Set to `true` to skip retrieval from the cache. Default is `false`. */
    skipCache?: boolean;
    /** The desired version number of the resources to retrieve. */
    version?: number | string;
}

/**
 * The available options for the `RepoUtils.update()` operation.
 */
export interface RepoUpdateOptions<T extends BaseEntity | SimpleEntity> extends RepoOperationOptions {
    /** The desired version number of the resource to update. */
    version?: number | string;
    /**
     * Set to `true` to let this update actually write `@ReadOnly` fields instead of unconditionally
     * resetting them back to their existing persisted value. Defaults to `false` (the field is protected),
     * matching this method's behavior prior to this option's introduction.
     *
     * For trusted server-side code only - this must never be derived from a client request. It exists for
     * a caller that legitimately owns a `@ReadOnly` field's lifecycle outside the ordinary create/update
     * path (e.g. a background job or route handler computing and persisting a system-managed value), where
     * the alternative would be bypassing `RepoUtils.update()` entirely (losing its ACL/optimistic-locking/
     * transaction handling) just to change that one field.
     */
    allowReadOnly?: boolean;
}

/**
 * @author Jean-Philippe Steinmetz
 */
export class RepoUtils<T extends BaseEntity | SimpleEntity> {
    // Automatically injected by ObjectFactory on instantiation
    protected _objectFactory?: ObjectFactory;

    @Inject("ACLUtils")
    protected aclUtils?: ACLUtils;

    /** The store that will be used as a 2nd level cache for all cacheable models. */
    protected cache?: RedisCache<T>;

    @Config()
    protected config: any;

    @Inject(ConnectionManager)
    protected connectionManager?: ConnectionManager;

    /** The unique identifier of the default ACL for the model type. */
    public defaultACLUid: string = "";

    @Logger
    protected logger: any;

    protected modelClass: any;

    @Inject(NotificationUtils)
    protected notificationUtils?: NotificationUtils;

    /** The model class associated with the controller to perform operations against. */
    public repo?: Repository<T> | MongoRepository<T>;

    @Config("trusted_roles", ["admin"])
    protected trustedRoles: string[] = ["admin"];

    constructor(modelClass: any, repo?: Repository<T> | MongoRepository<T>) {
        this.modelClass = modelClass;
        this.repo = repo;
    }

    @Init
    protected async init() {
        // Retrieve the repository based on the modelClass that was passed in to the constructor
        if (!this.repo) {
            if (!this.modelClass.datasource) {
                throw new Error(
                    `Cannot initialize RepoUtils. Did you forget to add @DataStore() to ${this.modelClass.name}?`,
                );
            }

            if (!this.connectionManager) {
                throw new Error("Cannot initialize RepoUtils. Failed to retrieve ConnectionManager.");
            }

            const ds: any = this.connectionManager.connections.get(this.modelClass.datasource);
            if (!ds) {
                throw new Error(
                    `Cannot initialize RepoUtils. No connection found for datasource '${this.modelClass.datasource}'`,
                );
            }

            this.repo = ds.getRepository(this.modelClass);
        }

        // Create the cache store if caching is enabled for this entity type
        if (!this.cache && this.modelClass.cacheTTL) {
            this.cache = await this._objectFactory?.newInstance(RedisCache, {
                name: this.modelClass.fqn ?? this.modelClass.name,
                args: [this.modelClass],
            });
        }

        if (!this.repo) {
            throw new Error(`Cannot initialize RepoUtils. No repository found for class ${this.modelClass.name}.`);
        }

        if (this.aclUtils?.enabled) {
            let defaultAcl: AccessControlList | undefined = this.getDefaultACL();
            if (defaultAcl) {
                this.defaultACLUid = defaultAcl.uid;
                await this.aclUtils?.saveDefaultACL(defaultAcl);
            }
        }

        // Does the model specify a MongoDB shard configuration?
        const shardConfig: any = Reflect.getMetadata("rrst:shardConfig", this.modelClass);
        if (shardConfig && this.repo instanceof MongoRepository) {
            const conn = this.connectionManager?.connections.get(this.modelClass.datasource) as
                | MongoConnection
                | undefined;
            const admin = conn?.admin();
            if (admin) {
                const collectionName: string = resolveCollectionName(this.modelClass);
                const dbName: string = this.config.get(`datastores:${this.modelClass.datasource}:database`);
                try {
                    this.logger.info(
                        `Configuring sharding for: collection=${dbName}.${collectionName}, key=${JSON.stringify(shardConfig.key)}, unique=${shardConfig.unique}, options=${JSON.stringify(shardConfig.options)})`,
                    );
                    const result: any = await admin.command({
                        shardCollection: `${dbName}.${collectionName}`,
                        key: shardConfig.key,
                        unique: shardConfig.unique,
                        ...shardConfig.options,
                    });
                    this.logger.debug(`Result: ${JSON.stringify(result)}`);
                } catch (e: any) {
                    this.logger.warn(
                        `There was a problem trying to configure MongoDB sharding for collection '${collectionName}'. Error=${e.message}`,
                    );
                }
            } else {
                this.logger.debug("Failed to get mongodb admin interface or sharding not supported.");
            }
        }
    }

    /**
     * Retrieves every uid matching the given (already-built) search query, ignoring any pagination `take`/`page`
     * baked into it by `ModelUtils.buildSearchQuery`. Used by `count`/`exists`/`truncate`, which must narrow by
     * record-level ACLs against the *entire* matching set rather than a single page of it — applying the default
     * `take` here would silently undercount, under-check existence for, or under-delete a large result set.
     */
    private async findAllUids(searchQuery: any, options?: RepoFindOptions): Promise<string[]> {
        const txInfo: TransactionInfo | undefined = this.getTransaction(options);

        if (this.repo instanceof MongoRepository) {
            if (Array.isArray(searchQuery)) {
                return await this.repo.distinct("uid", searchQuery[0].$match, { session: txInfo?.session });
            }
            return await this.repo.distinct("uid", searchQuery["$match"] ? searchQuery["$match"] : searchQuery, {
                session: txInfo?.session,
            });
        }

        // Only the uid column is needed, and pagination must not clip the result set here.
        const uidQuery: any = { ...searchQuery, select: { uid: true } };
        delete uidQuery.take;
        delete uidQuery.page;
        const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
        const rows: T[] = (await repo!.find(uidQuery)) as T[];
        return rows.map((obj: T) => obj.uid);
    }

    /**
     * Filters the given uids down to those the user has `action` permission for, checking in bounded-size
     * batches rather than a single unbounded `Promise.all` so a large matching set can't fire an unbounded
     * number of concurrent permission-check round trips at once.
     */
    private async filterPermittedUids(uids: string[], action: string, options?: RepoFindOptions): Promise<string[]> {
        const batchSize = 100;
        const permitted: string[] = [];
        for (let i = 0; i < uids.length; i += batchSize) {
            const batch: string[] = uids.slice(i, i + batchSize);
            const results: boolean[] = await Promise.all(
                batch.map((uid) => this.aclUtils!.hasPermission(options?.user, uid, action)),
            );
            for (let j = 0; j < batch.length; j++) {
                if (results[j]) {
                    permitted.push(batch[j]);
                }
            }
        }
        return permitted;
    }

    public async count(query: any, options?: RepoFindOptions): Promise<number> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        let count: number = 0;
        const action: string = options?.action ?? ACLAction.COUNT;
        const txInfo: TransactionInfo | undefined = this.getTransaction(options);

        // Check user permissions against the class-level ACL. This is a fast-fail gate for users with no
        // legitimate access to the resource type at all; per-record narrowing (below) is an additional layer
        // on top of this, not a replacement for it.
        if (this.aclUtils?.enabled && !options?.ignoreACL) {
            if (!(await this.aclUtils.hasPermission(options?.user, this.defaultACLUid, action))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        // A client-supplied `?deleted=true` filter overrides `buildSearchQuery()`'s default exclusion of
        // soft-deleted rows. Counting a matched soft-deleted row requires the DELETE+UPDATE permissions.
        const clientRequestsDeleted: boolean = query?.deleted === true || query?.deleted === "true";
        const recordACL: boolean = !!this.modelClass.recordACL;
        let effectiveQuery: any = query;
        if (clientRequestsDeleted && this.aclUtils?.enabled && !options?.ignoreACL && !recordACL) {
            if (!(await this.canViewDeleted(options?.user, this.defaultACLUid))) {
                effectiveQuery = { ...query };
                delete effectiveQuery.deleted;
            }
        }

        const searchQuery: any = ModelUtils.buildSearchQuery(
            this.modelClass,
            this.repo,
            effectiveQuery,
            true,
            options?.user,
        );

        // `buildSearchQuery()` auto-excludes soft-deleted rows for a RecoverableBaseEntity by default. We strip
        // that out of the query rather than trying to influence the exclusion via the input `query` object.
        if (options?.includeDeleted) {
            if (Array.isArray(searchQuery)) {
                delete searchQuery[0]?.$match?.deleted;
            } else if (searchQuery?.$match) {
                delete searchQuery.$match.deleted;
            } else if (Array.isArray(searchQuery?.where)) {
                for (const w of searchQuery.where) {
                    delete w.deleted;
                }
            }
        }

        // Record-level ACLs aren't reflected in the query itself, so the matched uids must be checked
        // individually and counted rather than delegating the count to the database.
        if (this.aclUtils?.enabled && !options?.ignoreACL && recordACL) {
            const uids: string[] = await this.findAllUids(searchQuery, options);
            let permitted: string[];
            if (clientRequestsDeleted) {
                // Every uid this query matched is, by construction, a soft-deleted record - check the restore
                // bar per-record rather than the ordinary `action`.
                const deleteOk: Set<string> = new Set(await this.filterPermittedUids(uids, ACLAction.DELETE, options));
                const updateOk: string[] = await this.filterPermittedUids(uids, ACLAction.UPDATE, options);
                permitted = updateOk.filter((uid) => deleteOk.has(uid));
            } else {
                permitted = await this.filterPermittedUids(uids, action, options);
            }
            return permitted.length;
        }

        if (this.repo instanceof MongoRepository) {
            if (Array.isArray(searchQuery)) {
                searchQuery.push({ $count: "count" });
                const result: any = await this.repo.aggregate(searchQuery, { session: txInfo?.session }).next();
                count = result ? result.count : count;
            } else {
                const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
                count = await repo.count(searchQuery["$match"] ? searchQuery["$match"] : searchQuery, {
                    session: txInfo?.session,
                });
            }
        } else {
            const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
            count = await repo.count(searchQuery);
        }

        return count;
    }

    /**
     * Determines whether an object with the given unique identifier (and, optionally, a specific version) exists
     * in the datasource. Respects record-level ACLs the same way `count()` does.
     *
     * @param id The unique identifier of the object to check for.
     * @param options The additional options to consider, such as `version` and the requesting `user`.
     */
    public async exists(id: string, options?: RepoFindOptions): Promise<number> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const action: string = options?.action ?? ACLAction.EXISTS;

        // Check user permissions against the class-level ACL. This is a fast-fail gate for users with no
        // legitimate access to the resource type at all; per-record narrowing (below) is an additional layer
        // on top of this, not a replacement for it.
        if (this.aclUtils?.enabled && !options?.ignoreACL) {
            if (!(await this.aclUtils.hasPermission(options?.user, this.defaultACLUid, action))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        // Ordinary (live-record) existence check, respecting `action`/record-level ACLs exactly as before.
        let count: number = await this.existsQuery(id, options, false, action);

        // A soft-deleted record only counts as "existing" for a caller with both DELETE and UPDATE permission.
        if (count === 0 && options?.includeDeleted) {
            let canRestore: boolean = true;
            if (this.aclUtils?.enabled && !options?.ignoreACL) {
                const restoreAclUid: string = this.modelClass.recordACL ? id : this.defaultACLUid;
                canRestore = await this.canViewDeleted(options?.user, restoreAclUid);
            }
            if (canRestore) {
                // Permission for the deleted record was already established above, so this pass runs as a raw
                // existence check rather than re-deriving/re-checking `action` (which the record's ACL may not
                // grant even to someone who can restore it).
                count = await this.existsQuery(id, options, true, null);
            }
        }

        return count;
    }

    /**
     * Runs the actual existence check/count for `exists()`, deduped by uid and clamped to at most 1. Split out
     * so `exists()` can run it twice — once for a live record, once (gated on DELETE+UPDATE permission) for a
     * soft-deleted one — without duplicating the Mongo/SQL/record-ACL branching.
     *
     * @param id The unique identifier of the object to check for.
     * @param options The additional options to consider, such as `version`.
     * @param includeDeleted Whether to match a soft-deleted record.
     * @param enforceAction The ACL action to check per matched record on a `recordACL` model, or `null` to skip
     * that check (used for the second, already-authorized `includeDeleted` pass).
     */
    private async existsQuery(
        id: string,
        options: RepoFindOptions | undefined,
        includeDeleted: boolean,
        enforceAction: string | null,
    ): Promise<number> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const txInfo: TransactionInfo | undefined = this.getTransaction(options);

        // Without an explicit version, `query` matches every historical row sharing this uid on a trackChanges
        // entity - existence is still a yes/no question about the uid itself, so results are deduped by uid and
        // the final count clamped to at most 1, rather than reporting the number of matching version rows.
        const query: any = this.searchIdQuery(id, options?.version, includeDeleted);

        // Record-level ACLs aren't reflected in the query itself, so the matched uids must be checked
        // individually and counted rather than delegating the count to the database.
        if (enforceAction && this.aclUtils?.enabled && !options?.ignoreACL && this.modelClass.recordACL) {
            const uids: string[] = await this.findAllUids(query);
            const permitted: string[] = await this.filterPermittedUids(uids, enforceAction, options);
            return permitted.length > 0 ? 1 : 0;
        }

        let count: number;
        if (this.repo instanceof MongoRepository) {
            count = await this.repo.count(query, { session: txInfo?.session });
        } else {
            const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
            count = await repo.count(query);
        }

        return Math.min(count, 1);
    }

    /**
     * Stores a new record of the provided object in the datasource. Performs pre-processing, permission checks against
     * the class ACL, cache seeding, telemetry recording and push notifications.
     *
     * @param obj The object to store.
     * @param acl The ACL to use
     */
    @Transactional()
    public async create(obj: Partial<T>, options?: RepoCreateOptions): Promise<T> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const txInfo: TransactionInfo | undefined = this.getTransaction(options);

        // Verify the user's permission to create objects
        if (
            this.aclUtils?.enabled &&
            !options?.ignoreACL &&
            !(await this.aclUtils.hasPermission(options?.user, this.defaultACLUid, ACLAction.CREATE))
        ) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        // Instantiate the object if not already done
        const clazz: any = this.getClassType(obj);
        const newObj: T = obj instanceof clazz ? (obj as T) : this.instantiateObject(obj, clazz);
        const repo: Repository<T> | MongoRepository<T> = this.repo;

        // A create must never let its input pick an existing document. A caller-supplied `_id` would otherwise make
        // `MongoRepository.save()` replace (upsert) whichever document owns that `_id` - any record, of any owner.
        if (!options?.preserveId && (newObj as any)._id !== undefined) {
            delete (newObj as any)._id;
        }

        // JSON has no date type - store Date-typed properties as real dates, not strings.
        this.coerceDateProperties(newObj, clazz);

        // Make sure an existing object doesn't already exist with the same identifiers
        const ids: any[] = [];
        const idProps: string[] = ModelUtils.getIdPropertyNames(clazz);
        for (const prop of idProps) {
            const val: string = (newObj as any)[prop];
            if (val) {
                ids.push(val);
            }
        }

        const query: any = ModelUtils.buildIdSearchQuery(repo, clazz, ids, undefined);
        const count: number =
            this.repo instanceof MongoRepository
                ? await this.repo.count(query, { session: txInfo?.session })
                : await (txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo).count(
                      query,
                  );
        if (!this.modelClass.trackChanges && count > 0) {
            throw new ApiError(ApiErrors.IDENTIFIER_EXISTS, 400, ApiErrorMessages.IDENTIFIER_EXISTS);
        } else if (
            this.modelClass.trackChanges &&
            count > 0 &&
            this.modelClass.recordACL &&
            this.aclUtils?.enabled &&
            !(await this.aclUtils.hasPermission(options?.user, (newObj as any).uid, ACLAction.UPDATE))
        ) {
            // A trackChanges + recordACL model is being "re-created" under an existing uid (i.e. a new
            // version). That's only legitimate for someone who already has update rights on the
            // existing record — generic class-level CREATE permission isn't enough, otherwise any
            // creator could inject a new "latest version" of another user's record. Deliberately NOT
            // gated on `options.ignoreACL`: that flag exists so ModelRoute.doCreate() can skip
            // re-doing the class-level CREATE check it already performed upstream — it says nothing
            // about this distinct, additional per-record check, which has no upstream equivalent and
            // must always run.
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        // Override the date and version fields with their defaults. Whatever the caller supplied for these is
        // discarded, so a create can't forge a record's history or optimistic-lock state.
        if (newObj instanceof BaseEntity) {
            newObj.dateCreated = new Date();
            newObj.dateModified = new Date();
            newObj.version = count;
        }

        // Are we tracking multiple versions for this object?
        if (newObj instanceof BaseEntity && this.modelClass.trackChanges === 0) {
            (newObj as any).version = 0;
        }

        // Resolve the record-level ACL *before* the record is written, so that a create which isn't entitled to its
        // uid's ACL never writes a record at all (not even one that a transaction rollback would have to undo).
        const freshAclUid: string | undefined =
            this.aclUtils?.enabled && this.modelClass.recordACL
                ? await this.claimRecordACL((newObj as any).uid, count, options)
                : undefined;

        // HAX We shouldn't be casting obj to any here but this is the only way to get it to compile
        // since T extends BaseEntity.
        let saved: any;
        try {
            if (this.repo instanceof MongoRepository) {
                // `insertOnly`: a create always inserts, even when trusted code preserved an `_id` (`preserveId`).
                saved = await this.repo.save(newObj, { session: txInfo?.session, insertOnly: true });
            } else {
                const repo: any = txInfo?.entityManager
                    ? txInfo.entityManager.getRepository(this.modelClass)
                    : this.repo;
                saved = await repo.save(newObj);
            }
        } catch (err: any) {
            // Don't leave the ACL claimed above behind for a record that was never written. This can't be left to a
            // rollback hook alone: without transaction support there is no rollback to run one.
            if (freshAclUid) {
                try {
                    await this.aclUtils!.removeACL(freshAclUid);
                } catch (removeErr) {
                    this.logger?.warn(`RepoUtils: Failed to remove ACL ${freshAclUid} after a failed create().`);
                    this.logger?.debug(removeErr);
                }
            }
            // A duplicate key (a concurrent create of the same identifier, or a preserved `_id` that's already taken)
            // is an identifier conflict, not an internal error.
            if (err?.code === 11000) {
                throw new ApiError(ApiErrors.IDENTIFIER_EXISTS, 400, ApiErrorMessages.IDENTIFIER_EXISTS);
            }
            throw err;
        }
        const result: T = this.instantiateObject(saved);

        // `saveACL()` commits independently, on the `acl` connection's own transaction (see its doc comment). That
        // means it can't be rolled back by this (the entity-side) transaction's own abort if this transaction fails
        // later. Register a compensating action so a later failure doesn't leave an orphaned ACL behind.
        if (freshAclUid) {
            registerRollbackHook(async () => {
                try {
                    await this.aclUtils!.removeACL(freshAclUid);
                } catch (err) {
                    this.logger?.warn(
                        `RepoUtils: Failed to roll back orphaned ACL ${freshAclUid} after a failed create().`,
                    );
                    this.logger?.debug(err);
                }
            });
        }

        if (this.cache) {
            // Cache the object for faster retrieval.
            const query: any = this.searchIdQuery(newObj.uid);
            const cacheKey: string = this.hashQuery(query);
            this.cache.save(cacheKey, result).catch((err) => this.logCacheError("save", err));
            this.cache.save(result.uid, result).catch((err) => this.logCacheError("save", err));
        }

        // Process the result to remove any properties that have been scoped with @RequiresScope that the user
        // does not have access to. Done after caching (the cache must retain the full object for other
        // requests) but before the result is returned or broadcast to push subscribers.
        ObjectUtils.deleteScopedProps(result, options?.user, this.modelClass);

        if (!options?.skipPush) {
            let channels: string[] = [result.uid].concat(options?.pushChannels || []);
            this.notificationUtils?.sendMessage(channels, this.modelClass.name, "create", result);
        }

        return result;
    }

    @Transactional()
    public async delete(uid: string, options: RepoDeleteOptions): Promise<void> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const txInfo: TransactionInfo | undefined = this.getTransaction(options);

        if (this.aclUtils?.enabled && !options.ignoreACL) {
            const acl: AccessControlList | undefined = await this.aclUtils.findACL(uid);
            if (!(await this.aclUtils.hasPermission(options.user, acl ? acl : this.defaultACLUid, ACLAction.DELETE))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        const isRecoverable: boolean = this.instantiateObject({}) instanceof RecoverableBaseEntity;
        const isPurge: boolean = isRecoverable ? options.purge || false : true;
        // Delete must be able to target a record regardless of its current `deleted` state (the default) —
        // otherwise an already soft-deleted record could never be purged, nor a soft-delete repeated idempotently.
        const query: any = ModelUtils.buildIdSearchQuery(
            this.repo,
            this.modelClass,
            uid,
            options.version ? Number(options.version) : undefined,
        );

        // If the object(s) are being permenantly removed from the database do so and then clear the accompanying
        // ACL(s). If the class type is recoverable and purge isn't desired, simply mark the object(s) as deleted.
        if (isPurge) {
            if (this.repo instanceof MongoRepository) {
                await this.repo.deleteMany(query, { session: txInfo?.session });
            } else {
                const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
                await repo.delete(query.where);
            }

            if (this.aclUtils?.enabled && this.modelClass.recordACL) {
                // `removeACL()` returns the exact document it deleted (captured atomically, not via a separate
                // earlier read - see its doc comment) - used as the restore snapshot below. `removeACL()`
                // commits independently, on the `acl` connection's own transaction; if this (the entity-side)
                // transaction later fails, its own abort can't undo that removal, so the rollback hook restores
                // the snapshot in that case. `preserveVersion` restores its exact prior version instead of
                // bumping it, and refuses (rather than clobbers) if something already exists at this uid.
                const removedAcl: AccessControlList | undefined = await this.aclUtils.removeACL(uid);
                if (removedAcl) {
                    registerRollbackHook(async () => {
                        try {
                            await this.aclUtils!.saveACL(removedAcl, { preserveVersion: true });
                        } catch (err) {
                            this.logger?.warn(`RepoUtils: Failed to restore ACL ${uid} after a failed delete().`);
                            this.logger?.debug(err);
                        }
                    });
                }
            }
        } else {
            if (this.repo instanceof MongoRepository) {
                await this.repo.updateMany(
                    query,
                    {
                        $set: {
                            deleted: true,
                        },
                    },
                    { session: txInfo?.session },
                );
            } else {
                const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
                await repo.update(query.where, {
                    deleted: true,
                } as any);
            }
        }

        if (this.cache) {
            // Delete the object from cache.
            this.cache.delete(uid).catch((err) => this.logCacheError("delete", err));
            this.cache.delete(this.hashQuery(query)).catch((err) => this.logCacheError("delete", err));
            this.cache
                .delete(this.hashQuery(this.searchIdQuery(uid)))
                .catch((err) => this.logCacheError("delete", err));
        }

        if (!options?.skipPush) {
            let channels: string[] = [uid].concat(options?.pushChannels || []);
            this.notificationUtils?.sendMessage(channels, this.modelClass.name, "delete", {
                uid,
                version: options.version,
            });
        }
    }

    /**
     * Retrieves an array of objects from the datasource matching the given search query. This function will first
     * attempt to look up the results in the cache. Also checks ACLs for READ permission.
     *
     * @param query The constructed search query to run.
     * @param options The additional options to consider during the search.
     */
    public async find(query: any, options?: RepoFindOptions): Promise<Array<T>> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const action: string = options?.action ?? ACLAction.LIST;
        const txInfo: TransactionInfo | undefined = this.getTransaction(options);

        // Check user permissions against the class-level ACL. This is a fast-fail gate for users with no
        // legitimate access to the resource type at all; per-record narrowing (below, right before the
        // results are returned) is an additional layer on top of this, not a replacement for it.
        if (this.aclUtils?.enabled && !options?.ignoreACL) {
            if (!(await this.aclUtils.hasPermission(options?.user, this.defaultACLUid, action))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        const limit: number = options?.limit ? Math.min(options?.limit, 1000) : 100;
        const page: number = options?.page ? Number(options?.page) : 0;
        let results: T[] = [];

        // When we hash the seach query we need to ensure we're including the pagination information to preserve
        // like queries and results.
        const searchQueryHash: string = this.hashQuery({
            ...query,
            limit,
            page,
        });

        // Pull from the cache if available
        if (!options?.skipCache && this.cache) {
            const cached: (T | undefined)[] | undefined = await this.cache.loadSet(searchQueryHash);
            if (cached) {
                results = cached.filter((obj) => obj !== undefined);
            }
        }

        // If the query wasn't cached retrieve from the database
        if (results.length === 0) {
            const searchQuery: any = ModelUtils.buildSearchQuery(
                this.modelClass,
                this.repo,
                query,
                true,
                options?.user,
            );

            if (this.repo instanceof MongoRepository) {
                const skip: number = page * limit;
                if (Array.isArray(searchQuery)) {
                    results = await this.repo
                        .aggregate(searchQuery, { session: txInfo?.session })
                        .skip(skip)
                        .limit(limit)
                        .toArray();
                } else {
                    results = await this.repo
                        .find(searchQuery["$match"] ? searchQuery["$match"] : searchQuery, {
                            limit,
                            session: txInfo?.session,
                            skip,
                            sort: searchQuery["$sort"],
                        })
                        .toArray();
                }
            } else {
                const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
                // `searchQuery.page` (set by `buildSearchQuerySQL`) isn't a TypeORM find option and is silently
                // ignored by `repo.find()` - it must be translated to `skip` here, the same way the Mongo branch
                // above translates `page` into its own `skip`, or every SQL page request returns page 0.
                results = (await repo.find({ ...searchQuery, skip: page * limit })) as T[];
            }

            // Cache the results for future requests. Don't bother if there were no results.
            if (results.length > 0 && this.cache) {
                this.cache.saveSet(searchQueryHash, results).catch((err) => this.logCacheError("saveSet", err));
                // Also seed each individual object's own cache entry.
                const ids: string[] = results.map((obj) => this.hashQuery(this.searchIdQuery(obj.uid)));
                this.cache.saveMany(ids, results).catch((err) => this.logCacheError("saveMany", err));
            }
        }

        // Record-level ACLs aren't reflected in the query itself (nor in cached results, which are shared across
        // users), so each matched record must be checked individually before it's returned to the caller. The
        // checks are run concurrently, and share a request-scoped ACL cache, so that a page of N results costs
        // at most one round trip per *distinct* ACL uid (typically just the shared parent, since per-record
        // ACLs are rarely warm in Redis) instead of N sequential round trips.
        //
        // A soft-deleted row can appear in `results` despite `buildSearchQuery()`'s default exclusion via a client
        // supplying its own `deleted` query param, which the query builder honors as-is. Such a row needs the
        // same DELETE+UPDATE permission.
        if (this.aclUtils?.enabled && !options?.ignoreACL) {
            const recordACL: boolean = !!this.modelClass.recordACL;
            const permitted: boolean[] = await Promise.all(
                results.map((obj) => {
                    if ((obj as any).deleted === true) {
                        return this.canViewDeleted(options?.user, recordACL ? obj.uid : this.defaultACLUid);
                    }
                    return recordACL
                        ? this.aclUtils!.hasPermission(options?.user, obj.uid, action)
                        : Promise.resolve(true);
                }),
            );
            results = results.filter((_obj, i) => permitted[i]);
        }

        // Process the results to remove any properties that have been scoped with @RequiresScope that the user
        // does not have access to.
        ObjectUtils.deleteScopedProps(results, options?.user, this.modelClass);

        return results;
    }

    /**
     * Retrieves the object with the given id from either the cache or the database. If retrieving from the database
     * the cache is populated to speed up subsequent requests.
     *
     * @param id The unique identifier of the object to retrieve.
     * @param options The additional options to consider during the search.
     */
    public async findOne(id: string, options?: RepoFindOptions): Promise<T | undefined> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        let existing: T | null | undefined = undefined;
        const txInfo: TransactionInfo | undefined = this.getTransaction(options);

        // Deliberately uses the default (includeDeleted: true) query shape here — this result is cached under
        // a key shared with create()/update()/find()'s cache-seeding, all of which also use the default shape,
        // so changing it here alone would desync this read from what those write. Soft-deleted records are
        // filtered out below instead, after the cache/DB read, regardless of which one produced the result.
        const query: any = this.searchIdQuery(id, options?.version);
        if (!options?.skipCache && this.cache) {
            existing = await this.cache.load(this.hashQuery(query));
        }

        if (!existing) {
            if (this.repo instanceof MongoRepository) {
                existing = await this.repo
                    .find(query["$match"] ? query["$match"] : query, {
                        session: txInfo?.session,
                        sort: { version: -1 },
                    })
                    .next();
            } else if (this.modelClass.prototype instanceof BaseEntity) {
                // Without an explicit version, `query` matches every row sharing this uid (all historical
                // versions, for a trackChanges entity). Order by version desc so the newest one wins, the same
                // way the Mongo branch above does - otherwise TypeORM's `findOne()` returns whichever matching
                // row it encounters first, which isn't guaranteed to be the latest. `SimpleEntity` has no
                // `version` column to order by, so this only applies to `BaseEntity` subclasses.
                const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
                existing = (await repo.findOne({ ...query, order: { version: "DESC" } })) as T | null;
            } else {
                const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
                existing = (await repo.findOne(query)) as T | null;
            }
        }

        // Never surface a soft-deleted record via an id-based lookup by default — matches the default the
        // list/search endpoint already applies. `includeDeleted` opts back in (e.g. an admin history/restore
        // view fetching a specific past version by id). Checked here (after cache or DB resolution) rather
        // than by filtering `deleted` into the query above, so a cache entry that predates a delete, or was
        // seeded by an explicit `?deleted=true` list request, is filtered consistently either way.
        if (existing && (existing as any).deleted === true && !options?.includeDeleted) {
            existing = null;
        }

        if (existing) {
            if (this.cache) {
                // Cache the object for faster retrieval
                this.cache.save(this.hashQuery(query), existing).catch((err) => this.logCacheError("save", err));
            }

            // Check user permissions
            if (this.aclUtils?.enabled && !options?.ignoreACL) {
                const acl: AccessControlList | undefined = await this.aclUtils.findACL(existing.uid);

                if ((existing as any).deleted === true) {
                    // Viewing a soft-deleted record (opted into via `includeDeleted`) requires both DELETE and UPDATE
                    // permission, the two actions actually needed to restore the record.
                    if (!(await this.canViewDeleted(options?.user, acl ? acl : this.defaultACLUid))) {
                        existing = null;
                    }
                } else {
                    const action: string = options?.action ?? ACLAction.READ;
                    if (!(await this.aclUtils.hasPermission(options?.user, acl ? acl : this.defaultACLUid, action))) {
                        throw new ApiError(
                            ApiErrors.AUTH_PERMISSION_FAILURE,
                            403,
                            ApiErrorMessages.AUTH_PERMISSION_FAILURE,
                        );
                    }
                }
            }
        }

        const result = existing ? this.instantiateObject(existing) : undefined;

        // Process the result to remove any properties that have been scoped with @RequiresScope that the user
        // does not have access to.
        if (result) {
            ObjectUtils.deleteScopedProps(result, options?.user, this.modelClass);
        }

        // Make sure we return the correct data type
        return result;
    }

    /**
     * Resolves the per-record ACL for a record about to be created by `create()` under `uid`. Returns `uid` when a
     * fresh ACL was created for it (so the caller can clean it up if the create fails), or `undefined` when an
     * existing ACL is legitimately reused as-is.
     *
     * ACLs live in one global collection keyed only by uid, shared by every model, and a create's uid can come from
     * the client. An ACL that already exists at `uid` may guard a record of another model, or sit at a well-known
     * uid - adopting it (and adding the creator with full rights, as this used to) would hand the caller whatever
     * it protects. An existing ACL is therefore only reused, unchanged, when:
     * - `count > 0`: a trackChanges "new version" of an existing record (`create()` has already verified the
     * caller's UPDATE right on that record);
     * - the caller is trusted (`trusted_roles`), or trusted server code passed `allowExistingACL`;
     * - the caller already holds every right a creator would be granted on that ACL, so reusing it grants nothing.
     *
     * Otherwise the create is refused with `IDENTIFIER_EXISTS`, the same error as a record identifier collision.
     * A genuinely orphaned ACL can't be reliably told apart from one guarding another model's record, so no attempt
     * is made to replace it. A fresh ACL is claimed with `saveACL()`'s `createOnly` mode, so two concurrent creates
     * (of the same or of different models) can't both claim the same uid either.
     */
    private async claimRecordACL(
        uid: string,
        count: number,
        options: RepoCreateOptions | undefined,
    ): Promise<string | undefined> {
        const aclUtils: ACLUtils = this.aclUtils!;
        // Bypass the cache: this is an authorization decision about the ACL's current state.
        const existingAcl: AccessControlList | undefined = await aclUtils.findACL(uid, [], { skipCache: true });

        if (existingAcl) {
            if (count > 0 || options?.allowExistingACL || UserUtils.hasRoles(options?.user, this.trustedRoles, uid)) {
                return undefined;
            }
            for (const action of CREATOR_ACTIONS) {
                if (!(await aclUtils.hasPermission(options?.user, existingAcl, action))) {
                    throw new ApiError(ApiErrors.IDENTIFIER_EXISTS, 400, ApiErrorMessages.IDENTIFIER_EXISTS);
                }
            }
            return undefined;
        }

        const acl: AccessControlList = {
            uid,
            parentUid: options?.acl?.parentUid || this.defaultACLUid,
            records: [...(options?.acl?.records || [])],
        };

        // Look for an existing record for the creator. We only search the immediate ACL
        // and not the parent chain and we perform an exact match.
        const found: boolean = !!aclUtils.getRecord(acl, options?.user, { maxDepth: 0, specificity: "exact" });

        // Always grant the creator CRUD access, unless the user is a superuser.
        if (!found && options?.user && !UserUtils.hasRoles(options?.user, this.trustedRoles)) {
            acl.records.push({ userOrRoleId: options.user.uid, actions: [...CREATOR_ACTIONS] });
        }

        await aclUtils.saveACL(acl, { createOnly: true });
        return uid;
    }

    /**
     * Converts every `Date`-typed property of `obj` that holds a string or number (e.g. an ISO 8601 string from a
     * JSON request body) to a real `Date`, in place. Without this a MongoDB document stores the string itself, and
     * date range queries (which compare against `Date` operands) never match it.
     *
     * A property counts as `Date`-typed when its `@Column` declares an explicit date/time `type`, or otherwise when
     * TypeScript's emitted `design:type` is `Date`. TypeScript reflects a union-typed property (e.g. `Date | null`)
     * as `Object`, so such a property is only converted when its `@Column` sets `type` explicitly. Properties that
     * aren't `@Column`s are never touched.
     *
     * @param obj The object whose properties to convert.
     * @param clazz The model class describing `obj`.
     * @throws ApiError `INVALID_REQUEST` (400) when a value isn't a valid date.
     */
    protected coerceDateProperties(obj: any, clazz: any): void {
        if (!obj || typeof obj !== "object" || !clazz) {
            return;
        }

        for (const column of getColumnMetadata(clazz)) {
            const type: any = column.options.type ?? column.designType;
            const isDate: boolean =
                type === Date || (typeof type === "string" && DATE_COLUMN_TYPES.has(type.toLowerCase()));
            const value: any = obj[column.propertyName];
            if (!isDate || (typeof value !== "string" && typeof value !== "number")) {
                continue;
            }

            const date: Date = new Date(value);
            if (isNaN(date.getTime()) || (typeof value === "string" && value.trim() === "")) {
                throw new ApiError(
                    ApiErrors.INVALID_REQUEST,
                    400,
                    `Property ${column.propertyName} is invalid. Expected a valid date.`,
                );
            }
            obj[column.propertyName] = date;
        }
    }

    /**
     * Rejects update input with a top-level key that MongoDB would interpret as something other than a plain field
     * name: a dotted path (`"aliases.3"`, which writes a nested element) or an operator (`"$inc"`). Such a key
     * bypasses route/model validation (which only knows the model's real property names), so it is refused on
     * every backend rather than passed through.
     *
     * @throws ApiError `INVALID_REQUEST` (400) naming the first offending key.
     */
    private assertPlainPropertyNames(obj: any): void {
        for (const key of Object.keys(obj ?? {})) {
            if (key.includes(".") || key.startsWith("$")) {
                throw new ApiError(
                    ApiErrors.INVALID_REQUEST,
                    400,
                    `Property ${key} is invalid. Property names cannot contain '.' or start with '$'.`,
                );
            }
        }
    }

    /**
     * Determines whether `existing` is under optimistic locking: a `BaseEntity` instance or - for a `BaseEntity`
     * model - any object carrying a numeric `version`, such as a plain document read straight from a
     * `MongoRepository` (whose `find()`/`findOne()` return plain documents, not model instances).
     */
    private isVersioned(existing: any): boolean {
        return (
            existing instanceof BaseEntity ||
            (typeof existing?.version === "number" && this.modelClass?.prototype instanceof BaseEntity)
        );
    }

    /**
     * Returns the default access control list governing the model type. Returning a value of `undefined` will grant
     * full acccess to any user (including unauthenticated anonymous users).
     */
    public getDefaultACL(): AccessControlList | undefined {
        let result: AccessControlList | undefined = undefined;

        // Check if the model has the Protect decorator
        if (this.modelClass.classACL) {
            result = this.modelClass.classACL;
            if (result) {
                // Override the specified uid with the actual class name if the value is `<ClassName>`
                result.uid = result.uid === "<ClassName>" ? this.modelClass.name : result.uid;
            }
        }

        return result;
    }

    /**
     * Checks whether the caller has both `DELETE` and `UPDATE` permission against the given ACL (or ACL uid).
     * Ordinary READ/LIST/EXISTS permission on a record says nothing about whether its owner
     * consented to its "deleted" state being visible, so those two actions (the ones actually needed to
     * restore the record) are required instead.
     *
     * @param user The user to check.
     * @param acl The ACL (or ACL uid) governing the record.
     */
    private async canViewDeleted(user: JWTUser | undefined, acl: AccessControlList | string): Promise<boolean> {
        return (
            (await this.aclUtils!.hasPermission(user, acl, ACLAction.DELETE)) &&
            (await this.aclUtils!.hasPermission(user, acl, ACLAction.UPDATE))
        );
    }

    /**
     * Logs a swallowed error from a fire-and-forget cache operation. Cache reads/writes are best-effort and
     * must never propagate into (and thus fail/retry) the write they're attached to.
     * @param op The cache operation that failed (e.g. "save", "delete").
     * @param err The error thrown by the cache operation.
     */
    private logCacheError(op: string, err: any): void {
        this.logger?.warn(`RepoUtils: Cache ${op} failed for ${this.modelClass?.name}.`);
        this.logger?.debug(err);
    }

    /**
     * Hashes the given query object to a unique string.
     * @param query The query object to hash.
     */
    public hashQuery(query: any): string {
        const queryStr: string = JSON.stringify(query);
        let hash = _hashCache.get(queryStr);

        if (hash === undefined) {
            // Hash the query string
            hash = crypto.createHash("md5").update(queryStr).digest("hex");
            // Clear the hash cache if it grows too big to prevent runaway memory usage
            if (_hashCache.size >= 10000) {
                _hashCache.clear();
            }
            // Store the hashed query string for faster lookup next time
            _hashCache.set(queryStr, hash);
        }

        return hash;
    }

    /**
     * Returns the class type (constructor) for the given object. This uses the `_fqn` or `_type` property of `obj` to
     * identify the class. If neither property is defined `modelClass` is assumed.
     *
     * @param obj The object whose class type to look up.
     * @returns The class type (constructor) associated with the given object.
     */
    public getClassType(obj: any): any {
        const className: string | null = obj._fqn || obj._type;

        if (this._objectFactory) {
            if (className && typeof className === "string") {
                const clazz: any =
                    this._objectFactory.classes.get(className) ||
                    this._objectFactory.classes.get(`models.${className}`);

                // Only accept the resolved class if it's actually this route's model or a subtype of it (e.g. a
                // @ChildEntity()). `objectFactory.classes` contains every registered model in the app, so without
                // this check a client could point `_type`/`_fqn` at an unrelated model to have its payload
                // instantiated/validated against that other model's (possibly much looser) rules while still
                // being persisted through this route's own datasource/collection.
                if (clazz && (clazz === this.modelClass || clazz.prototype instanceof this.modelClass)) {
                    return clazz;
                }
            }
        }

        return this.modelClass;
    }

    /**
     * Returns the current transactional session information, if present.
     */
    protected getTransaction(options?: RepoOperationOptions): TransactionInfo | undefined {
        return options?.transaction ?? transactionContext.getStore();
    }

    /**
     * Creates a new instance of obj scoped to the correct model class or sub-class.
     */
    public instantiateObject(obj: any, clazz?: any): T {
        if (!clazz) {
            clazz = this.getClassType(obj);
        }

        return new clazz(obj);
    }

    /**
     * Search for existing object based on passed in id and version and product uid.
     *
     * The result of this function is compatible with all `Repository.find()` functions.
     *
     * @param includeDeleted Set to false to exclude soft-deleted `RecoverableBaseEntity` records from matching.
     * Defaults to true; pass false when the result is exposed directly to an API client (e.g. `findOne`, `exists`)
     * so a soft-deleted record isn't returned as if it still existed.
     */
    public searchIdQuery(id: string, version?: number | string, includeDeleted: boolean = true): any {
        return ModelUtils.buildIdSearchQuery(
            this.repo,
            this.modelClass,
            id,
            typeof version === "string" ? parseInt(version, 10) : version,
            includeDeleted,
        );
    }

    @Transactional()
    public async truncate(query: any, options: RepoFindOptions): Promise<void> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const txInfo: TransactionInfo | undefined = this.getTransaction(options);

        // Check user permissions. Don't check if record-level ACLs are used as this will be done
        // per record later.
        if (this.aclUtils?.enabled && !options.ignoreACL && !this.modelClass.recordACL) {
            if (!(await this.aclUtils.hasPermission(options.user, this.defaultACLUid, ACLAction.TRUNCATE))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        try {
            const searchQuery: any = ModelUtils.buildSearchQuery(
                this.modelClass,
                this.repo,
                query,
                true,
                options?.user,
            );
            const uids: Array<string> = await this.findAllUids(searchQuery, options);

            if (uids.length > 0) {
                let finalUids: string[] = uids;

                // Check if this class uses record level ACLs. If so, we need to check the perms of
                // each one. We will remove any from our list that the user does not have permission to
                // truncate.
                if (this.aclUtils?.enabled && this.modelClass.recordACL) {
                    if (options.ignoreACL) {
                        // Caller has already authorized this truncate; skip the per-record permission
                        // narrowing entirely rather than defaulting to an empty (i.e. no-op) delete set.
                        finalUids = uids;
                    } else {
                        finalUids = await this.filterPermittedUids(uids, ACLAction.TRUNCATE, options);
                    }
                }

                const cleansUpRecordACLs: boolean = !!(this.aclUtils?.enabled && this.modelClass.recordACL);

                // Now delete all records that were found
                if (this.repo instanceof MongoRepository) {
                    await this.repo.deleteMany({ uid: { $in: finalUids } } as any, {
                        session: txInfo?.session,
                    });
                } else {
                    const repo = txInfo?.entityManager
                        ? txInfo.entityManager.getRepository(this.modelClass)
                        : this.repo;
                    // A plain array of ids only maps to a WHERE ... IN clause when the primary key is a single
                    // column — for a trackChanges entity the SQL primary key is the composite (uid, version),
                    // so an explicit In() on the uid column is used instead of relying on that implicit form.
                    const { In } = ModelUtils.orm;
                    await repo.delete({ uid: In(finalUids) });
                }

                if (cleansUpRecordACLs && finalUids.length > 0) {
                    // `removeACLs()` returns exactly what it deleted (captured atomically, not via a separate
                    // earlier read - see `removeACL()`'s doc comment) - used directly as the restore snapshot.
                    // It commits independently, on the `acl` connection's own transaction; if this (entity-side)
                    // transaction later fails, its own abort can't undo that removal, so the rollback hook
                    // restores the snapshot in that case. `saveACLs()` restores each ACL's exact prior version
                    // (see `saveACL()`'s `preserveVersion` option) and refuses — rather than clobbers — any of
                    // these uids that already has something at it again by the time the restore runs.
                    const removedAcls: AccessControlList[] = await this.aclUtils!.removeACLs(finalUids);
                    if (removedAcls.length > 0) {
                        registerRollbackHook(async () => {
                            try {
                                await this.aclUtils!.saveACLs(removedAcls);
                            } catch (err) {
                                this.logger?.warn(
                                    `RepoUtils: Failed to restore ${removedAcls.length} ACL(s) after a failed truncate().`,
                                );
                                this.logger?.debug(err);
                            }
                        });
                    }
                }

                if (!options?.skipPush) {
                    let channels: string[] = options?.pushChannels || [];
                    for (const uid of finalUids) {
                        const finalChannels: string[] = channels.concat([uid]);
                        this.notificationUtils?.sendMessage(finalChannels, this.modelClass.name, "delete", {
                            uid,
                            version: options.version,
                        });
                    }
                }
            }
        } catch (err: any) {
            // The error "ns not found" occurs when the collection doesn't exist yet. We can ignore this error.
            if (err.message !== "ns not found") {
                throw err;
            }
        }
    }

    @Transactional()
    public async update(obj: Partial<T>, existing: T, options?: RepoUpdateOptions<T>): Promise<T> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const txInfo: TransactionInfo | undefined = this.getTransaction(options);

        if (this.aclUtils?.enabled && !options?.ignoreACL) {
            const acl: AccessControlList | undefined = await this.aclUtils.findACL(existing.uid);
            if (!(await this.aclUtils.hasPermission(options?.user, acl ? acl : this.defaultACLUid, ACLAction.UPDATE))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        // A dotted (`"aliases.3"`) or `$`-prefixed top-level key would write a nested path (or an operator) that
        // route/model validation never saw. `update()` itself never needs one, so it's refused outright.
        this.assertPlainPropertyNames(obj);

        // Enforce optimistic locking when applicable. Keyed on the record actually carrying a version, not on its
        // prototype: a plain document read straight from a `MongoRepository` is just as versioned as a model
        // instance, and silently skipping the check (and the version bump below) for it lost concurrent writes.
        const versioned: boolean = this.isVersioned(existing);
        if (versioned) {
            if ((existing as any).version !== (obj as any).version) {
                throw new ApiError(ApiErrors.INVALID_OBJECT_VERSION, 409, ApiErrorMessages.INVALID_OBJECT_VERSION);
            }
        }

        // Make sure the object provided actually matches the id given
        if (existing.uid !== obj.uid) {
            throw new ApiError(ApiErrors.OBJECT_ID_MISMATCH, 400, ApiErrorMessages.OBJECT_ID_MISMATCH);
        }

        // JSON has no date type - store Date-typed properties as real dates, not strings.
        this.coerceDateProperties(obj, this.getClassType(obj));

        // Force system-managed fields back to their persisted value, discarding whatever the client sent (or
        // didn't send) for them. `dateCreated` is always protected, with no bypass - there is never a
        // legitimate reason to change it via update(). `@ReadOnly`-decorated properties are an app-level
        // opt-in for anything else (roles, ownership fields, etc.) that must never be client-settable, but
        // trusted server-side code may pass `allowReadOnly: true` to write them anyway - see that option's
        // own doc comment on `RepoUpdateOptions`.
        if (versioned) {
            (obj as any).dateCreated = (existing as any).dateCreated;
        }
        if (!options?.allowReadOnly) {
            for (const prop of ModelUtils.getReadOnlyPropertyNames(this.modelClass)) {
                (obj as any)[prop] = (existing as any)[prop];
            }
        }

        // `_id` always comes from the stored record, never from the input. On MongoDB this also prevents duplicate
        // entries when saving; an input `_id` is never allowed to select (or be written over) some other document.
        if ((existing as any)._id !== undefined && (existing as any)._id !== null) {
            (obj as any)._id = (existing as any)._id;
        } else {
            delete (obj as any)._id;
        }

        const keepPrevious: boolean = !!this.modelClass.trackChanges;
        let query: any = this.searchIdQuery(existing.uid, options?.version || (obj as any).version);
        let result: T | null = null;

        if (this.repo instanceof MongoRepository) {
            // The fields to `$set` in place - never `_id`, which is immutable and already identifies the document.
            const { _id, ...fields } = obj as any;

            if (versioned) {
                if (keepPrevious) {
                    // Same (uid, version) unique index race as RepoUtils.create(): two concurrent updates of
                    // the same version can both pass the optimistic-lock check above and both attempt to
                    // insert (uid, version + 1). The database rejects the loser; treat that the same as a
                    // lost optimistic-lock race rather than letting the raw duplicate-key error escape.
                    try {
                        result = this.instantiateObject(
                            await this.repo.save(
                                {
                                    ...obj,
                                    _id: undefined, // Ensure we save a new document
                                    dateModified: new Date(),
                                    version: (obj as any).version + 1,
                                } as any,
                                { session: txInfo?.session },
                            ),
                        );
                    } catch (err: any) {
                        if (err?.code === 11000) {
                            throw new ApiError(
                                ApiErrors.INVALID_OBJECT_VERSION,
                                409,
                                ApiErrorMessages.INVALID_OBJECT_VERSION,
                            );
                        }
                        throw err;
                    }
                } else {
                    // One atomic, version-conditioned find-and-modify that returns this call's own write. A separate
                    // `updateOne()` followed by a `findOne(version + 1)` read-back could miss when a concurrent writer
                    // bumped the version again in between, failing a write that had actually succeeded.
                    result = await this.repo.findOneAndUpdate(
                        { uid: obj.uid, version: (obj as any).version },
                        {
                            $set: {
                                ...fields,
                                dateModified: new Date(),
                                version: (obj as any).version + 1,
                            },
                        },
                        { session: txInfo?.session, returnDocument: "after" },
                    );
                    // No match means a concurrent writer already advanced this record past `obj.version` (or removed
                    // it): a lost optimistic-lock race, reported as such rather than silently overwriting.
                    if (!result) {
                        throw new ApiError(
                            ApiErrors.INVALID_OBJECT_VERSION,
                            409,
                            ApiErrorMessages.INVALID_OBJECT_VERSION,
                        );
                    }
                }
            } else if (obj.uid) {
                if (keepPrevious) {
                    try {
                        result = this.instantiateObject(
                            await this.repo.save(
                                {
                                    ...obj,
                                    _id: undefined, // Ensure we save a new document
                                    version: (obj as any).version + 1,
                                } as any,
                                { session: txInfo?.session },
                            ),
                        );
                    } catch (err: any) {
                        if (err?.code === 11000) {
                            throw new ApiError(
                                ApiErrors.INVALID_OBJECT_VERSION,
                                409,
                                ApiErrorMessages.INVALID_OBJECT_VERSION,
                            );
                        }
                        throw err;
                    }
                } else {
                    result = await this.repo.findOneAndUpdate(
                        { uid: obj.uid },
                        { $set: fields },
                        { session: txInfo?.session, returnDocument: "after" },
                    );
                    // The record was removed after `existing` was read.
                    if (!result) {
                        throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
                    }
                }
            } else {
                const toSave: any = obj as any;
                if (keepPrevious) {
                    toSave.version += 1;
                }

                result = await this.repo.save(toSave, { session: txInfo?.session });
            }
        } else {
            const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
            if (versioned) {
                if (keepPrevious) {
                    await repo.insert({
                        ...obj,
                        dateModified: new Date(),
                        version: (obj as any).version + 1,
                    });
                } else {
                    const updateResult = await repo.update(query.where, {
                        ...obj,
                        dateModified: new Date(),
                        version: (obj as any).version + 1,
                    } as any);
                    // Same silent-conflict hazard as the Mongo branch above: `repo.update()` doesn't throw when
                    // its WHERE clause (including `version`) matches nothing, it just reports 0 affected rows.
                    // Only checked when the driver actually reports a number (some don't, e.g. `affected` stays
                    // `undefined`) - never throw on ambiguous ignorance of the true row count.
                    if (updateResult.affected === 0) {
                        throw new ApiError(
                            ApiErrors.INVALID_OBJECT_VERSION,
                            409,
                            ApiErrorMessages.INVALID_OBJECT_VERSION,
                        );
                    }
                }
            } else {
                const toSave: any = obj as any;

                if (keepPrevious) {
                    toSave.version += 1;
                    // TypeORM's overloaded Repository.save() can't be resolved against `repo`'s inferred
                    // `EntityManager | Repository<T>` union type — same class of friction as the "HAX" cast
                    // above.
                    result = await (repo as any).save(toSave);
                } else {
                    await repo.update(query.where, toSave);
                }
            }
        }

        query = this.searchIdQuery(existing.uid, versioned ? (existing as any).version + 1 : undefined);
        if (!result) {
            if (this.repo instanceof MongoRepository) {
                result = await this.repo.findOne(query["$match"] ? query["$match"] : query, {
                    session: txInfo?.session,
                });
            } else {
                const repo = txInfo?.entityManager ? txInfo.entityManager.getRepository(this.modelClass) : this.repo;
                result = (await repo.findOne(query)) as T | null;
            }
            if (!result) {
                throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
            }
        }

        result = this.instantiateObject(result);

        if (result && this.cache) {
            // Cache the object for faster retrieval.
            this.cache.save(this.hashQuery(query), result).catch((err) => this.logCacheError("save", err));
            this.cache
                .save(this.hashQuery(this.searchIdQuery(result.uid)), result)
                .catch((err) => this.logCacheError("save", err));
        }

        // Process the result to remove any properties that have been scoped with @RequiresScope that the user
        // does not have access to. Done after caching (the cache must retain the full object for other
        // requests) but before the result is returned or broadcast to push subscribers.
        ObjectUtils.deleteScopedProps(result, options?.user, this.modelClass);

        if (!options?.skipPush) {
            let channels: string[] = [result.uid].concat(options?.pushChannels || []);
            this.notificationUtils?.sendMessage(channels, this.modelClass.name, "update", result);
        }

        return result;
    }

    /**
     * Performs validation on the object(s) provided. This function first calls `ObjectUtils.validate()` to check
     * any class level defined validation functions. Second, it scans for any properties with the `@Reference`
     * decorator and attempts to verify that an existing object for the given reference ID is valid.
     *
     * @param objs The object(s) to validate.
     * @param options The optional set of arguments that can be passed to perform additonal checks.
     */
    public async validate(objs: Partial<T> | Partial<T>[], options?: RepoOperationOptions): Promise<void> {
        objs = Array.isArray(objs) ? objs : [objs];

        try {
            for (let obj of objs) {
                // Instantiate the correct object type so that we can perform validation correctly. If we don't do this
                // then the provided object will be missing all decorators and validation won't work as desired.
                const metadataObj: T = this.instantiateObject(obj);

                // A separate, genuinely bare instance (constructed with no data at all) to source @ReadOnly
                // defaults from. `metadataObj` isn't safe for this: it's hydrated from the client-supplied
                // `obj`, and a model constructor that copies a same-named field from its `other` argument
                // (a common "hydrate from data" pattern) would carry the client's tampered value straight
                // through to `metadataObj` too, making the "reset to default" below a no-op.
                const defaultObj: T = this.instantiateObject(undefined, (metadataObj as any).constructor);

                ObjectUtils.validate(obj, (metadataObj as any).constructor);

                // Iterate through all properties
                for (const member of Object.getOwnPropertyNames(obj)) {
                    // Reset any @ReadOnly properties, discarding whatever the client supplied.
                    const isReadOnly: boolean = Reflect.getMetadata("rrst:readOnly", metadataObj, member);
                    if (member in obj && isReadOnly) {
                        // Override the value from our default object
                        obj[member] = (defaultObj as any)[member];
                    }

                    // Check for @Reference
                    const clazz: any = Reflect.getMetadata("rrst:reference", metadataObj, member);
                    if (clazz && clazz.datasource && obj[member]) {
                        // Attempt to grab the repository for this reference type
                        const conn: any = this.connectionManager?.connections.get(clazz.datasource);
                        const repo: MongoRepository<any> | Repository<any> | undefined =
                            conn instanceof MongoConnection || isSqlDataSource(conn)
                                ? conn.getRepository(clazz)
                                : undefined;
                        if (repo) {
                            // Check to see if there are any objects with this UID in the datasource. If the value is an array
                            // let's make sure that every uid is valid.
                            const uids: string[] = Array.isArray(obj[member]) ? obj[member] : [obj[member]];
                            const query: any = ModelUtils.buildIdSearchQuery(repo, clazz, uids);
                            const count: number = await repo.count(query);
                            if (count !== uids.length) {
                                throw new ApiError(
                                    ApiErrorMessages.INVALID_REQUEST,
                                    400,
                                    `Property ${member} is invalid. No resource found with the given identifier.`,
                                );
                            }
                        }
                    }
                }
            }
        } catch (err: any) {
            throw new ApiError(ApiErrors.INVALID_REQUEST, 400, err.message);
        }
    }
}
