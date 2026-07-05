///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import type { HttpRequest, HttpResponse } from "../http/index.js";
import { AccessControlListMongo } from "./AccessControlListMongo.js";
import { ACLAction } from "./AccessControlList.js";
import { ApiError, JWTUser, UserUtils } from "@rapidrest/core";
import { ModelRoute, UpdateObject } from "../routes/ModelRoute.js";
import { ApiErrorMessages } from "../ApiErrors.js";
import { Before, Model, Param, Query, Request, Response, Route, User } from "../decorators/RouteDecorators.js";

@Model(AccessControlListMongo)
@Route("/acls")
export class ACLRouteMongo extends ModelRoute<AccessControlListMongo> {
    protected async checkPerms(@Param() params: any, @User user: JWTUser): Promise<void> {
        if (!user) {
            throw new ApiError(ApiErrorMessages.AUTH_REQUIRED, 401, ApiErrorMessages.AUTH_REQUIRED);
        }
        if (
            !UserUtils.hasRoles(user, this.config.get("trusted_roles")) &&
            !(params.id && (await this.aclUtils?.hasPermission(user, params.id, ACLAction.FULL)))
        ) {
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
        obj: AccessControlListMongo | AccessControlListMongo[],
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<AccessControlListMongo | Array<AccessControlListMongo>> {
        return super.create(obj, req, user);
    }

    @Before("checkPerms")
    public delete(@Param("id") id: string, @Request req: HttpRequest, @User user?: JWTUser): Promise<void> {
        return super.delete(id, req, user);
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
    public findAll(
        @Param() params: any,
        @Query() query: any,
        @User user?: JWTUser,
    ): Promise<Array<AccessControlListMongo>> {
        return super.findAll(params, query, user);
    }

    @Before("checkPerms")
    public async findById(
        @Param("id") id: string,
        @Query() query: any,
        @User user?: JWTUser,
    ): Promise<AccessControlListMongo | null> {
        return super.findById(id, query, user);
    }

    @Before("checkPerms")
    public truncate(@Param() params: any, @Query() query: any, @User user?: JWTUser): Promise<void> {
        return super.truncate(params, query, user);
    }

    @Before("checkPerms")
    public update(
        @Param("id") id: string,
        obj: UpdateObject<AccessControlListMongo>,
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<AccessControlListMongo> {
        return super.update(id, obj, req, user);
    }

    @Before("checkPerms")
    public updateProperty(
        @Param("id") id: string,
        @Param("property") propertyName: string,
        obj: any,
        @User user?: JWTUser,
    ): Promise<AccessControlListMongo> {
        return super.updateProperty(id, propertyName, obj, user);
    }
}
