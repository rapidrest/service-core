///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { RepoUtils } from "../models/RepoUtils.js";
import { BaseEntity } from "../models/BaseEntity.js";
import type { HttpRequest, HttpResponse } from "../http/index.js";
import { SimpleEntity } from "../models/SimpleEntity.js";
import { ApiError, type JWTUser } from "@rapidrest/core";
import { Description, Returns, Summary, TypeInfo } from "../decorators/DocDecorators.js";
import {
    Delete,
    Get,
    Head,
    Param,
    Post,
    Put,
    Query,
    Request,
    Response,
    User,
    Validate,
} from "../decorators/RouteDecorators.js";
import { ModelRoute, type UpdateObject } from "./ModelRoute.js";
import { ApiErrorMessages, ApiErrors } from "../ApiErrors.js";

/**
 * The `CRUDRoute` provides a base implementation of all CRUD endpoint behaviors that `ModelRoute` offers for a given
 * data model class. This class provides the most common default settings for each route handler. If you desire additional
 * functionality you may override the handler function and add desired functionality via additional decorators or override
 * existing decorator behavior.
 *
 * The route endpoints provided by this class do not explicitly require authentication. However, if the RBAC system
 * is enabled these handlers will still validate permissions appropriately.
 *
 * Included Endpoints:
 *
 * | Name | HTTP Method | What it does |
 * | --- | --- | --- |
 * | `count` | `HEAD /` | Counts the number of objects matching the provided set of criteria in the request's query parameters. Returns the count as the value of the `Content-Length` header. |
 * | `create` | `POST /` | Adds one or more new objects to the datastore. |
 * | `delete` | `DELETE /:id` | Removes an existing object from the datastore. |
 * | `exists` | `HEAD /:id` | Checks if the object with the given ID exists in the datastore. Sets `Content-Length` header to `1` if the object exists, otherwise `0`. |
 * | `find` | `GET /` | Returns all objects matching the provided set of criteria in the request's query parameters. |
 * | `findById` | `GET /:id` | Returns a single object with a specified unique identifier. |
 * | `truncate` | `DELETE /` | Removes all objects from the datastore. |
 * | `update` | `PUT /:id` | Modifies an existing object in the datastore. |
 * | `updateBulk` | `PUT /` | Modifies multiple existing objects in the datastore. |
 * | `updateProperty` | `PUT /:id/:property` | Modifies an single property of the given name of an existing object in the datastore. |
 *
 * @author Jean-Philippe Steinmetz
 */
export abstract class CRUDRoute<T extends BaseEntity | SimpleEntity> extends ModelRoute<T> {
    protected readonly repoUtilsClass: any = RepoUtils;

    @Summary("Count {{name}}s")
    @Description(
        "Returns the total count of {{name}}s in the datastore based on the given criteria " +
            "in the header as `Content-Length`.",
    )
    @Returns([null])
    @Head()
    public async count(
        @Param() params: any,
        @Query() query: any,
        @Response res: HttpResponse,
        @User user?: JWTUser,
    ): Promise<any> {
        return await super.doCount({ params, query, res, user });
    }

    /**
     * Override this function to perform additional custom validation of object creation. This is called
     * for each object passed to the `create()` operation.
     */
    protected validateCreate(obj: Partial<T>, @User user?: JWTUser) {
        return super.validate(obj, { user });
    }

    private async validateCreateBulk(objs: Partial<T> | Partial<T>[], @User user?: JWTUser) {
        objs = Array.isArray(objs) ? objs : [objs];

        const promises: Promise<void>[] = [];
        for (const obj of objs) {
            promises.push(this.validateCreate(obj, user));
        }

        const result = await Promise.allSettled(promises);
        const errors = result.filter((p) => p.status === "rejected").map((r) => r.reason);
        if (errors.length > 0) {
            throw new ApiError(ApiErrors.BULK_UPDATE_FAILURE, 400, ApiErrorMessages.BULK_UPDATE_FAILURE);
        }
    }

    @Summary("Create {{model}}(s)")
    @Description("Create a new {{model}}.")
    @Returns([Object])
    @Post()
    @Validate("validateCreateBulk")
    public async create(obj: T | T[], @Request req: HttpRequest, @User user?: JWTUser): Promise<T | Array<T>> {
        return await super.doCreate(obj, { req, user });
    }

    @Summary("Delete {{name}} by ID")
    @Description("Deletes the {{name}} from the service.")
    @Returns([null])
    @Delete("/:id")
    public async delete(
        @Param("id") id: string,
        @Query("version") version: string | undefined,
        @Query("purge") purge: string | undefined,
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<void> {
        return await super.doDelete(id, { user, req, version, purge: purge === "true" });
    }

    @Summary("Exists")
    @Description(
        "Returns the total count of {{name}}s in the datastore based on the given criteria " +
            "in the header as `Content-Length`.",
    )
    @Returns([null])
    @Head("/:id")
    public async exists(
        @Param("id") id: string,
        @Query() query: any,
        @Response res: HttpResponse,
        @User user?: JWTUser,
    ): Promise<any> {
        return await super.doExists(id, { query, res, user });
    }

    @Summary("Find All {{model}}s")
    @Description("Returns all {{model}}s from the system that the user has access to.")
    @Returns([[Array, Object]])
    @Get()
    public async find(@Param() params: any, @Query() query: any, @User user?: JWTUser): Promise<Array<T>> {
        return await super.doFind({ params, query, user });
    }

    @Summary("Find {{model}} by ID")
    @Description("Returns a single {{model}} from the system that the user has access to.")
    @Returns([Object])
    @Get("/:id")
    public async findById(@Param("id") id: string, @Query() query: any, @User user?: JWTUser): Promise<T | null> {
        return await super.doFindById(id, { query, user });
    }

    @Summary("Truncate {{model}}s")
    @Description("Deletes all {{model}}s from the datastore that the user has access to.")
    @Returns([null])
    @Delete()
    public async truncate(@Param() params: any, @Query() query: any, @User user?: JWTUser): Promise<void> {
        return await super.doTruncate({ params, query, user });
    }

    /**
     * Override this function to perform additional custom validation of object updates. This is called
     * for `update()` and `updateBulk()` operations. `updateBulk()` calls this function for each update
     * object.
     */
    protected async validateUpdate(@Param("id") id: string, obj: UpdateObject<T>, @User user?: JWTUser) {
        return await this.validate(obj, { user });
    }

    @Summary("Update {{model}} by ID")
    @Description("Updates a single {{model}}.")
    @Returns([Object])
    @Put("/:id")
    @Validate("validateUpdate")
    public async update(
        @Param("id") id: string,
        obj: UpdateObject<T>,
        @Request req: HttpRequest,
        @User user?: JWTUser,
    ): Promise<T> {
        return await super.doUpdate(id, obj, { user });
    }

    private async validateUpdateBulk(objs: UpdateObject<T>[], @User user?: JWTUser) {
        const promises: Promise<void>[] = [];
        for (const obj of objs) {
            promises.push(this.validateUpdate(obj.uid, obj, user));
        }

        const result = await Promise.allSettled(promises);
        const errors = result.filter((p) => p.status === "rejected").map((r) => r.reason);
        if (errors.length > 0) {
            throw new ApiError(ApiErrors.BULK_UPDATE_FAILURE, 400, ApiErrorMessages.BULK_UPDATE_FAILURE);
        }
    }

    @Summary("Update {{model}}s in bulk")
    @Description("Updates a collection of existing {{model}}s.")
    @Returns([[Array, Object]])
    @Put()
    @Validate("validateUpdateBulk")
    public async updateBulk(obj: UpdateObject<T>[], @Request req: HttpRequest, @User user?: JWTUser): Promise<T[]> {
        return await super.doBulkUpdate(obj, { user, req });
    }

    @Summary("Update {{model}} by ID and property")
    @Put(":id/:property")
    @Description("Updates a single property of an existing {{model}}.")
    @TypeInfo([Object])
    @Returns([Object])
    public async updateProperty(
        @Param("id") id: string,
        @Param("property") propertyName: string,
        obj: any,
        @User user?: JWTUser,
    ): Promise<T> {
        await this.validateUpdate(
            id,
            {
                [propertyName]: obj,
            } as UpdateObject<T>,
            user,
        );
        return await super.doUpdateProperty(id, propertyName, obj, { user });
    }
}
