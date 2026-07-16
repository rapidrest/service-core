///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import { Route, Get, User, Auth } from "../../../src/decorators/RouteDecorators";
import { JWTUser, ObjectDecorators } from "@rapidrest/core";
import { Description, Returns, Summary } from "../../../src/decorators/DocDecorators";
import { AuthMiddleware, TOTPStrategy, TOTPStrategyOptions, ObjectFactory, RepoUtils } from "../../../src";
import UserModel from "../models/User";
const { Init, Inject } = ObjectDecorators;

@Route("/auth")
@Description("Handles processing of HTTP requests to the `/auth/totp` path.")
class TOTPRoute {
    @Inject(AuthMiddleware)
    private authMiddleware?: AuthMiddleware;

    @Inject(ObjectFactory)
    private objectFactory?: ObjectFactory;

    public readonly totpCodes: Map<string, string> = new Map();

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

        const options: TOTPStrategyOptions = new TOTPStrategyOptions();
        options.notify = async (uid: string): Promise<void> => {
            const repoUtils: RepoUtils<UserModel> | undefined =
                this.objectFactory?.getInstance<RepoUtils<UserModel>>("RepoUtils:User");
            if (repoUtils) {
                const user = await repoUtils.findOne(uid);
                if (user) {
                    const totp = String(Math.random() * 100000);
                    this.totpCodes.set(user.uid, totp);
                } else {
                    throw new Error("User not found");
                }
            }
        };
        options.verify = async (uid: string, totp: string): Promise<JWTUser | undefined> => {
            const repoUtils: RepoUtils<UserModel> | undefined =
                this.objectFactory?.getInstance<RepoUtils<UserModel>>("RepoUtils:User");
            if (repoUtils) {
                const user = await repoUtils.findOne(uid);
                if (user) {
                    const code = this.totpCodes.get(user.uid);
                    if (totp === code) {
                        return user as any;
                    }
                } else {
                    throw new Error("User not found");
                }
            }
            return undefined;
        };
        const strategy: TOTPStrategy = await this.objectFactory.newInstance(TOTPStrategy, {
            name: "default",
            args: [options],
        });
        this.authMiddleware.register(strategy.name, strategy);
    }

    @Summary("Request")
    @Auth(["totp"])
    @Get("totp")
    @Description("Authenticates the user using the TOTPStrategy and returns the user data.")
    @Returns([Object])
    protected async authBasic(@User user?: any): Promise<any> {
        return user;
    }
}

export default TOTPRoute;
