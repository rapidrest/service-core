///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { HttpRequest, HttpResponse } from "../http/index.js";
import { AccessControlListSQL } from "./AccessControlListSQL.js";
import { ACLAction } from "./AccessControlList.js";
import { ApiError, JWTUser, UserUtils } from "@rapidrest/core";
import { UpdateObject } from "../routes/ModelRoute.js";
import { ApiErrorMessages } from "../ApiErrors.js";
import { Before, Model, Param, Query, Request, Response, Route, User } from "../decorators/RouteDecorators.js";
import { CRUDRoute } from "../routes/CRUDRoute.js";

@Model(AccessControlListSQL)
@Route("/acls")
export class ACLRouteSQL extends CRUDRoute<AccessControlListSQL> {
    protected async checkPerms(@Param() params: any, @User user: JWTUser): Promise<void> {
        if (
            !user ||
            (!UserUtils.hasRoles(user, this.config.get("trusted_roles")) &&
                !(params.id && (await this.aclUtils?.hasPermission(user, params.id, ACLAction.FULL))))
        ) {
            throw new ApiError(ApiErrorMessages.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
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
            throw new ApiError(ApiErrorMessages.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
    }

    /**
     * Bulk updates have no `:id` URI parameter to check a per-record permission against, so unlike `checkPerms`
     * we can't fall back to a per-record `FULL` permission check here. Require a trusted role for every bulk
     * update instead, and disallow touching any `default_<uid>` record (see `checkNotDefault`).
     */
    protected checkPermsBulk(objs: UpdateObject<AccessControlListSQL>[], @User user: JWTUser): void {
        if (!user) {
            throw new ApiError(ApiErrorMessages.AUTH_REQUIRED, 401, ApiErrorMessages.AUTH_REQUIRED);
        }
        if (!UserUtils.hasRoles(user, this.config.get("trusted_roles"))) {
            throw new ApiError(ApiErrorMessages.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
        }
        if (objs?.some((obj) => obj.uid && obj.uid.startsWith("default_"))) {
            throw new ApiError(ApiErrorMessages.AUTH_PERMISSION_FAILURE, 403, ApiErrorMessages.AUTH_PERMISSION_FAILURE);
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
    public create(
        obj: AccessControlListSQL | AccessControlListSQL[],
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<AccessControlListSQL | Array<AccessControlListSQL>> {
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
    public find(@Param() params: any, @Query() query: any, @User user?: JWTUser): Promise<Array<AccessControlListSQL>> {
        return super.find(params, query, user);
    }

    @Before("checkPerms")
    public async findById(
        @Param("id") id: string,
        @Query() query: any,
        @User user?: JWTUser,
    ): Promise<AccessControlListSQL | null> {
        return super.findById(id, query, user);
    }

    @Before("checkPerms")
    public truncate(@Param() params: any, @Query() query: any, @User user?: JWTUser): Promise<void> {
        return super.truncate(params, query, user);
    }

    @Before(["checkPerms", "checkNotDefault"])
    public update(
        @Param("id") id: string,
        obj: UpdateObject<AccessControlListSQL>,
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<AccessControlListSQL> {
        return super.update(id, obj, req, user);
    }

    @Before("checkPerms")
    public updateProperty(
        @Param("id") id: string,
        @Param("property") propertyName: string,
        obj: any,
        @User user?: JWTUser,
    ): Promise<AccessControlListSQL> {
        return super.updateProperty(id, propertyName, obj, user);
    }

    @Before("checkPermsBulk")
    public updateBulk(
        obj: UpdateObject<AccessControlListSQL>[],
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<AccessControlListSQL[]> {
        return super.updateBulk(obj, req, user);
    }
}
