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
import { Logger } from "@rapidrest/core";
import UserModel from "../models/CacheUser.js";
import { Response as XResponse } from "express";
import { Description, Returns, Summary, TypeInfo } from "../../../src/decorators/DocDecorators.js";
import { OneOrMany, OneOrNull, RepoUtils } from "../../../src/index.js";

const logger = Logger();

@Model(UserModel)
@Route("/cachedusers")
@Description("Handles processing of all HTTP requests for the path `/cachedusers`.")
class UserRoute extends ModelRoute<UserModel> {
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

    @Summary("Count")
    @Head()
    @Description("Returns the total number of user accounts matching the given search criteria.")
    @Returns(null)
    protected async count(
        @Param() params: any,
        @Query() query: any,
        @Response res: XResponse,
        @User user?: any
    ): Promise<any> {
        return await super.doCount({ params, query, res, user });
    }

    @Summary("Create")
    @Post()
    @Validate("validate")
    @Description("Creates a new user account.")
    @TypeInfo([UserModel, [Array, UserModel]])
    @Returns([UserModel, [Array, UserModel]])
    protected async create(objs: OneOrMany<UserModel>, @User user?: any): Promise<OneOrMany<UserModel>> {
        return await super.doCreate(objs, { user });
    }

    @Summary("Delete")
    @Delete(":id")
    @Description("Deletes an existing user account.")
    @Returns(null)
    protected async delete(@Param("id") id: string, @User user?: any): Promise<void> {
        await super.doDelete(id, { user });
    }

    @Summary("FindAll")
    @Get()
    @Description("Returns all user accounts matching the given search criteria.")
    @Returns([[Array, UserModel]])
    protected async findAll(@Param() params: any, @Query() query: any, @User user?: any): Promise<UserModel[]> {
        return await super.doFindAll({ params, query, user });
    }

    @Summary("FindById")
    @Get(":id")
    @Description("Returns the user account with the given unique identifier.")
    @Returns([UserModel, null])
    protected async findById(
        @Param("id") id: string,
        @Query() query: any,
        @User user?: any
    ): Promise<OneOrNull<UserModel>> {
        return await super.doFindById(id, { query, user });
    }

    @Summary("Truncate")
    @Delete()
    @Description("Deletes all existing user accounts matching the given search criteria.")
    @Returns(null)
    protected async truncate(@Param() params: any, @Query() query: any, @User user?: any): Promise<void> {
        await super.doTruncate({ params, query, user });
    }

    @Summary("Update")
    @Put(":id")
    @Validate("validate")
    @Description("Updates an existing user account.")
    @TypeInfo(UserModel)
    @Returns(UserModel)
    protected async update(@Param("id") id: string, obj: UserModel, @User user?: any): Promise<UserModel> {
        const newObj: UserModel = new UserModel(obj);
        return await super.doUpdate(id, newObj, { user });
    }
}

export default UserRoute;
