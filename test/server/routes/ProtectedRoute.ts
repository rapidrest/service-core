///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { Logger } from "@rapidrest/core";
import { RouteDecorators } from "../../../src/decorators";
import { Description, Summary } from "../../../src/decorators/DocDecorators";
import { ACLAction } from "../../../src/security/AccessControlList";
const { Auth, Get, Protect, RequiresRole, Route, User } = RouteDecorators;

const logger = Logger();

@Route("/protected")
@Protect({
    records: [
        {
            userOrRoleId: "anonymous",
            actions: [],
        },
        {
            userOrRoleId: ".*",
            actions: [ACLAction.CREATE, ACLAction.READ, ACLAction.UPDATE, ACLAction.DELETE],
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
                actions: [ACLAction.FULL],
            },
            {
                userOrRoleId: ".*",
                actions: [ACLAction.CREATE, ACLAction.READ, ACLAction.UPDATE, ACLAction.DELETE],
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
