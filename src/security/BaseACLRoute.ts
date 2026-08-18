///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { HttpRequest, HttpResponse } from "../http/index.js";
import { ACLAction, type AccessControlList } from "./AccessControlList.js";
import { ApiError, UserUtils, type JWTUser } from "@rapidrest/core";
import type { UpdateObject } from "../routes/ModelRoute.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";
import { Before, Param, Query, Request, Response, User } from "../decorators/RouteDecorators.js";
import { CRUDRoute } from "../routes/CRUDRoute.js";

/**
 * The `BaseACLRoute` class provides a base set of endpoints for managing Access Control List records.
 *
 * Exposed endpoints:
 *
 * | Name | HTTP Method | What it does |
 * | --- | --- | --- |
 * | `count` | `HEAD /` | Counts the number of ACLs matching the provided set of criteria in the request's query parameters. Returns the count as the value of the `Content-Length` header. |
 * | `create` | `POST /` | Adds one or more new ACLs to the datasource. |
 * | `delete` | `DELETE /:id` | Removes an existing ACL from the datasource. |
 * | `exists` | `HEAD /:id` | Checks if the ACL with the given ID exists in the datasource. Sets `Content-Length` header to `1` if the ACL exists, otherwise `0`. |
 * | `find` | `GET /` | Returns all ACLs matching the provided set of criteria in the request's query parameters. |
 * | `findById` | `GET /:id` | Returns a single ACL with a specified unique identifier. |
 * | `truncate` | `DELETE /` | Removes all ACLs from the datasource. |
 * | `update` | `PUT /:id` | Modifies an existing ACL in the datasource. |
 * | `updateBulk` | `PUT /` | Modifies multiple existing ACLs in the datasource. |
 * | `updateProperty` | `PUT /:id/:property` | Modifies an single property of the given name of an existing ACL in the datasource. |
 *
 * !!Note!! that the `BaseACLRoute` is not automatically registered with a server by default. You must create
 * your own class that extends `BaseACLRoute` and apply the desired base path with `@Route()`.
 *
 * @example
 * ```ts
 * import { AccessControlListMongo, BaseACLRoute, RouteDecorators } from "@rapidrest/service-core";
 * const { Model, Route } = RouteDecorators;
 *
 * @Model(AccessControlListMongo)
 * @Route("/acls")
 * export class ACLRoute extends BaseACLRoute<AccessControlListMongo> {}
 * ```
 * @example
 * ```ts
 * import { AccessControlListSQL, BaseACLRoute, RouteDecorators } from "@rapidrest/service-core";
 * const { Model, Route } = RouteDecorators;
 *
 * @Model(AccessControlListSQL)
 * @Route("/acls")
 * export class ACLRoute extends BaseACLRoute<AccessControlListSQL> {}
 * ```
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class BaseACLRoute<T extends AccessControlList> extends CRUDRoute<T> {
    protected async checkPerms(@Param() params: any, @User user: JWTUser): Promise<void> {
        if (!user) {
            throw new ApiError(ApiErrors.AUTH_REQUIRED, 401, ApiErrorMessages.AUTH_REQUIRED);
        }
        if (
            !UserUtils.hasRoles(user, this.config.get("trusted_roles")) &&
            !(params.id && (await this.aclUtils?.hasPermission(user, params.id, ACLAction.FULL)))
        ) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
    }

    /**
     * The `default_<uid>` records are regenerated from code on every server startup (see
     * `ACLUtils.saveDefaultACL`) and exist solely to seed the user-editable override record. They must never be
     * deleted or modified directly, even by an administrator, since doing so would have no lasting effect and would
     * only cause confusion.
     */
    protected checkNotDefault(@Param("id") id: string): void {
        if (id && id.startsWith("default_")) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
    }

    /**
     * Bulk updates have no `:id` URI parameter to check a per-record permission against, so unlike `checkPerms`
     * we can't fall back to a per-record `FULL` permission check here. Require a trusted role for every bulk
     * update instead, and disallow touching any `default_<uid>` record (see `checkNotDefault`).
     */
    protected checkPermsBulk(objs: UpdateObject<T>[], @User user: JWTUser): void {
        if (!user) {
            throw new ApiError(ApiErrors.AUTH_REQUIRED, 401, ApiErrorMessages.AUTH_REQUIRED);
        }
        if (!UserUtils.hasRoles(user, this.config.get("trusted_roles"))) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
        if (objs?.some((obj) => obj.uid && obj.uid.startsWith("default_"))) {
            throw new ApiError(ApiErrors.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
    }

    @Before("checkPerms")
    public count(
        @Param() params: any,
        @Query() query: any,
        @Response res: HttpResponse,
        @User user?: JWTUser,
    ): Promise<any> {
        return super.count(params, query, res, user);
    }

    @Before("checkPerms")
    public create(obj: T | T[], @Request req: HttpRequest, @User user?: JWTUser): Promise<T | Array<T>> {
        return super.create(obj, req, user);
    }

    @Before(["checkPerms", "checkNotDefault"])
    public delete(
        @Param("id") id: string,
        @Query("version") version: string | undefined,
        @Query("purge") purge: string | undefined,
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<void> {
        return super.delete(id, version, purge, req, user);
    }

    @Before("checkPerms")
    public exists(
        @Param("id") id: string,
        @Query() query: any,
        @Response res: HttpResponse,
        @User user?: JWTUser,
    ): Promise<any> {
        return super.exists(id, query, res, user);
    }

    @Before("checkPerms")
    public find(@Param() params: any, @Query() query: any, @User user?: JWTUser): Promise<Array<T>> {
        return super.find(params, query, user);
    }

    @Before("checkPerms")
    public async findById(@Param("id") id: string, @Query() query: any, @User user?: JWTUser): Promise<T | null> {
        return super.findById(id, query, user);
    }

    @Before("checkPerms")
    public truncate(@Param() params: any, @Query() query: any, @User user?: JWTUser): Promise<void> {
        return super.truncate(params, query, user);
    }

    @Before(["checkPerms", "checkNotDefault"])
    public update(
        @Param("id") id: string,
        obj: UpdateObject<T>,
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<T> {
        return super.update(id, obj, req, user);
    }

    @Before(["checkPerms", "checkNotDefault"])
    public updateProperty(
        @Param("id") id: string,
        @Param("property") propertyName: string,
        obj: any,
        @User user?: JWTUser,
    ): Promise<T> {
        return super.updateProperty(id, propertyName, obj, user);
    }

    @Before("checkPermsBulk")
    public updateBulk(obj: UpdateObject<T>[], @Request req: HttpRequest, @User user?: JWTUser): Promise<T[]> {
        return super.updateBulk(obj, req, user);
    }
}
