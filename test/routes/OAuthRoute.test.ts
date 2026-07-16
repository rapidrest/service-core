///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
const corsOrigins = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];
process.env[`cors__origins`] = JSON.stringify(corsOrigins);
import * as crypto from "crypto";
import nock from "nock";
import { default as config } from "../config";
import {
    Server,
    ObjectFactory,
    MongoRepository,
    ConnectionManager,
    MongoConnection,
    OAuthProvider,
    OAuthProtocol,
    OAuthStrategy,
} from "../../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import { agent, request } from "../../src/test/request.js";
import { JWTUtils, Logger } from "@rapidrest/core";
import User from "../server/models/User";
import * as uuid from "uuid";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
vi.setConfig({ testTimeout: 1200000 });
describe("OAuthRoute Tests", () => {
    const logger = new Logger();
    const objectFactory: ObjectFactory = new ObjectFactory(config, logger);
    const server: Server = new Server({ config, basePath: "./test/server", logger, objectFactory });
    let repo: MongoRepository<any>;

    const createUser = async (data?: any): Promise<User> => {
        const user: User = new User(data);
        return await repo.save(user);
    };

    const createUsers = async (
        num: number,
        data: any = {
            lastName: "Doctor",
        },
    ): Promise<User[]> => {
        const results: User[] = [];

        for (let i = 1; i <= num; i++) {
            results.push(
                await createUser({
                    name: `user-${i}`,
                    firstName: String(i),
                    age: 100 * i,
                    ...data,
                }),
            );
        }

        return results;
    };

    beforeAll(async () => {
        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        let conn: any = connMgr?.connections.get("mongodb");
        if (conn instanceof MongoConnection) {
            repo = conn.getRepository(User);
        }
    });

    afterAll(async () => {
        await server.stop();
        await mongod.stop();
        await objectFactory.destroy();
    });

    beforeEach(async () => {
        try {
            await repo.clear();
        } catch (err) {
            // The error "ns not found" occurs when the collection doesn't exist yet. We can ignore this error.
            if (err.message !== "ns not found") {
                throw err;
            }
        }
    });

    it("Can authenticate with oauth strategy using oauth 2.0 provider.", async () => {
        const baseURL: string = "https://myoauth.com/api";
        const provider: OAuthProvider = {
            name: "oauth",
            authorizationURL: `${baseURL}/oauth2/authorize`,
            clientID: uuid.v4(),
            clientSecret: crypto.randomBytes(32).toString("base64"),
            profileURL: `${baseURL}/users/me`,
            protocol: OAuthProtocol.OAUTH2,
            redirectURI: "http://localhost",
            scope: ["email", "profile"],
            tokenURL: `${baseURL}/oauth2/token`,
        };
        const strategy: OAuthStrategy = objectFactory.getInstance(OAuthStrategy);
        (strategy as any).options.provider = provider;

        const user: User = await createUser({
            name: "dtennant",
            firstName: "David",
            lastName: "Tennant",
            age: 47,
            password: "MyP@ssw0rd1sS3cuR3!",
        });

        // Mock the OAuth 2.0 API server
        nock(baseURL).post("/oauth2/token").reply(200, {
            access_token: "6qrZcUqja7812RVdnEKjpzOL4CvHBFG",
            token_type: "Bearer",
            expires_in: 604800,
            refresh_token: "D43f5y0ahjqew82jZ4NViEr2YafMKhue",
            scope: "email profile",
        });
        nock(baseURL).get("/users/me").reply(200, {
            id: user.uid,
            username: "dtennant",
            global_name: "David Tennant",
            avatar: "fdf398fa3oi32f9f32ohfj392f83",
            verified: true,
            email: "david.tennant@gmail.com",
            flags: 64,
            banner: "f93729q0v887bf392q7f3qo9v7v9",
            accent_color: 16711680,
            premium_type: 1,
            public_flags: 64,
        });

        let result = await request(server)
            .get(`/auth/oauth?redirect_uri=${encodeURIComponent(provider.redirectURI)}&state=abcdef`)
            .set("Authorization", `totp ${Buffer.from(`${user.uid}`).toString("base64")}`);
        expect(result.status).toBe(302);
        expect(result.redirect).toBeTruthy();
        const redirectUrl: URL = new URL(result.headers.location);
        expect(redirectUrl.searchParams.has("client_id", provider.clientID)).toBeTruthy();
        expect(redirectUrl.searchParams.has("redirect_uri", provider.redirectURI)).toBeTruthy();
        expect(redirectUrl.searchParams.has("response_type", "code")).toBeTruthy();
        expect(redirectUrl.searchParams.has("scope", provider.scope.join(" "))).toBeTruthy();
        expect(redirectUrl.searchParams.has("state", "abcdef")).toBeTruthy();

        result = await request(server)
            .post(`/auth/oauth`)
            .send({
                code: "0398420348024894242",
                redirect_uri: provider.redirectURI,
                state: redirectUrl.searchParams.get("state"),
            });
        expect(result.status).toBe(200);
        expect(result.body).toBeDefined();
        const decoded: any = await JWTUtils.decodeToken(config.get("auth"), result.body.token);
        expect(decoded).toBeDefined();
        expect(decoded.profile).toBeDefined();
        expect(decoded.profile).toHaveProperty("uid");
        expect(decoded.profile.uid).toBe(user.uid);
    });

    it("Can authenticate with oauth strategy using oauth 2.0 provider with PKCE.", async () => {
        const baseURL: string = "https://myoauth.com/api";
        const provider: OAuthProvider = {
            name: "oauth",
            authorizationURL: `${baseURL}/oauth2/authorize`,
            clientID: uuid.v4(),
            clientSecret: crypto.randomBytes(32).toString("base64"),
            pkce: true,
            profileURL: `${baseURL}/users/me`,
            protocol: OAuthProtocol.OAUTH2,
            redirectURI: "http://localhost",
            scope: ["email", "profile"],
            tokenURL: `${baseURL}/oauth2/token`,
        };
        const strategy: OAuthStrategy = objectFactory.getInstance(OAuthStrategy);
        (strategy as any).options.provider = provider;

        const user: User = await createUser({
            name: "dtennant",
            firstName: "David",
            lastName: "Tennant",
            age: 47,
            password: "MyP@ssw0rd1sS3cuR3!",
        });

        // Mock the OAuth 2.0 API server
        nock(baseURL).post("/oauth2/token").reply(200, {
            access_token: "6qrZcUqja7812RVdnEKjpzOL4CvHBFG",
            token_type: "Bearer",
            expires_in: 604800,
            refresh_token: "D43f5y0ahjqew82jZ4NViEr2YafMKhue",
            scope: "email profile",
        });
        nock(baseURL).get("/users/me").reply(200, {
            id: user.uid,
            username: "dtennant",
            global_name: "David Tennant",
            avatar: "fdf398fa3oi32f9f32ohfj392f83",
            verified: true,
            email: "david.tennant@gmail.com",
            flags: 64,
            banner: "f93729q0v887bf392q7f3qo9v7v9",
            accent_color: 16711680,
            premium_type: 1,
            public_flags: 64,
        });

        // PKCE stores the code_verifier/code_challenge in a server-side session tied to a signed
        // cookie, so both requests below must share cookies — use agent() instead of request().
        const client = agent(server);

        let result = await client
            .get(`/auth/oauth?redirect_uri=${encodeURIComponent(provider.redirectURI)}&state=abcdef`)
            .set("Authorization", `totp ${Buffer.from(`${user.uid}`).toString("base64")}`);
        expect(result.status).toBe(302);
        expect(result.redirect).toBeTruthy();
        const redirectUrl: URL = new URL(result.headers.location);
        expect(redirectUrl.searchParams.has("client_id", provider.clientID)).toBeTruthy();
        expect(redirectUrl.searchParams.has("redirect_uri", provider.redirectURI)).toBeTruthy();
        expect(redirectUrl.searchParams.has("response_type", "code")).toBeTruthy();
        expect(redirectUrl.searchParams.has("scope", provider.scope.join(" "))).toBeTruthy();
        expect(redirectUrl.searchParams.has("state", "abcdef")).toBeTruthy();

        result = await client
            .post(`/auth/oauth`)
            .send({
                code: "0398420348024894242",
                redirect_uri: provider.redirectURI,
                state: redirectUrl.searchParams.get("state"),
            });
        expect(result.status).toBe(200);
        expect(result.body).toBeDefined();
        const decoded: any = await JWTUtils.decodeToken(config.get("auth"), result.body.token);
        expect(decoded).toBeDefined();
        expect(decoded.profile).toBeDefined();
        expect(decoded.profile).toHaveProperty("uid");
        expect(decoded.profile.uid).toBe(user.uid);
    });

    it("Can authenticate with oauth strategy using OpenID provider.", async () => {
        const baseURL: string = "https://myoauth.com/api";
        const provider: OAuthProvider = {
            name: "oauth",
            authorizationURL: `${baseURL}/openid/authorize`,
            clientID: uuid.v4(),
            clientSecret: crypto.randomBytes(32).toString("base64"),
            protocol: OAuthProtocol.OPENID,
            redirectURI: "http://localhost",
            scope: ["email", "profile"],
            tokenURL: `${baseURL}/openid/token`,
        };
        const strategy: OAuthStrategy = objectFactory.getInstance(OAuthStrategy);
        (strategy as any).options.provider = provider;

        const user: User = await createUser({
            name: "dtennant",
            firstName: "David",
            lastName: "Tennant",
            age: 47,
            password: "MyP@ssw0rd1sS3cuR3!",
        });

        // Mock the OpenID API server
        nock(baseURL)
            .post("/openid/token")
            .reply(200, {
                access_token: "6qrZcUqja7812RVdnEKjpzOL4CvHBFG",
                token_type: "Bearer",
                expires_in: 604800,
                refresh_token: "D43f5y0ahjqew82jZ4NViEr2YafMKhue",
                scope: "email profile",
                id_token: {
                    id: user.uid,
                },
            });

        let result = await request(server)
            .get(`/auth/oauth?redirect_uri=${encodeURIComponent(provider.redirectURI)}&state=abcdef`)
            .set("Authorization", `totp ${Buffer.from(`${user.uid}`).toString("base64")}`);
        expect(result.status).toBe(302);
        expect(result.redirect).toBeTruthy();
        const redirectUrl: URL = new URL(result.headers.location);
        expect(redirectUrl.searchParams.has("client_id", provider.clientID)).toBeTruthy();
        expect(redirectUrl.searchParams.has("redirect_uri", provider.redirectURI)).toBeTruthy();
        expect(redirectUrl.searchParams.has("response_type", "id_token code")).toBeTruthy();
        expect(redirectUrl.searchParams.has("scope", provider.scope.join(" "))).toBeTruthy();
        expect(redirectUrl.searchParams.has("state", "abcdef")).toBeTruthy();

        result = await request(server)
            .post(`/auth/oauth`)
            .send({
                code: "0398420348024894242",
                redirect_uri: provider.redirectURI,
                state: redirectUrl.searchParams.get("state"),
            });
        expect(result.status).toBe(200);
        expect(result.body).toBeDefined();
        const decoded: any = await JWTUtils.decodeToken(config.get("auth"), result.body.token);
        expect(decoded).toBeDefined();
        expect(decoded.profile).toBeDefined();
        expect(decoded.profile).toHaveProperty("uid");
        expect(decoded.profile.uid).toBe(user.uid);
    });

    it("Can authenticate with oauth strategy using OpenID provider with PKCE.", async () => {
        const baseURL: string = "https://myoauth.com/api";
        const provider: OAuthProvider = {
            name: "oauth",
            authorizationURL: `${baseURL}/openid/authorize`,
            clientID: uuid.v4(),
            clientSecret: crypto.randomBytes(32).toString("base64"),
            pkce: true,
            protocol: OAuthProtocol.OPENID,
            redirectURI: "http://localhost",
            scope: ["email", "profile"],
            tokenURL: `${baseURL}/openid/token`,
        };
        const strategy: OAuthStrategy = objectFactory.getInstance(OAuthStrategy);
        (strategy as any).options.provider = provider;

        const user: User = await createUser({
            name: "dtennant",
            firstName: "David",
            lastName: "Tennant",
            age: 47,
            password: "MyP@ssw0rd1sS3cuR3!",
        });

        // Mock the OpenID API server
        nock(baseURL)
            .post("/openid/token")
            .reply(200, {
                access_token: "6qrZcUqja7812RVdnEKjpzOL4CvHBFG",
                token_type: "Bearer",
                expires_in: 604800,
                refresh_token: "D43f5y0ahjqew82jZ4NViEr2YafMKhue",
                scope: "email profile",
                id_token: {
                    id: user.uid,
                },
            });

        // PKCE stores the code_verifier/code_challenge in a server-side session tied to a signed
        // cookie, so both requests below must share cookies — use agent() instead of request().
        const client = agent(server);

        let result = await client
            .get(`/auth/oauth?redirect_uri=${encodeURIComponent(provider.redirectURI)}&state=abcdef`)
            .set("Authorization", `totp ${Buffer.from(`${user.uid}`).toString("base64")}`);
        expect(result.status).toBe(302);
        expect(result.redirect).toBeTruthy();
        const redirectUrl: URL = new URL(result.headers.location);
        expect(redirectUrl.searchParams.has("client_id", provider.clientID)).toBeTruthy();
        expect(redirectUrl.searchParams.has("redirect_uri", provider.redirectURI)).toBeTruthy();
        expect(redirectUrl.searchParams.has("response_type", "id_token code")).toBeTruthy();
        expect(redirectUrl.searchParams.has("scope", provider.scope.join(" "))).toBeTruthy();
        expect(redirectUrl.searchParams.has("state", "abcdef")).toBeTruthy();

        result = await client
            .post(`/auth/oauth`)
            .send({
                code: "0398420348024894242",
                redirect_uri: provider.redirectURI,
                state: redirectUrl.searchParams.get("state"),
            });
        expect(result.status).toBe(200);
        expect(result.body).toBeDefined();
        const decoded: any = await JWTUtils.decodeToken(config.get("auth"), result.body.token);
        expect(decoded).toBeDefined();
        expect(decoded.profile).toBeDefined();
        expect(decoded.profile).toHaveProperty("uid");
        expect(decoded.profile.uid).toBe(user.uid);
    });
});
