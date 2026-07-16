///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Route, Get, User, Auth, Post } from "../../../src/decorators/RouteDecorators";
import { JWTUser, JWTUtils, ObjectDecorators } from "@rapidrest/core";
import { Description, Returns, Summary } from "../../../src/decorators/DocDecorators";
import {
    AuthMiddleware,
    OAuthProvider,
    OAuthStrategy,
    OAuthStrategyOptions,
    ObjectFactory,
    RepoUtils,
} from "../../../src";
import UserModel from "../models/User";
const { Config, Init, Inject } = ObjectDecorators;

@Route("/auth/oauth")
@Description("Handles processing of HTTP requests to the `/auth/oauth` path.")
class OAuthRoute {
    @Inject(AuthMiddleware)
    private authMiddleware?: AuthMiddleware;

    @Inject(ObjectFactory)
    private objectFactory?: ObjectFactory;

    @Config("oauth_provider")
    private provider: OAuthProvider;

    @Config("auth")
    private authConfig: any;

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

        const options: OAuthStrategyOptions = new OAuthStrategyOptions(this.provider);
        options.verify = async (profile: any, accessToken: string): Promise<JWTUser | undefined> => {
            const repoUtils: RepoUtils<UserModel> | undefined =
                this.objectFactory?.getInstance<RepoUtils<UserModel>>("RepoUtils:User");
            if (repoUtils) {
                // `id` is a REST profile-endpoint field (provider-defined shape); `sub` is the
                // spec-defined OIDC subject claim when the profile comes from a verified id_token.
                const user = await repoUtils.findOne(profile.id ?? profile.sub);
                if (user) {
                    return user as any;
                } else {
                    throw new Error("User not found");
                }
            }
            return undefined;
        };
        const strategy: OAuthStrategy = await this.objectFactory.newInstance(OAuthStrategy, {
            name: "default",
            args: [options],
        });
        this.authMiddleware.register(strategy.name, strategy);
    }

    @Summary("Request")
    @Auth(["oauth"])
    @Get()
    @Post()
    @Description("Authenticates the user using the OAuthStrategy and returns the user data.")
    @Returns([Object])
    protected async authenticate(@User user?: any): Promise<any> {
        if (!user) {
            return user;
        }
        const token: string = await JWTUtils.createToken(this.authConfig, user as JWTUser);
        return { token };
    }
}

export default OAuthRoute;
