///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Logger } from "@rapidrest/core";
import { RouteDecorators } from "../../../src/decorators/index.js";
import { Description, Summary } from "../../../src/decorators/DocDecorators.js";
const { Auth, Get, Protect, RequiresRole, Route, User } = RouteDecorators;

const logger = Logger();

@Route("/protected")
@Protect({
    records: [
        {
            userOrRoleId: "anonymous",
            create: false,
            read: false,
            update: false,
            delete: false,
            special: false,
            full: false,
        },
        {
            userOrRoleId: ".*",
            create: true,
            read: true,
            update: true,
            delete: true,
            special: false,
            full: false,
        },
    ],
})
class ProtectedDefaultRoute {
    @Summary("Request")
    @Description("Request")
    @Get("hello")
    @Protect({
        uid: "",
        records: [
            {
                userOrRoleId: "anonymous",
                create: true,
                read: true,
                update: true,
                delete: true,
                special: true,
                full: true,
            },
            {
                userOrRoleId: ".*",
                create: true,
                read: true,
                update: true,
                delete: true,
                special: false,
                full: false,
            },
        ],
    })
    protected helloWorld(): any {
        return { msg: "Hello World!" };
    }

    @Summary("Request")
    @Description("Request")
    @Get("foobar")
    protected foobar(): any {
        return { msg: "foobar" };
    }

    @Summary("Request")
    @Description("Request")
    @RequiresRole("test")
    @Get("roletest")
    protected roletest(): any {
        return { msg: "success" };
    }

    @Summary("Request")
    @Description("Request")
    @Auth(["jwt"])
    @Get("token")
    protected async authToken(@User user?: any): Promise<any> {
        return user;
    }
}

export default ProtectedDefaultRoute;
