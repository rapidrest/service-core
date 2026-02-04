///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { default as config } from "./config.js";
import * as crypto from "crypto";
import * as request from "supertest";
import { Server, ConnectionManager, ModelUtils, ObjectFactory } from "../src/index.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoRepository, DataSource } from "typeorm";
import CacheUser from "./server/models/CacheUser.js";
import { Logger } from "@rapidrest/core";
import Redis from "ioredis-mock";

const baseCacheKey: string = "db.cache.CacheUser";
const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "rrst-test",
    },
});
const redis: any = new Redis();
let repo: MongoRepository<CacheUser>;

const createUser = async (firstName: string, lastName: string, age: number = 100): Promise<CacheUser> => {
    const user: CacheUser = new CacheUser({
        firstName,
        lastName,
        age,
    });

    return await repo.save(user);
};

const createUsers = async (num: number): Promise<CacheUser[]> => {
    const results: CacheUser[] = [];

    for (let i = 1; i <= num; i++) {
        results.push(await createUser(String(i), "Doctor", 100 * i));
    }

    return results;
};

/**
 * Hashes the given query object to a unique string.
 * @param query The query object to hash.
 */
const getCacheKey = function (query: any): string {
    return baseCacheKey + "." + crypto.createHash("sha512").update(JSON.stringify(query)).digest("hex");
};

describe("ModelRoute Tests [MongoDB with Caching]", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server(config, "./test/server", Logger(), objectFactory);

    beforeAll(async () => {
        const connMgr: ConnectionManager = await objectFactory.newInstance(ConnectionManager, {
            name: "default",
        });
        connMgr.connections.set("cache", redis);
        await mongod.start();
        await server.start();
        const conn: any = connMgr.connections.get("mongodb");
        if (conn instanceof DataSource) {
            repo = conn.getMongoRepository(CacheUser.name);
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

    describe("Single Cached Document Tests [MongoDB]", () => {
        it("Can create cached document.", async () => {
            const user: CacheUser = new CacheUser({
                firstName: "David",
                lastName: "Tennant",
                age: 47,
            });
            const result = await request(server.getApplication()).post("/cachedusers").send(user);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual(user.firstName);
            expect(result.body.lastName).toEqual(user.lastName);
            expect(result.body.age).toEqual(user.age);

            const stored: CacheUser | null = await repo.findOne({ uid: result.body.uid } as any);
            expect(stored).toBeDefined();
            if (stored) {
                expect(stored.uid).toEqual(user.uid);
                expect(stored.version).toEqual(user.version);
                expect(stored.firstName).toEqual(user.firstName);
                expect(stored.lastName).toEqual(user.lastName);
                expect(stored.age).toEqual(user.age);

                const query: any = ModelUtils.buildIdSearchQueryMongo(CacheUser, result.body.uid);
                const cacheKey: string = getCacheKey(query);
                const json: string = await redis.get(cacheKey);
                expect(json).toBeDefined();
                const parsed: CacheUser = JSON.parse(json);
                expect(parsed).toBeDefined();
                expect(parsed.uid).toEqual(stored.uid);
                expect(new Date(parsed.dateCreated)).toEqual(stored.dateCreated);
                expect(new Date(parsed.dateModified)).toEqual(stored.dateModified);
                expect(parsed.version).toEqual(stored.version);
                expect(parsed.firstName).toEqual(stored.firstName);
                expect(parsed.lastName).toEqual(stored.lastName);
                expect(parsed.age).toEqual(stored.age);
            }
        });
        it("Can delete cached document.", async () => {
            const user: CacheUser = await createUser("David", "Tennant", 47);
            const result = await request(server.getApplication()).delete("/cachedusers/" + user.uid);
            expect(result.status).toBe(204);

            const existing: CacheUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeNull();

            const query: any = ModelUtils.buildIdSearchQueryMongo(CacheUser, user.uid);
            const cacheKey: string = getCacheKey(query);
            const json: string = await redis.get(cacheKey);
            expect(json).toBeNull();
        });

        it("Can find cached document by id.", async () => {
            const user: CacheUser = await createUser("David", "Tennant", 47);
            const result = await request(server.getApplication())
                .get("/cachedusers/" + user.uid)
                .send();
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(new Date(result.body.dateCreated)).toEqual(user.dateCreated);
            expect(new Date(result.body.dateModified)).toEqual(user.dateModified);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual(user.firstName);
            expect(result.body.lastName).toEqual(user.lastName);
            expect(result.body.age).toEqual(user.age);

            const query: any = ModelUtils.buildIdSearchQueryMongo(CacheUser, result.body.uid);
            const cacheKey: string = getCacheKey(query);
            const json: string = await redis.get(cacheKey);
            expect(json).toBeDefined();
            const cachedObj: any = JSON.parse(json);
            expect(cachedObj).toBeDefined();
            expect(cachedObj.uid).toEqual(result.body.uid);
            expect(cachedObj.dateCreated).toEqual(result.body.dateCreated);
            expect(cachedObj.dateModified).toEqual(result.body.dateModified);
            expect(cachedObj.version).toEqual(result.body.version);
            expect(cachedObj.firstName).toEqual(result.body.firstName);
            expect(cachedObj.lastName).toEqual(result.body.lastName);
            expect(cachedObj.age).toEqual(result.body.age);
        });

        // The following test catches potential lookup errors from previously cached records
        it("Can find cached document by id (again).", async () => {
            const user: CacheUser = await createUser("David", "Tennant", 47);
            const result = await request(server.getApplication())
                .get("/cachedusers/" + user.uid)
                .send();
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(new Date(result.body.dateCreated)).toEqual(user.dateCreated);
            expect(new Date(result.body.dateModified)).toEqual(user.dateModified);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual(user.firstName);
            expect(result.body.lastName).toEqual(user.lastName);
            expect(result.body.age).toEqual(user.age);

            const query: any = ModelUtils.buildIdSearchQueryMongo(CacheUser, result.body.uid);
            const cacheKey: string = getCacheKey(query);
            const json: string = await redis.get(cacheKey);
            expect(json).toBeDefined();
            const cachedObj: any = JSON.parse(json);
            expect(cachedObj).toBeDefined();
            expect(cachedObj.uid).toEqual(result.body.uid);
            expect(cachedObj.dateCreated).toEqual(result.body.dateCreated);
            expect(cachedObj.dateModified).toEqual(result.body.dateModified);
            expect(cachedObj.version).toEqual(result.body.version);
            expect(cachedObj.firstName).toEqual(result.body.firstName);
            expect(cachedObj.lastName).toEqual(result.body.lastName);
            expect(cachedObj.age).toEqual(result.body.age);
        });

        it("Can update cached document.", async () => {
            const user: CacheUser = await createUser("David", "Tennant", 47);
            user.firstName = "Matt";
            user.lastName = "Smith";
            user.age = 36;
            const result = await request(server.getApplication())
                .put("/cachedusers/" + user.uid)
                .send(user);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(user.uid);
            expect(new Date(result.body.dateCreated)).toEqual(user.dateCreated);
            expect(new Date(result.body.dateModified).getTime()).toBeGreaterThan(user.dateModified.getTime());
            expect(result.body.version).toBeGreaterThan(user.version);
            expect(result.body.firstName).toBe(user.firstName);
            expect(result.body.lastName).toBe(user.lastName);
            expect(result.body.age).toBe(user.age);

            const existing: CacheUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(result.body.uid);
                expect(existing.version).toBe(result.body.version);
                expect(existing.firstName).toBe(result.body.firstName);
                expect(existing.lastName).toBe(result.body.lastName);
                expect(existing.age).toBe(result.body.age);

                const query: any = ModelUtils.buildIdSearchQueryMongo(CacheUser, user.uid);
                const cacheKey: string = getCacheKey(query);
                const json: string = await redis.get(cacheKey);
                expect(json).toBeDefined();
                const cachedObj: CacheUser = new CacheUser(JSON.parse(json));
                expect(cachedObj).toBeDefined();
                expect(cachedObj.uid).toEqual(existing.uid);
                expect(cachedObj.version).toEqual(existing.version);
                expect(cachedObj.firstName).toEqual(existing.firstName);
                expect(cachedObj.lastName).toEqual(existing.lastName);
                expect(cachedObj.age).toEqual(existing.age);
            }
        });
    });

    describe("Multiple Cached Document Tests [MongoDB]", () => {
        it("Can find all cached documents.", async () => {
            const users: CacheUser[] = await createUsers(25);

            const result = await request(server.getApplication()).get("/cachedusers");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
            for (let i = 0; i < result.body.length; i++) {
                expect(result.body[i].uid).toBe(users[i].uid);
                expect(result.body[i].age).toBe(users[i].age);
                expect(new Date(result.body[i].dateCreated)).toEqual(users[i].dateCreated);
                expect(new Date(result.body[i].dateModified)).toEqual(users[i].dateModified);
                expect(result.body[i].firstName).toBe(users[i].firstName);
                expect(result.body[i].lastName).toBe(users[i].lastName);
                expect(result.body[i].version).toBe(users[i].version);
            }

            const result2 = await request(server.getApplication()).get("/cachedusers");
            expect(result2).toHaveProperty("body");
            expect(result2.body).toHaveLength(users.length);
            expect(result.body).toEqual(result2.body);
        });

        it("Can find cached documents with criteria (eq).", async () => {
            const users: CacheUser[] = await createUsers(13);
            await createUser("David", "Tennant", 47);
            await createUser("Matt", "Smith", 36);
            const result = await request(server.getApplication()).get("/cachedusers?lastName=Doctor");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);

            const result2 = await request(server.getApplication()).get("/cachedusers?lastName=Doctor");
            expect(result2).toHaveProperty("body");
            expect(result2.body).toHaveLength(users.length);
            expect(result.body).toEqual(result2.body);
        });
    });
});
