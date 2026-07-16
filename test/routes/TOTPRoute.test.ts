///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
const corsOrigins = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"];
process.env[`cors__origins`] = JSON.stringify(corsOrigins);

import { default as config } from "../config";
import { Server, ObjectFactory, MongoRepository, ConnectionManager, MongoConnection } from "../../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import { request } from "../../src/test/request.js";
import { JWTUtils, Logger } from "@rapidrest/core";
import User from "../server/models/User";
import * as uuid from "uuid";
import TOTPRoute from "../server/routes/TOTPRoute";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
vi.setConfig({ testTimeout: 1200000 });
const regenOpenapiFile = process.env["XBE_REGEN"] || false;
describe("TOTPRoute Tests", () => {
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

    it("Can authenticate with totp strategy.", async () => {
        const user: User = await createUser({
            name: "dtennant",
            firstName: "David",
            lastName: "Tennant",
            age: 47,
            password: "MyP@ssw0rd1sS3cuR3!",
        });

        let result = await request(server)
            .get("/auth/totp")
            .send(user)
            .set("Authorization", `totp ${Buffer.from(`${user.uid}`).toString("base64")}`);
        expect(result.status).toBe(200);

        const route: TOTPRoute = objectFactory.getInstance("routes.TOTPRoute:default");
        expect(route).toBeDefined();
        result = await request(server)
            .get("/auth/totp")
            .send(user)
            .set(
                "Authorization",
                `totp ${Buffer.from(`${user.uid}:${route.totpCodes.get(user.uid)}`).toString("base64")}`,
            );
        expect(result).toHaveProperty("body");
        expect(result.body.uid).toEqual(user.uid);
        expect(result.body.version).toEqual(user.version);
        expect(result.body.firstName).toEqual(user.firstName);
        expect(result.body.lastName).toEqual(user.lastName);
        expect(result.body.age).toEqual(user.age);

        const stored: User | null = await repo.findOne({ uid: result.body.uid } as any);
        expect(stored).toBeDefined();
        if (stored) {
            expect(stored.uid).toEqual(user.uid);
            expect(stored.version).toEqual(user.version);
            expect(stored.firstName).toEqual(user.firstName);
            expect(stored.lastName).toEqual(user.lastName);
            expect(stored.age).toEqual(user.age);
        }
    });

    it("Cannot authenticate with totp strategy with bad code.", async () => {
        const user: User = await createUser({
            name: "dtennant",
            firstName: "David",
            lastName: "Tennant",
            age: 47,
            password: "MyP@ssw0rd1sS3cuR3!",
        });

        let result = await request(server)
            .get("/auth/totp")
            .send(user)
            .set("Authorization", `totp ${Buffer.from(`${user.uid}`).toString("base64")}`);
        expect(result.status).toBe(200);

        result = await request(server)
            .get("/auth/totp")
            .send(user)
            .set("Authorization", `totp ${Buffer.from(`${user.uid}:bogus`).toString("base64")}`);
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(401);
    });

    it("Cannot authenticate with totp strategy using JWT token.", async () => {
        const user: User = await createUser({
            name: "dtennant",
            firstName: "David",
            lastName: "Tennant",
            age: 47,
            password: "MyP@ssw0rd1sS3cuR3!",
        });

        const token = JWTUtils.createTokenSync(config.get("auth"), {
            uid: uuid.v4(),
            roles: config.get("trusted_roles"),
        } as any);

        const result = await request(server).get("/auth/totp").send(user).set("Authorization", `jwt ${token}`);
        expect(result).toHaveProperty("status");
        expect(result.status).toBe(401);
    });
});
