///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Route, Get, User, Auth } from "../../../src/decorators/RouteDecorators";
import { JWTUser, ObjectDecorators } from "@rapidrest/core";
import { Description, Returns, Summary } from "../../../src/decorators/DocDecorators";
import { AuthMiddleware, BasicStrategy, BasicStrategyOptions, ObjectFactory, RepoUtils } from "../../../src";
import UserModel from "../models/User";
const { Init, Inject } = ObjectDecorators;

@Route("/auth")
@Description("Handles processing of all HTTP requests to the `/auth` path.")
class AuthRoute {
    @Inject(AuthMiddleware)
    private authMiddleware?: AuthMiddleware;

    @Inject(ObjectFactory)
    private objectFactory?: ObjectFactory;

    /**
     * Initializes a new instance with the specified defaults.
     */
    constructor() {
        // NO-OP
    }

    @Init
    private async initialize() {
        if (!this.authMiddleware) {
            throw new Error("authMiddleware is not set.");
        }
        if (!this.objectFactory) {
            throw new Error("objectFactory is not set.");
        }

        const options: BasicStrategyOptions = new BasicStrategyOptions();
        options.verify = async (username: string, password: string): Promise<JWTUser | undefined> => {
            const repoUtils: RepoUtils<UserModel> | undefined =
                this.objectFactory?.getInstance<RepoUtils<UserModel>>("RepoUtils:User");
            if (repoUtils) {
                const results = await repoUtils.find({ uid: username, password });
                if (results.length > 0) {
                    return results[0];
                } else {
                    throw new Error("Invalid username or password.");
                }
            }
            return undefined;
        };
        const strategy: BasicStrategy = await this.objectFactory.newInstance(BasicStrategy, {
            name: "default",
            args: [options],
        });
        this.authMiddleware.register(strategy.name, strategy);
    }

    @Summary("Request")
    @Auth(["basic"])
    @Get("basic")
    @Description("Authenticates the user using the BasicStrategy and returns the user data.")
    @Returns([Object])
    protected async authBasic(@User user?: any): Promise<any> {
        return user;
    }
}

export default AuthRoute;
