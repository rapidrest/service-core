///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import {
    After,
    Before,
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
    Request,
    Response,
    User,
} from "../../../src/decorators/RouteDecorators";
import { ModelRoute } from "../../../src/routes/ModelRoute.js";
import { Logger, ObjectDecorators } from "@rapidrest/core";
import UserModel from "../models/User.js";
import { MongoRepository as Repo } from "typeorm";
import { Request as XRequest, Response as XResponse } from "express";
import { Description, Returns, TypeInfo, Summary } from "../../../src/decorators/DocDecorators.js";
import { RepoUtils } from "../../../src/index.js";
import Player from "../models/Player.js";
const { Init } = ObjectDecorators;

const logger = Logger();

@Model(UserModel)
@Route("/users")
@Description("Handles processing of all HTTP requests for the path `/users`.")
class UserRoute extends ModelRoute<UserModel> {
    protected repo?: Repo<UserModel | Player>;
    protected readonly repoUtilsClass: any = RepoUtils;

    /**
     * Initializes a new instance with the specified defaults.
     */
    constructor() {
        super();
    }

    @Init
    private async initialize() {
        if (this.repo) {
            logger.info("Calling init counting users " + (await this.repo.count()));
        }
    }

    private validate(obj: UserModel | UserModel[]): Promise<void> {
        return super.doValidate(obj);
    }

    private cleanPII(obj: UserModel, @User user?: any): UserModel {
        if (!user) {
            obj.firstName = "";
            obj.lastName = "";
        }
        return obj;
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
    protected create(
        objs: UserModel | UserModel[],
        @Request req: XRequest,
        @User user?: any
    ): Promise<UserModel | UserModel[]> {
        return super.doCreate(objs, { req, user });
    }

    @Summary("Request")
    @Put()
    @Validate("validate")
    @Description("Updates multiple user accounts in bulk.")
    @TypeInfo([[Array, UserModel]])
    @Returns([[Array, UserModel]])
    protected updateBulk(objs: UserModel[], @User user?: any): Promise<UserModel[]> {
        return super.doBulkUpdate(objs, { user });
    }

    @Summary("Request")
    @Delete(":id")
    @Description("Deletes an existing user account.")
    @Returns([null])
    protected async delete(@Param("id") id: string, @User user?: any): Promise<void> {
        await super.doDelete(id, { user });
    }

    @Summary("Request")
    @Head(":id")
    @Description(
        "Returns a boolean integer indicating whether or not a user account with the given unique identifier exists."
    )
    @Returns([null])
    protected exists(
        @Param("id") id: string,
        @Query() query: any,
        @Response res: XResponse,
        @User user?: any
    ): Promise<any> {
        return super.doExists(id, { query, res, user });
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
    @After("cleanPII")
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
    @Before("validate")
    @Description("Updates an existing user account.")
    protected update(@Param("id") id: string, obj: UserModel, @User user?: any): Promise<UserModel> {
        return super.doUpdate(id, obj, { user });
    }

    @Summary("Request")
    @Put(":id/:property")
    @Before("validate")
    @Description("Updates a single property of an existing user account.")
    @TypeInfo([Object])
    @Returns([UserModel])
    protected updateProperty(
        @Param("id") id: string,
        @Param("property") propertyName: string,
        obj: any,
        @User user?: any
    ): Promise<UserModel> {
        return super.doUpdateProperty(id, propertyName, obj, { user });
    }
}

export default UserRoute;
