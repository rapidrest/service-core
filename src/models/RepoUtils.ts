///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
////////////////////////////////////////////////////////////////////////////////
import * as crypto from "crypto";
import { Repository, MongoRepository, EntityMetadata, DataSource } from "typeorm";
import { ModelUtils } from "../models/ModelUtils.js";
import { BaseEntity } from "../models/BaseEntity.js";
import { SimpleEntity } from "../models/SimpleEntity.js";
import { BaseMongoEntity } from "../models/BaseMongoEntity.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import { ApiError, JWTUser, ObjectDecorators, ObjectUtils, UserUtils } from "@rapidrest/core";
import { DatabaseDecorators } from "../decorators/index.js";
import { Redis } from "ioredis";
import { ObjectFactory } from "../ObjectFactory.js";
import { NotificationUtils } from "../NotificationUtils.js";
import { RecoverableBaseEntity } from "./RecoverableBaseEntity.js";
import { Admin } from "mongodb";
import { AccessControlList, ACLAction, ACLUtils } from "../security/index.js";
import { ConnectionManager } from "../database/index.js";
const { Config, Init, Inject, Logger } = ObjectDecorators;
const { RedisConnection } = DatabaseDecorators;

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
    /** The authenticated user making the request. */
    user?: JWTUser;
}

/**
 * The available options for the `RepoUtils.create()` operation.
 */
export interface RepoCreateOptions extends RepoOperationOptions {
    /** The AccessControlList to use when creating a new object. */
    acl?: AccessControlList;
}

/**
 * The available options for the `RepoUtils.delete()` operation.
 */
export interface RepoDeleteOptions extends RepoOperationOptions {
    /** The desired product uid of the resource to delete. */
    productUid?: string;
    /** Set to true to permanently remove the object from the database (if applicable). */
    purge?: boolean;
    /** The desired version number of the resource to delete. */
    version?: number | string;
}

export interface RepoFindOptions extends RepoOperationOptions {
    /** The total number of resources to retrieve. */
    limit?: number;
    /** The page number of the paginated results to retrieve. */
    page?: number;
    /** The desired product uid of the resources to retrieve. */
    productUid?: string;
    /** Set to `true` to skip retrieval from the cache. Default is `false`. */
    skipCache?: boolean;
    /** The desired version number of the resources to retrieve. */
    version?: number | string;
}

/**
 * The available options for the `RepoUtils.update()` operation.
 */
export interface RepoUpdateOptions<T extends BaseEntity | SimpleEntity> extends RepoOperationOptions {
    /** The desired product uid of the resource to update. */
    productUid?: string;
    /** The desired version number of the resource to update. */
    version?: number | string;
}

/**
 * @author Jean-Philippe Steinmetz
 */
export class RepoUtils<T extends BaseEntity | SimpleEntity> {
    @Inject("ACLUtils")
    protected aclUtils?: ACLUtils;

    /** The redis client that will be used as a 2nd level cache for all cacheable models. */
    @RedisConnection("cache")
    protected cacheClient?: Redis;

    @Config()
    protected config: any;

    @Inject(ConnectionManager)
    protected connectionManager?: ConnectionManager;

    /** The unique identifier of the default ACL for the model type. */
    public defaultACLUid: string = "";

    @Logger
    protected logger: any;

    protected modelClass: any;

    @Inject(ObjectFactory)
    protected objectFactory?: ObjectFactory;

    @Inject(NotificationUtils)
    protected notificationUtils?: NotificationUtils;

    /** The model class associated with the controller to perform operations against. */
    public repo?: Repository<T>;

    @Config("trusted_roles", ["admin"])
    protected trustedRoles: string[] = ["admin"];

    constructor(modelClass: any, repo?: Repository<T>) {
        this.modelClass = modelClass;
        this.repo = repo;
    }

    @Init
    protected async init() {
        // Retrieve the repository based on the modelClass that was passed in to the constructor
        if (!this.repo) {
            if (!this.modelClass.datastore) {
                throw new Error(
                    `Cannot initialize RepoUtils. Did you forget to add @DataStore() to ${this.modelClass.name}?`
                );
            }

            if (!this.connectionManager) {
                throw new Error("Cannot initialize RepoUtils. Failed to retrieve ConnectionManager.");
            }

            const ds: any = this.connectionManager.connections.get(this.modelClass.datastore);
            if (!ds) {
                throw new Error(
                    `Cannot initialize RepoUtils. No connection found for datastore '${this.modelClass.datastore}'`
                );
            }

            this.repo = ds.getRepository(this.modelClass);
        }

        if (!this.repo) {
            throw new Error(`Cannot initialize RepoUtils. No repository found for class ${this.modelClass.name}.`);
        }

        let defaultAcl: AccessControlList | undefined = this.getDefaultACL();
        if (defaultAcl) {
            this.defaultACLUid = defaultAcl.uid;
            await this.aclUtils?.saveDefaultACL(defaultAcl);
        }

        // Does the model specify a MongoDB shard configuration?
        const shardConfig: any = Reflect.getMetadata("rrst:shardConfig", this.modelClass);
        if (shardConfig && this.repo instanceof MongoRepository) {
            const dbClient: any = this.repo.manager.mongoQueryRunner.databaseConnection;
            if (dbClient) {
                try {
                    const admin: Admin = dbClient.db().admin() as Admin;
                    if (admin) {
                        // Find the EntityMetadata associated with this model class.
                        let metadata: EntityMetadata | undefined = undefined;
                        for (const md of this.repo.manager.connection.entityMetadatas) {
                            if (md.target === this.modelClass) {
                                metadata = md;
                                break;
                            }
                        }

                        if (metadata) {
                            try {
                                // Configure the sharded collection with the MongoDB server.
                                const dbName: string = this.config.get(
                                    `datastores:${this.modelClass.datastore}:database`
                                );
                                this.logger.info(
                                    `Configuring sharding for: collection=${dbName}.${
                                        metadata.tableName
                                    }, key=${JSON.stringify(shardConfig.key)}, unique=${
                                        shardConfig.unique
                                    }, options=${JSON.stringify(shardConfig.options)})`
                                );
                                const result: any = await admin.command({
                                    shardCollection: `${dbName}.${metadata.tableName}`,
                                    key: shardConfig.key,
                                    unique: shardConfig.unique,
                                    ...shardConfig.options,
                                });
                                this.logger.debug(`Result: ${JSON.stringify(result)}`);
                            } catch (e: any) {
                                this.logger.warn(
                                    `There was a problem trying to configure MongoDB sharding for collection '${metadata.tableName}'. Error=${e.message}`
                                );
                            }
                        }
                    } else {
                        this.logger.debug("Failed to get mongodb admin interface.");
                    }
                } catch (e: any) {
                    // Sharding is not supported or user doesnt' have permission
                    this.logger.debug(`Sharding not supported or user lacks the clusterAdmin role. Error=${e.message}`);
                }
            }
        }
    }

    /**
     * The base key used to get or set data in the cache.
     */
    public get baseCacheKey(): string {
        return "db.cache." + this.modelClass.name;
    }

    public async count(query: any, options?: RepoFindOptions): Promise<number> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        let count: number = 0;

        // Check user permissions
        if (this.aclUtils && !options?.ignoreACL) {
            if (!(await this.aclUtils.hasPermission(options?.user, this.defaultACLUid, ACLAction.READ))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        if (this.repo instanceof MongoRepository && Array.isArray(query)) {
            query.push({ $count: "count" });
            const result: any = await this.repo.aggregate(query).next();
            count = result ? result.count : count;
        } else {
            count = await this.repo.count(query);
        }

        return count;
    }

    /**
     * Stores a new record of the provided object in the datastore. Performs pre-processing, permission checks against
     * the class ACL, cache seeding, telemetry recording and push notifications.
     *
     * @param obj The object to store.
     * @param acl The ACL to use
     */
    public async create(obj: Partial<T>, options?: RepoCreateOptions): Promise<T> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        // Verify the user's permission to create objects
        if (
            this.aclUtils &&
            !options?.ignoreACL &&
            !(await this.aclUtils.hasPermission(options?.user, this.defaultACLUid, ACLAction.CREATE))
        ) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        // Instantiate the object if not already done
        const clazz: any = this.getClassType(obj);
        const newObj: T = obj instanceof clazz ? obj as T : this.instantiateObject(obj, clazz);

        // Make sure an existing object doesn't already exist with the same identifiers
        const ids: any[] = [];
        const idProps: string[] = ModelUtils.getIdPropertyNames(clazz);
        for (const prop of idProps) {
            // Skip `productUid` as it is considered a compound key
            if (prop === "productUid") continue;
            const val: string = (newObj as any)[prop];
            if (val) {
                ids.push(val);
            }
        }
        const query: any = ModelUtils.buildIdSearchQuery(
            this.repo,
            clazz,
            ids,
            undefined,
            (newObj as any).productUid
        );
        const count: number = await this.repo.count(query);
        if (!this.modelClass.trackChanges && count > 0) {
            throw new ApiError(ApiErrors.IDENTIFIER_EXISTS, 400, ApiErrorMessages.IDENTIFIER_EXISTS);
        }

        // Override the date and version fields with their defaults
        if (newObj instanceof BaseEntity) {
            newObj.dateCreated = new Date();
            newObj.dateModified = new Date();
            newObj.version = count;
        }

        // Are we tracking multiple versions for this object?
        if (newObj instanceof BaseEntity && this.modelClass.trackChanges === 0) {
            (newObj as any).version = 0;
        }

        // HAX We shouldn't be casting obj to any here but this is the only way to get it to compile since T
        // extends BaseEntity.
        const result: T = this.instantiateObject(await this.repo.save(newObj));

        if (this.cacheClient && this.modelClass.cacheTTL) {
            // Cache the object for faster retrieval
            const query: any = this.searchIdQuery(newObj.uid);
            const cacheKey: string = `${this.baseCacheKey}.${this.hashQuery(query)}`;
            void this.cacheClient.setex(cacheKey, this.modelClass.cacheTTL, JSON.stringify(result));
        }

        if (this.aclUtils && this.modelClass.recordACL) {
            // If ACLs are enabled but no ACL was given create one
            const acl: AccessControlList = {
                uid: result.uid,
                parentUid: options?.acl?.parentUid || this.defaultACLUid,
                records: options?.acl?.records || [],
            };

            // Look for an existing record for the creator
            let found: boolean = !!this.aclUtils.getRecord(acl, options?.user);

            // Always grant the creator CRUD access, unless the user is a superuser.
            if (!found && options?.user && !UserUtils.hasRoles(options?.user, this.trustedRoles)) {
                acl.records.push({
                    userOrRoleId: options.user.uid,
                    create: true,
                    read: true,
                    update: true,
                    delete: true,
                    special: false,
                    full: false,
                });
            }

            await this.aclUtils?.saveACL(acl);
        }

        if (!options?.skipPush) {
            let channels: string[] = [result.uid].concat(options?.pushChannels || []);
            this.notificationUtils?.sendMessage(channels, this.modelClass.name, "create", result);
        }

        return result;
    }

    public async delete(uid: string, options: RepoDeleteOptions): Promise<void> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        if (this.aclUtils && !options.ignoreACL) {
            const acl: AccessControlList | null = await this.aclUtils.findACL(uid);
            if (!(await this.aclUtils.hasPermission(options.user, acl ? acl : this.defaultACLUid, ACLAction.DELETE))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        const isRecoverable: boolean = this.instantiateObject({}) instanceof RecoverableBaseEntity;
        const isPurge: boolean = isRecoverable ? options.purge || false : true;
        const query: any = ModelUtils.buildIdSearchQuery(
            this.repo,
            this.modelClass,
            uid,
            options.version ? Number(options.version) : undefined,
            options.productUid
        );

        // If the object(s) are being permenantly removed from the database do so and then clear the accompanying
        // ACL(s). If the class type is recoverable and purge isn't desired, simply mark the object(s) as deleted.
        if (isPurge) {
            if (this.repo instanceof MongoRepository) {
                await this.repo.deleteMany(query);
            } else {
                await this.repo.delete(query.where);
            }

            if (this.aclUtils && this.modelClass.recordACL) {
                await this.aclUtils.removeACL(uid);
            }
        } else {
            if (this.repo instanceof MongoRepository) {
                await this.repo.updateMany(query, {
                    $set: {
                        deleted: true,
                    },
                });
            } else {
                await this.repo.update(query.where, {
                    deleted: true,
                } as any);
            }
        }

        if (this.cacheClient && this.modelClass.cacheTTL) {
            // Delete the object from cache
            void this.cacheClient.del(`${this.baseCacheKey}.${this.hashQuery(query)}`);
            void this.cacheClient.del(`${this.baseCacheKey}.${this.hashQuery(this.searchIdQuery(uid))}`);
        }

        if (!options?.skipPush) {
            let channels: string[] = [uid].concat(options?.pushChannels || []);
            this.notificationUtils?.sendMessage(channels, this.modelClass.name, "delete", {
                uid,
                productUid: options.productUid,
                version: options.version,
            });
        }
    }

    /**
     * Retrieves an array of objects from the datastore matching the given search query. This function will first
     * attempt to look up the results in the cache. Also checks ACLs for READ permission.
     *
     * @param query The constructed search query to run.
     * @param options The additional options to consider during the search.
     */
    public async find(query: any, options?: RepoFindOptions): Promise<Array<T>> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        let results: T[] = [];

        // Check user permissions
        if (this.aclUtils && !options?.ignoreACL) {
            if (!(await this.aclUtils.hasPermission(options?.user, this.defaultACLUid, ACLAction.READ))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        const limit: number = options?.limit ? Math.min(options?.limit, 1000) : 100;
        const page: number = options?.page ? Number(options?.page) : 0;

        // When we hash the seach query we need to ensure we're including the pagination information to preserve
        // like queries and results.
        const searchQueryHash: string = this.hashQuery({
            ...query,
            limit,
            page,
        });

        // Pull from the cache if available
        if (this.cacheClient && this.modelClass.cacheTTL) {
            const json: string | null = await this.cacheClient.get(`${this.baseCacheKey}.${searchQueryHash}`);
            if (json) {
                try {
                    const uids: string[] = JSON.parse(json);
                    for (const uid of uids) {
                        // Retrieve the object from the cache or from database if not available
                        const obj: T | undefined = await this.findOne(uid, options);
                        if (obj) {
                            results.push(obj);
                        }
                    }
                } catch (err) {
                    // It doesn't matter if this fails
                }
            }
        }

        // If the query wasn't cached retrieve from the database
        if (results.length === 0) {
            if (this.repo instanceof MongoRepository && Array.isArray(query)) {
                const skip: number = page * limit;
                results = await this.repo.aggregate(query).skip(skip).limit(limit).toArray();
            } else {
                results = await this.repo.find(query);
            }

            // Cache the results for future requests
            if (this.cacheClient && this.modelClass.cacheTTL) {
                const uids: string[] = [];

                for (const result of results) {
                    uids.push(result.uid);
                }

                void this.cacheClient.setex(
                    `${this.baseCacheKey}.${searchQueryHash}`,
                    this.modelClass.cacheTTL,
                    JSON.stringify(uids)
                );
            }
        }

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

        const query: any = this.searchIdQuery(id, options?.version, options?.productUid);
        if (!options?.skipCache && this.cacheClient && this.modelClass.cacheTTL) {
            // First attempt to retrieve the object from the cache
            const json: string | null = await this.cacheClient.get(`${this.baseCacheKey}.${this.hashQuery(query)}`);
            if (json) {
                try {
                    const existing: T | null = JSON.parse(json);
                    if (existing) {
                        return existing;
                    }
                } catch (err) {
                    // It doesn't matter if this fails
                }
            }
        }

        let existing: T | null = null;
        if (this.repo instanceof MongoRepository) {
            existing = await this.repo
                .aggregate([
                    {
                        $match: query,
                    },
                    {
                        $sort: { version: -1 },
                    },
                ])
                .limit(1)
                .next();
        } else {
            existing = await this.repo.findOne(query);
        }

        if (existing && this.cacheClient && this.modelClass.cacheTTL) {
            // Cache the object for faster retrieval
            void this.cacheClient.setex(
                `${this.baseCacheKey}.${this.hashQuery(query)}`,
                this.modelClass.cacheTTL,
                JSON.stringify(existing)
            );
        }

        // Make sure we return the correct data type
        return existing ? this.instantiateObject(existing) : undefined;
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
     * Hashes the given query object to a unique string.
     * @param query The query object to hash.
     */
    public hashQuery(query: any): string {
        const queryStr: string = JSON.stringify(query);
        return crypto.createHash("sha512").update(queryStr).digest("hex");
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

        if (this.objectFactory) {
            if (className && typeof className === "string") {
                const clazz: any =
                    this.objectFactory.classes.get(className) || this.objectFactory.classes.get(`models.${className}`);
                return clazz;
            }
        }

        return this.modelClass;
    }

    /**
     * Creates a new instance of obj scoped to the correct model class or sub-class.
     */
    public instantiateObject(obj: any, clazz?: any): T {
        if (!clazz) {
            clazz = this.getClassType(obj);
        }

        if (this.objectFactory) {
            return this.objectFactory.newInstance(clazz, { initialize: false, args: [obj] }) as T;
        } else {
            return new clazz(obj);
        }
    }

    /**
     * Search for existing object based on passed in id and version and product uid.
     *
     * The result of this function is compatible with all `Repository.find()` functions.
     */
    public searchIdQuery(id: string, version?: number | string, productUid?: string): any {
        return ModelUtils.buildIdSearchQuery(
            this.repo,
            this.modelClass,
            id,
            typeof version === "string" ? parseInt(version, 10) : version,
            productUid
        );
    }

    public async truncate(query: any, options: RepoFindOptions): Promise<void> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        // Check user permissions. Don't check if record-level ACLs are used as this will be done
        // per record later.
        if (this.aclUtils && !options.ignoreACL && !this.modelClass.recordACL) {
            if (!(await this.aclUtils.hasPermission(options.user, this.defaultACLUid, ACLAction.DELETE))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        try {
            let uids: Array<string> = [];
            if (this.repo instanceof MongoRepository) {
                if (Array.isArray(query)) {
                    uids = await this.repo.distinct("uid", query[0].$match);
                } else {
                    uids = await this.repo.distinct("uid", query);
                }
            } else {
                (await this.repo.find(query)).forEach((obj: T) => uids.push(obj.uid));
            }

            if (uids.length > 0) {
                let finalUids: string[] = uids;

                // Check if this class uses record level ACLs. If so, we need to check the perms of
                // each one. We will remove any from our list that the user does not have permission to
                // delete.
                if (this.modelClass.recordACL) {
                    finalUids = [];
                    for (const uid of uids) {
                        if (this.aclUtils && !options.ignoreACL) {
                            if (await this.aclUtils.hasPermission(options.user, uid, ACLAction.DELETE)) {
                                finalUids.push(uid);
                            }
                        }
                    }
                }

                // Now delete all records that were found
                if (this.repo instanceof MongoRepository) {
                    await this.repo.deleteMany({ uid: { $in: finalUids } });
                } else {
                    await this.repo.delete(finalUids);
                }

                if (!options?.skipPush) {
                    let channels: string[] = options?.pushChannels || [];
                    for (const uid of finalUids) {
                        const finalChannels: string[] = channels.concat([uid]);
                        this.notificationUtils?.sendMessage(finalChannels, this.modelClass.name, "delete", {
                            uid,
                            productUid: options.productUid,
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

    public async update(obj: Partial<T>, existing: T, options?: RepoUpdateOptions<T>): Promise<T> {
        if (!this.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        if (this.aclUtils && !options?.ignoreACL) {
            const acl: AccessControlList | null = await this.aclUtils.findACL(existing.uid);
            if (!(await this.aclUtils.hasPermission(options?.user, acl ? acl : this.defaultACLUid, ACLAction.UPDATE))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        // Enforce optimistic locking when applicable
        if (existing instanceof BaseEntity) {
            if (existing.version !== (obj as any).version) {
                throw new ApiError(ApiErrors.INVALID_OBJECT_VERSION, 409, ApiErrorMessages.INVALID_OBJECT_VERSION);
            }
        }

        // Make sure the object provided actually matches the id given
        if (existing.uid !== obj.uid) {
            throw new ApiError(ApiErrors.OBJECT_ID_MISMATCH, 400, ApiErrorMessages.OBJECT_ID_MISMATCH);
        }

        // When using MongoDB we need to copy the _id property in order to prevent duplicate entries
        if (existing instanceof BaseMongoEntity) {
            (obj as any)._id = existing._id;
        }

        const keepPrevious: boolean = !!this.modelClass.trackChanges;
        let query: any = this.searchIdQuery(
            existing.uid,
            options?.version || (obj as any).version,
            options?.productUid || (obj as any).productUid
        );
        let result: T | null = null;

        if (this.repo instanceof MongoRepository) {
            if (existing instanceof BaseEntity) {
                if (keepPrevious) {
                    result = this.instantiateObject(
                        await this.repo.save({
                            ...obj,
                            _id: undefined, // Ensure we save a new document
                            dateModified: new Date(),
                            version: (obj as any).version + 1,
                        } as any)
                    );
                } else {
                    await this.repo.updateOne(
                        { uid: obj.uid, version: (obj as any).version },
                        {
                            $set: {
                                ...obj,
                                dateModified: new Date(),
                                version: (obj as any).version + 1,
                            },
                        }
                    );
                }
            } else if (obj.uid) {
                if (keepPrevious) {
                    result = this.instantiateObject(
                        await this.repo.save({
                            ...obj,
                            version: (obj as any).version + 1,
                        } as any)
                    );
                } else {
                    await this.repo.updateOne(
                        { uid: obj.uid },
                        {
                            $set: {
                                ...obj,
                            },
                        }
                    );
                }
            } else {
                const toSave: any = obj as any;
                if (keepPrevious) {
                    toSave.version += 1;
                }

                result = await this.repo.save(toSave);
            }
        } else {
            if (existing instanceof BaseEntity) {
                if (keepPrevious) {
                    await this.repo.insert({
                        ...obj,
                        dateModified: new Date(),
                        version: (obj as any).version + 1,
                    } as any);
                } else {
                    await this.repo.update(query.where, {
                        ...obj,
                        dateModified: new Date(),
                        version: (obj as any).version + 1,
                    } as any);
                }
            } else {
                const toSave: any = obj as any;

                if (keepPrevious) {
                    toSave.version += 1;
                    result = await this.repo.save(toSave);
                } else {
                    await this.repo.update(query.where, toSave);
                }
            }
        }

        query = this.searchIdQuery(existing.uid, obj instanceof BaseEntity ? obj.version + 1 : undefined);
        if (!result) {
            if (this.repo instanceof MongoRepository) {
                result = await this.repo
                    .aggregate([
                        {
                            $match: query,
                        },
                        {
                            $sort: { version: -1 },
                        },
                    ])
                    .limit(1)
                    .next();
            } else {
                result = await this.repo.findOne(query);
            }
            if (!result) {
                throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
            }
        }

        result = this.instantiateObject(result);

        if (result && this.cacheClient && this.modelClass.cacheTTL) {
            // Cache the object for faster retrieval
            void this.cacheClient.setex(
                `${this.baseCacheKey}.${this.hashQuery(query)}`,
                this.modelClass.cacheTTL,
                JSON.stringify(result)
            );
            void this.cacheClient.setex(
                `${this.baseCacheKey}.${this.hashQuery(this.searchIdQuery(result.uid))}`,
                this.modelClass.cacheTTL,
                JSON.stringify(result)
            );
        }

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

                ObjectUtils.validate(obj, (metadataObj as any).constructor);

                // Iterate through all properties and look for `@Reference`
                for (const member of Object.getOwnPropertyNames(obj)) {
                    const clazz: any = Reflect.getMetadata("rrst:reference", metadataObj, member);
                    if (clazz && clazz.datastore && obj[member]) {
                        // Attempt to grab the repository for this reference type
                        const conn: any = this.connectionManager?.connections.get(clazz.datastore);
                        const repo: Repository<any> | undefined =
                            conn instanceof DataSource
                                ? conn.getRepository(clazz)
                                : undefined;
                        if (repo) {
                            // Check to see if there are any objects with this UID in the datastore. If the value is an array
                            // let's make sure that every uid is valid.
                            const uids: string[] = Array.isArray(obj[member]) ? obj[member] : [obj[member]];
                            const query: any = ModelUtils.buildIdSearchQuery(repo, clazz, uids);
                            const count: number = await repo.count(query);
                            if (count !== uids.length) {
                                throw new ApiError(
                                    ApiErrorMessages.INVALID_REQUEST,
                                    400,
                                    `Property ${member} is invalid. No resource found with the given identifier.`
                                );
                            }
                        }
                    }
                }
            }
        } catch (err: any) {
            throw new ApiError(ApiErrorMessages.INVALID_REQUEST, 400, err.message);
        }
    }
}
