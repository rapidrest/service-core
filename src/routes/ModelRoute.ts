///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { ModelUtils } from "../models/ModelUtils.js";
import { RepoOperationOptions, RepoUtils } from "../models/RepoUtils.js";
import { BaseEntity } from "../models/BaseEntity.js";
import { Redis } from "ioredis";
import { RedisConnection } from "../decorators/DatabaseDecorators.js";
import { Request as XRequest, Response as XResponse } from "express";
import { SimpleEntity } from "../models/SimpleEntity.js";
import { BulkError } from "../BulkError.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import { ApiError, Event, EventUtils, ObjectDecorators } from "@rapidrest/core";
import { AccessControlList, ACLAction } from "../security/AccessControlList.js";
import { ACLUtils } from "../security/ACLUtils.js";
import { NotificationUtils } from "../NotificationUtils.js";
import { NetUtils } from "../NetUtils.js";
import { ObjectFactory } from "../ObjectFactory.js";
const { Config, Init, Inject, Logger } = ObjectDecorators;

/**
 * The set of options required by all request handlers.
 */
export interface RequestOptions extends RepoOperationOptions {
    /** The originating client request. */
    req?: XRequest;
    /** The outgoing client response. */
    res?: XResponse;
}

/**
 * The set of options required by create request handlers.
 */
export interface CreateRequestOptions extends RequestOptions {
    acl?: AccessControlList | AccessControlList[];
    /** An additional list of channel names to send push notifications to. */
    pushChannels?: string[];
    /** Set to `true` to not send a push notification. */
    skipPush?: boolean;
}

/**
 * The set of options required by delete request handlers.
 */
export interface DeleteRequestOptions extends RequestOptions {
    /** The desired product uid of the resource to delete. */
    productUid?: string;
    /** Set to true to permanently remove the object from the database (if applicable). */
    purge?: boolean;
    /** An additional list of channel names to send push notifications to. */
    pushChannels?: string[];
    /** Set to `true` to not send a push notification. */
    skipPush?: boolean;
    /** The desired version number of the resource to delete. */
    version?: number | string;
}

/**
 * The set of options required by search request handlers.
 */
export interface FindRequestOptions extends RequestOptions {
    /** The list of URL parameters to use in the search. */
    params?: any;
    /** The list of query parameters to use in the search. */
    query: any;
}

/**
 * The set of options required by truncate request handlers.
 */
export interface TruncateRequestOptions extends DeleteRequestOptions {
    /** The list of URL parameters to use in the search. */
    params: any;
    /** An additional list of channel names to send push notifications to. */
    pushChannels?: string[];
    /** The list of query parameters to use in the search. */
    query: any;
    /** Set to `true` to not send a push notification. */
    skipPush?: boolean;
}

/** A Partial type for a BaseEntity or SimpleEntity. */
export type UpdateObject<T extends BaseEntity | SimpleEntity> = Partial<T> & Pick<T, "uid">;

/**
 * The set of options required by update request handlers.
 */
export interface UpdateRequestOptions<T extends BaseEntity | SimpleEntity> extends RequestOptions {
    /** The existing object that has already been recently pulled from the datastore. */
    existing?: T | null;
    /** The desired product uid of the resource to update. */
    productUid?: string;
    /** An additional list of channel names to send push notifications to. */
    pushChannels?: string[];
    /** Set to `true` to not send a push notification. */
    skipPush?: boolean;
    /** The desired version number of the resource to update. */
    version?: number | string;
}

/**
 * The `ModelRoute` is an abstract base class that provides a set of built-in route behavior functions for handling
 * requests for a given data model that is managed by a persistent datastore.
 *
 * Provided behaviors:
 * * `count` - Counts the number of objects matching the provided set of criteria in the request's query parameters.
 * * `create` - Adds a new object to the datastore.
 * * `delete` - Removes an existing object from the datastore.
 * * `find` - Finds all objects matching the provided set of criteria in the request's query parameters.
 * * `findById` - Finds a single object with a specified unique identifier.
 * * `truncate` - Removes all objects from the datastore.
 * * `update` - Modifies an existing object in the datastore.
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class ModelRoute<T extends BaseEntity | SimpleEntity> {
    @Inject(ACLUtils)
    protected aclUtils?: ACLUtils;

    /** The redis client that will be used as a 2nd level cache for all cacheable models. */
    @RedisConnection("cache")
    protected cacheClient?: Redis;

    /** The global application configuration. */
    @Config()
    protected config?: any;

    /** The unique identifier of the default ACL for the model type. */
    protected defaultACLUid: string = "";

    @Logger
    protected logger: any;

    @Inject(NotificationUtils)
    protected notificationUtils?: NotificationUtils;

    @Inject(ObjectFactory)
    protected objectFactory?: ObjectFactory;

    /** The class of the RepoUtils to use when instantiating the utility. */
    protected readonly abstract repoUtilsClass: any;

    /** The repository utility class to use for common operations. */
    protected repoUtils?: RepoUtils<T>;

    /**
     * The number of previous document versions to store in the database. A negative value indicates storing all
     * versions, a value of `0` stores no versions.
     */
    protected trackChanges: number = 0;

    @Config("trusted_roles", ["admin"])
    protected trustedRoles: string[] = ["admin"];

    /**
     * The class type of the model this route is associated with.
     */
    protected get modelClass(): any {
        const clazz: any = Object.getPrototypeOf(this).constructor;
        return clazz.modelClass;
    }

    /**
     * Called on server startup to initialize the route with any defaults.
     */
    @Init
    private async superInitialize() {
        if (!this.objectFactory) {
            throw new Error("objectFactory is not set!");
        }

        this.repoUtils = await this.objectFactory.newInstance(this.repoUtilsClass || RepoUtils, {
            name: this.modelClass.name,
            initialize: true,
            args: [this.modelClass],
        });

        let defaultAcl: AccessControlList | undefined = this.repoUtils.getDefaultACL();
        if (defaultAcl) {
            this.defaultACLUid = defaultAcl.uid;
        }
    }

    /**
     * Attempts to retrieve the number of data model objects matching the given set of criteria as specified in the
     * request `query`. Any results that have been found are set to the `content-length` header of the `res` argument.
     *
     * @param options The options to process the request using.
     */
    protected async doCount(options: FindRequestOptions): Promise<XResponse> {
        if (!this.repoUtils) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        if (!options.res) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const searchQuery: any = ModelUtils.buildSearchQuery(
            this.modelClass,    
            this.repoUtils.repo,
            options.params,
            options.query,
            true,
            options.user
        );
        const result: number = await this.repoUtils.count(searchQuery, {
            limit: options.query?.limit,
            page: options.query?.page,
            productUid: options.params?.productUid || options.query?.productUid,
            version: options.params?.version || options.query?.version,
            user: options.user,
        });
        options.res.setHeader("content-length", result);

        return options.res.status(200);
    }

    /**
     * Attempts to store an object provided in `options.req.body` into the datastore. Upon success, sets the newly persisted
     * object(s) to the `result` property of the `options.res` argument, otherwise sends a `400 BAD REQUEST` response to the
     * client.
     *
     * @param obj The object to store in the database.
     * @param options The options to process the request using.
     */
    protected async doCreateObject(obj: Partial<T>, options: CreateRequestOptions): Promise<T> {
        if (!this.repoUtils) {
            throw new Error("repoUtils not set!");
        }

        // Make sure the provided object has the correct typing
        let result: T = this.repoUtils.instantiateObject(obj);
        result = await this.repoUtils.create(result, options as any);

        if (options.recordEvent) {
            const evt: any = {
                type: `Create${this.modelClass.name}`,
                objectUid: result.uid,
                userUid: options.user ? options.user.uid : undefined,
                ip: options.req ? NetUtils.getIPAddress(options.req) : undefined,
            };
            void EventUtils.record(new Event(this.config, options.user ? options.user.uid : "anonymous", evt));
        }

        return result;
    }

    /**
     * Attempts to store a collection of objects provided in `options.req.body` into the datastore. Upon success, sets the newly persisted
     * object(s) to the `result` property of the `options.res` argument, otherwise sends a `400 BAD REQUEST` response to the
     * client.
     *
     * @param objs The object(s) to store in the database.
     * @param options The options to process the request using.
     */
    protected async doBulkCreate(objs: Partial<T>[], options: CreateRequestOptions): Promise<T[]> {
        let thrownError: boolean = false;
        const errors: (Error | null)[] = [];
        const results: T[] = [];

        for (const obj of objs) {
            try {
                results.push(await this.doCreateObject(obj, options));
                errors.push(null);
            } catch (err: any) {
                errors.push(err);
                thrownError = true;
            }
        }

        if (thrownError) {
            throw new BulkError(errors, ApiErrors.BULK_CREATE_FAILURE, 400, ApiErrorMessages.BULK_CREATE_FAILURE);
        }

        return results;
    }

    /**
     * Attempts to store one or more objects provided in `options.req.body` into the datastore. Upon success, sets the newly persisted
     * object(s) to the `result` property of the `options.res` argument, otherwise sends a `400 BAD REQUEST` response to the
     * client.
     *
     * @param obj The object(s) to store in the database.
     * @param options The options to process the request using.
     */
    protected async doCreate(obj: Partial<T> | Partial<T>[], options: CreateRequestOptions): Promise<T | T[]> {
        if (!(await this.aclUtils?.hasPermission(options.user, this.defaultACLUid, ACLAction.CREATE))) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }

        if (Array.isArray(obj)) {
            return await this.doBulkCreate(obj, {
                ...options,
                ignoreACL: true,
            });
        } else {
            return await this.doCreateObject(obj, {
                ...options,
                ignoreACL: true,
            });
        }
    }

    /**
     * Attempts to delete an existing data model object with a given unique identifier encoded by the URI parameter
     * `id`.
     *
     * @param id The unique identifier of the object to delete.
     * @param options The options to process the request using.
     */
    protected async doDelete(id: string, options: DeleteRequestOptions): Promise<void> {
        if (!this.repoUtils || !this.repoUtils.repo) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        // When id === `me` this is a special keyword meaning the authenticated user
        if (id.toLowerCase() === "me") {
            if (options.user) {
                id = options.user.uid;
            } else {
                throw new ApiError(
                    ApiErrors.SEARCH_INVALID_ME_REFERENCE,
                    403,
                    ApiErrorMessages.SEARCH_INVALID_ME_REFERENCE
                );
            }
        }

        const existing: T | undefined = await this.repoUtils.findOne(id, {
            productUid: options.productUid,
            version: options.version,
        });
        if (!existing) {
            throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
        }
        await this.repoUtils.delete(existing.uid, options as any);

        if (options.recordEvent) {
            const count: number = await this.repoUtils.repo.count({ uid: existing.uid } as any);
            const evt: any = {
                type: `Delete${this.modelClass.name}`,
                objectUid: existing.uid,
                userUid: options.user ? options.user.uid : "anonymous",
                ip: options.req ? NetUtils.getIPAddress(options.req) : undefined,
                purged: count === 0,
            };
            void EventUtils.record(new Event(this.config, options.user ? options.user.uid : "anonymous", evt));
        }
    }

    /**
     * Attempts to determine if an existing object with the given unique identifier exists.
     *
     * @param id The unique identifier of the object to verify exists.
     * @param options The options to process the request using.
     */
    protected async doExists(id: string, options: FindRequestOptions): Promise<any> {
        if (!this.repoUtils || !options.res) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        // When id === `me` this is a special keyword meaning the authenticated user
        if (id.toLowerCase() === "me") {
            if (options.user) {
                id = options.user.uid;
            } else {
                throw new ApiError(
                    ApiErrors.SEARCH_INVALID_ME_REFERENCE,
                    403,
                    ApiErrorMessages.SEARCH_INVALID_ME_REFERENCE
                );
            }
        }

        // Check user permissions
        if (this.aclUtils && !options.ignoreACL) {
            if (!(await this.aclUtils.hasPermission(options.user, this.defaultACLUid, ACLAction.READ))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        const query: any = this.repoUtils.searchIdQuery(id, options.query.version);
        const result: number = await this.repoUtils.count(query);
        if (result > 0) {
            return options.res.status(200).setHeader("content-length", result);
        } else {
            return options.res.status(404);
        }
    }

    /**
     * Attempts to retrieve all data model objects matching the given set of criteria as specified in the request
     * `query`. Any results that have been found are set to the `result` property of the `res` argument. `result` is
     * never null.
     *
     * @param options The options to process the request using.
     */
    protected async doFindAll(options: FindRequestOptions): Promise<T[]> {
        if (!this.repoUtils) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        // Check user permissions
        if (this.aclUtils && !options.ignoreACL) {
            if (!(await this.aclUtils.hasPermission(options.user, this.defaultACLUid, ACLAction.READ))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        const searchQuery: any = ModelUtils.buildSearchQuery(
            this.modelClass,
            this.repoUtils.repo,
            options.params,
            options.query,
            true,
            options.user
        );

        return await this.repoUtils.find(searchQuery, {
            limit: options.query?.limit,
            page: options.query?.page,
            productUid: options.params?.productUid || options.query?.productUid,
            version: options.params?.version || options.query?.version,
            user: options.user,
        });
    }

    /**
     * Attempts to retrieve a single data model object as identified by the `id` parameter in the URI.
     *
     * @param options The options to process the request using.
     */
    protected async doFindById(id: string, options: FindRequestOptions): Promise<T | null> {
        if (!this.repoUtils) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        // When id === `me` this is a special keyword meaning the authenticated user
        if (id.toLowerCase() === "me") {
            if (options.user) {
                id = options.user.uid;
            } else {
                throw new ApiError(
                    ApiErrors.SEARCH_INVALID_ME_REFERENCE,
                    403,
                    ApiErrorMessages.SEARCH_INVALID_ME_REFERENCE
                );
            }
        }

        const result: T | undefined = await this.repoUtils.findOne(id, {
            productUid: options.params?.productUid || options.query?.productUid,
            version: options.params?.version || options.query?.version,
        });
        if (!result) {
            throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
        }

        if (this.aclUtils && !options.ignoreACL) {
            const acl: AccessControlList | null = await this.aclUtils.findACL(result.uid);
            if (!(await this.aclUtils.hasPermission(options.user, acl ? acl : this.defaultACLUid, ACLAction.READ))) {
                throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
            }
        }

        return result;
    }

    /**
     * Attempts to remove all entries of the data model type from the datastore matching the given
     * parameters and query.
     *
     * @param options The options to process the request using.
     */
    protected async doTruncate(options: TruncateRequestOptions): Promise<void> {
        if (!this.repoUtils) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        const searchQuery: any = ModelUtils.buildSearchQuery(
            this.modelClass,
            this.repoUtils.repo,
            options.params,
            options.query,
            true,
            options.user
        );

        await this.repoUtils?.truncate(searchQuery, {
            limit: options.query?.limit,
            page: options.query?.page,
            productUid: options.params?.productUid || options.query?.productUid,
            pushChannels: options.pushChannels,
            skipPush: options.skipPush,
            version: options.params?.version || options.query?.version,
            user: options.user,
        });

        if (options.recordEvent) {
            const evt: any = {
                type: `Truncate${this.modelClass.name}`,
                userUid: options.user ? options.user.uid : "anonymous",
                ip: options.req ? NetUtils.getIPAddress(options.req) : undefined,
            };
            void EventUtils.record(new Event(this.config, options.user ? options.user.uid : "anonymous", evt));
        }
    }

    /**
     * Attempts to modify a collection of existing data model objects.
     *
     * @param objs The object(s) to bulk update in the database.
     * @param options The options to process the request using.
     */
    protected async doBulkUpdate(objs: UpdateObject<T>[], options: UpdateRequestOptions<T>): Promise<T[]> {
        let thrownError: boolean = false;
        const errors: (Error | null)[] = [];
        const result: T[] = [];

        for (const obj of objs) {
            try {
                result.push(await this.doUpdate(obj.uid, obj, options));
                errors.push(null);
            } catch (err: any) {
                errors.push(err);
                thrownError = true;
            }
        }

        if (thrownError) {
            throw new BulkError(errors, ApiErrors.BULK_UPDATE_FAILURE, 400, ApiErrorMessages.BULK_UPDATE_FAILURE);
        }

        return result;
    }

    /**
     * Attempts to modify an existing data model object as identified by the `id` parameter in the URI.
     *
     * @param obj The object to update in the database
     * @param options The options to process the request using.
     */
    protected async doUpdate(id: string, obj: UpdateObject<T>, options: UpdateRequestOptions<T>): Promise<T> {
        if (!this.repoUtils) {
            throw new ApiError(ApiErrors.INTERNAL_ERROR, 500, ApiErrorMessages.INTERNAL_ERROR);
        }

        // When id === `me` this is a special keyword meaning the authenticated user
        if (id.toLowerCase() === "me") {
            if (options.user) {
                id = options.user.uid;
            } else {
                throw new ApiError(
                    ApiErrors.SEARCH_INVALID_ME_REFERENCE,
                    403,
                    ApiErrorMessages.SEARCH_INVALID_ME_REFERENCE
                );
            }
        }

        const existing: T | undefined = await this.repoUtils.findOne(id, {
            productUid: options.productUid || (obj as any).productUid,
            skipCache: true,
        });
        if (!existing) {
            throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
        }

        const result: T = await this.repoUtils.update(obj, existing, options as any);

        if (options.recordEvent) {
            const evt: any = {
                type: `Update${this.modelClass.name}`,
                objectUid: obj.uid,
                userUid: options.user ? options.user.uid : "anonymous",
                ip: options.req ? NetUtils.getIPAddress(options.req) : undefined,
            };
            void EventUtils.record(new Event(this.config, options.user ? options.user.uid : "anonymous", evt));
        }

        return result;
    }

    /**
     * Attempts to modify a single property of an existing data model object as identified by the `id` parameter in the URI.
     *
     * Note that this effectively bypasses optimistic locking and can cause unexpected data overwrites. Use with care.
     *
     * @param id The unique identifier of the object to update.
     * @param propertyName The name of the property to update.
     * @param value The value of the property to set.
     * @param options The options to process the request using.
     */
    protected async doUpdateProperty(
        id: string,
        propertyName: string,
        value: any,
        options: UpdateRequestOptions<T>
    ): Promise<T> {
        // When id === `me` this is a special keyword meaning the authenticated user
        if (id.toLowerCase() === "me") {
            if (options.user) {
                id = options.user.uid;
            } else {
                throw new ApiError(
                    ApiErrors.SEARCH_INVALID_ME_REFERENCE,
                    403,
                    ApiErrorMessages.SEARCH_INVALID_ME_REFERENCE
                );
            }
        }

        const existing: T | null | undefined =
            options.existing ||
            (await this.repoUtils?.findOne(id, {
                productUid: options.productUid,
            }));
        if (!existing) {
            throw new ApiError(ApiErrors.NOT_FOUND, 404, ApiErrorMessages.NOT_FOUND);
        }

        return await this.doUpdate(
            id,
            {
                uid: existing.uid,
                productUid: options.productUid || "productUid" in existing ? (existing as any).productUid : undefined,
                version: options.version || "version" in existing ? (existing as any).version : undefined,
                [propertyName]: value,
            } as any,
            {
                ...options,
                existing,
            }
        );
    }

    /**
     * Calls `repoUtils.validate()` to validate the object(s) provided.
     */
    protected async doValidate(objs: Partial<T> | Partial<T>[], options?: CreateRequestOptions | UpdateRequestOptions<T>): Promise<void> {
        await this.repoUtils?.validate(objs, options);
    }
}
