///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Logger } from "@rapidrest/core";
import UserModel from "../models/ProtectedUser.js";
import { Response as XResponse } from "express";
import { DocDecorators, RouteDecorators } from "../../../src/decorators/index.js";
import { ModelRoute } from "../../../src/routes/ModelRoute.js";
import { RepoUtils } from "../../../src/models/index.js";
const { Description, Summary } = DocDecorators;
const { Route, Get, Post, Validate, Delete, Head, Put, Param, User, Query, Response, Before, Model } = RouteDecorators;

const logger = Logger();

@Model(UserModel)
@Route("/userswithacl")
class UserWithACLRoute extends ModelRoute<UserModel> {
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
    @Description("Request")
    @Head()
    protected async count(
        @Param() params: any,
        @Query() query: any,
        @Response res: XResponse,
        @User user?: any
    ): Promise<any> {
        return await super.doCount({ params, query, res, user });
    }

    @Summary("Request")
    @Description("Request")
    @Post()
    @Validate("validate")
    protected async create(obj: UserModel | UserModel[], @User user?: any): Promise<UserModel | UserModel[]> {
        return await super.doCreate(obj, { user });
    }

    @Summary("Request")
    @Description("Request")
    @Delete(":id")
    protected async delete(@Param("id") id: string, @User user?: any): Promise<void> {
        await super.doDelete(id, { user });
    }

    @Summary("Request")
    @Description("Request")
    @Get()
    protected async findAll(@Param() params: any, @Query() query: any, @User user?: any): Promise<UserModel[]> {
        return await super.doFindAll({ params, query, user });
    }

    @Summary("Request")
    @Description("Request")
    @Get(":id")
    protected async findById(
        @Param("id") id: string,
        @Query() query: any,
        @User user?: any
    ): Promise<UserModel | null> {
        return await super.doFindById(id, { query, user });
    }

    @Summary("Request")
    @Description("Request")
    @Delete()
    protected async truncate(@Param() params: any, @Query() query: any, @User user?: any): Promise<void> {
        await super.doTruncate({ params, query, user });
    }

    @Summary("Request")
    @Description("Request")
    @Put(":id")
    @Before("validate")
    protected async update(@Param("id") id: string, obj: UserModel, @User user?: any): Promise<UserModel> {
        const newObj: UserModel = new UserModel(obj);
        return await super.doUpdate(id, newObj, { user });
    }
}

export default UserWithACLRoute;
