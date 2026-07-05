///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { After, Get, Route, Param, Query, Model, User } from "../../../src/decorators/RouteDecorators";
import { ModelRoute } from "../../../src/routes/ModelRoute";
import { Logger } from "@rapidrest/core";
import UserModel from "../models/User";
import { Description, Returns, Summary } from "../../../src/decorators/DocDecorators";

const logger = Logger();

@Model(UserModel)
@Route("/users")
@Description("Handles processing of all HTTP requests for the path `/users`.")
export default class UserRoute extends ModelRoute<UserModel> {
    private cleanPII(obj: UserModel, @User user?: any): UserModel {
        if (!user) {
            obj.firstName = "";
            obj.lastName = "";
        }
        return obj;
    }

    @Summary("Find {{name}} by ID")
    @Description("Returns a single {{name}} from the system that the user has access to.")
    @Returns([Object])
    @Get("/:id")
    @After("cleanPII")
    public findById(@Param("id") id: string, @Query() query: any, @User user?: any): Promise<UserModel | null> {
        return super.findById(id, { query, user });
    }
}
