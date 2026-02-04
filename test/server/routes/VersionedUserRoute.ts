///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import {
    Route,
    Get,
    Param,
    Post,
    Validate,
    Delete,
    Head,
    Put,
    Query,
    Model,
    Response,
    User,
} from "../../../src/decorators/RouteDecorators";
import { ModelRoute } from "../../../src/routes/ModelRoute.js";
import UserModel from "../models/VersionedUser.js";
import { Response as XResponse } from "express";
import { Description, Returns, TypeInfo, Summary } from "../../../src/decorators/DocDecorators.js";
import { RepoUtils } from "../../../src/index.js";

@Model(UserModel)
@Route("/versionedusers")
@Description("Handles processing of all HTTP requests for the path `/versionedusers`.")
class VersionedUserRoute extends ModelRoute<UserModel> {
    protected readonly repoUtilsClass: any = RepoUtils;

    /**
     * Initializes a new instance with the specified defaults.
     */
    constructor() {
        super();
    }

    private validate(obj: UserModel): void {
        if (!obj) {
            throw new Error("Did not receive object to validate");
        }
    }

    @Summary("Request")
    @Head()
    @Description("Returns the total number of user accounts matching the given search criteria.")
    @Returns([null])
    protected count(
        @Param() params: any,
        @Query() query: any,
        @Response res: XResponse,
        @User user?: any
    ): Promise<any> {
        return super.doCount({ params, query, res, user });
    }

    @Summary("Request")
    @Post()
    @Validate("validate")
    @Description("Creates a new user account.")
    @TypeInfo([UserModel, [Array, UserModel]])
    @Returns([UserModel, [Array, UserModel]])
    protected create(obj: UserModel | UserModel[], @User user?: any): Promise<UserModel | UserModel[]> {
        return super.doCreate(obj, { user });
    }

    @Summary("Request")
    @Delete(":id")
    @Description("Deletes an existing user account.")
    @Returns([null])
    protected delete(
        @Param("id") id: string,
        @Query("version") version?: string,
        @Query("purge") purge: string = "false",
        @User user?: any
    ): Promise<void> {
        return super.doDelete(id, { purge: purge === "true" ? true : false, version, user });
    }

    @Summary("Request")
    @Get()
    @Description("Returns all user accounts matching the given search criteria.")
    @Returns([[Array, UserModel]])
    protected findAll(@Param() params: any, @Query() query: any, @User user?: any): Promise<UserModel[]> {
        return super.doFindAll({ params, query, user });
    }

    @Summary("Request")
    @Get(":id")
    @Description("Returns the user account with the given unique identifier.")
    @Returns([UserModel])
    protected findById(@Param("id") id: string, @Query() query: any, @User user?: any): Promise<UserModel | null> {
        return super.doFindById(id, { query, user });
    }

    @Summary("Request")
    @Delete()
    @Description("Deletes all existing user accounts matching the given search criteria.")
    @Returns([null])
    protected truncate(@Param() params: any, @Query() query: any, @User user?: any): Promise<void> {
        return super.doTruncate({ params, query, user });
    }

    @Summary("Request")
    @Put(":id")
    @Validate("validate")
    @Description("Updates an existing user account.")
    @TypeInfo([UserModel])
    @Returns([UserModel])
    protected update(@Param("id") id: string, obj: UserModel, @User user?: any): Promise<UserModel> {
        return super.doUpdate(id, obj, { user });
    }
}

export default VersionedUserRoute;
