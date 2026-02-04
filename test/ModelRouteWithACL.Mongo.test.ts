///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import config from "./config.js";
import * as request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import ProtectedUser from "./server/models/ProtectedUser.js";
import { MongoRepository, DataSource } from "typeorm";
import { JWTUtils, Logger, EventUtils } from "@rapidrest/core";
import { AccessControlListMongo } from "../src/security/AccessControlListMongo.js";
import { ACLRecord } from "../src/security/index.js";
import { Server } from "../src/Server.js";
import { ObjectFactory } from "../src/ObjectFactory.js";
import { ConnectionManager } from "../src/database/ConnectionManager.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
    },
});
let repo: MongoRepository<ProtectedUser>;
let aclRepo: MongoRepository<AccessControlListMongo>;

const createUser = async (obj: any, ownerUid?: string): Promise<ProtectedUser> => {
    const user: ProtectedUser = new ProtectedUser({
        ...obj,
    });

    const result: ProtectedUser = await repo.save(user);

    const records: ACLRecord[] = [];

    // The owner full CRUD access
    records.push({
        userOrRoleId: ownerUid || user.uid,
        create: true,
        read: true,
        update: true,
        delete: true,
        special: false,
        full: false,
    });

    // Guests have create-only access
    records.push({
        userOrRoleId: "anonymous",
        create: true,
        read: false,
        update: false,
        delete: false,
        special: false,
        full: false,
    });

    // Everyone has read-only access
    records.push({
        userOrRoleId: ".*",
        create: false,
        read: true,
        update: false,
        delete: false,
        special: false,
        full: false,
    });

    const acl: any = {
        uid: user.uid,
        dateCreated: new Date(),
        dateModified: Date.now(),
        version: 0,
        records,
        parentUid: "ProtectedUser",
    };
    await aclRepo.save(aclRepo.create(acl));

    return result;
};

const createUsers = async (num: number, obj: any = {}, ownerUid?: string): Promise<ProtectedUser[]> => {
    const results: ProtectedUser[] = [];

    for (let i = 1; i <= num; i++) {
        results.push(
            await createUser(
                {
                    ...obj,
                    firstName: obj.firstName || String(i),
                    lastName: obj.lastName || "Doctor",
                    age: obj.age || 100 * i,
                },
                ownerUid
            )
        );
    }

    return results;
};

describe("ModelRoute (ACLs Enabled) Tests [MongoDB]", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server(config, "./test/server", Logger(), objectFactory);

    beforeAll(async () => {
        const authToken = JWTUtils.createToken(config.get("auth"), {
            uid: uuidV4(),
            name: "before",
            roles: config.get("trusted_roles"),
        });
        EventUtils.init(config, Logger(), authToken);

        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        let conn: any = connMgr?.connections.get("acl");
        if (conn instanceof DataSource) {
            aclRepo = conn.getMongoRepository(AccessControlListMongo.name);
        }
        conn = connMgr?.connections.get("mongodb");
        if (conn instanceof DataSource) {
            repo = conn.getMongoRepository(ProtectedUser.name);
        }
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
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

    describe("Single Document Tests [MongoDB]", () => {
        it("Can create document (anonymous). [MongoDB]", async () => {
            const user: ProtectedUser = new ProtectedUser({
                firstName: "David",
                lastName: "Tennant",
                age: 47,
            });
            const result = await request(server.getApplication()).post("/userswithacl").send(user);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual(user.firstName);
            expect(result.body.lastName).toEqual(user.lastName);
            expect(result.body.age).toEqual(user.age);

            const stored: ProtectedUser | null = await repo.findOne({ uid: result.body.uid } as any);
            expect(stored).toBeDefined();
            if (stored) {
                expect(stored.uid).toEqual(user.uid);
                expect(stored.version).toEqual(user.version);
                expect(stored.firstName).toEqual(user.firstName);
                expect(stored.lastName).toEqual(user.lastName);
                expect(stored.age).toEqual(user.age);
            }

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: result.body.uid } as any);
            expect(acl).toBeDefined();
            if (acl) {
                expect(acl.uid).toBe(result.body.uid);
            }
        });

        it("Can create document (admin). [MongoDB]", async () => {
            const user: ProtectedUser = new ProtectedUser({
                firstName: "David",
                lastName: "Tennant",
                age: 47,
            });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                roles: config.get("trusted_roles"),
            } as any);
            const result = await request(server.getApplication())
                .post("/userswithacl")
                .send(user)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual(user.firstName);
            expect(result.body.lastName).toEqual(user.lastName);
            expect(result.body.age).toEqual(user.age);

            const stored: ProtectedUser | null = await repo.findOne({ uid: result.body.uid } as any);
            expect(stored).toBeDefined();
            if (stored) {
                expect(stored.uid).toEqual(user.uid);
                expect(stored.version).toEqual(user.version);
                expect(stored.firstName).toEqual(user.firstName);
                expect(stored.lastName).toEqual(user.lastName);
                expect(stored.age).toEqual(user.age);
            }

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: result.body.uid } as any);
            expect(acl).toBeDefined();
            if (acl) {
                expect(acl.uid).toBe(result.body.uid);
            }
        });

        it("Cannot create document (user). [MongoDB]", async () => {
            const user: ProtectedUser = new ProtectedUser({
                firstName: "David",
                lastName: "Tennant",
                age: 47,
            });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
            } as any);
            const result = await request(server.getApplication())
                .post("/userswithacl")
                .send(user)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(403);
        });

        it("Can delete document (admin). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                name: user.name,
                uid: uuidV4(),
                roles: config.get("trusted_roles"),
            });
            const result = await request(server.getApplication())
                .delete("/userswithacl/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeNull();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeNull();
        });

        it("Can delete document (me). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server.getApplication())
                .delete("/userswithacl/me")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeNull();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeNull();
        });

        it("Can delete document (self). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server.getApplication())
                .delete("/userswithacl/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeNull();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeNull();
        });

        it("Cannot delete document (other). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "other",
                roles: [],
            });
            const result = await request(server.getApplication())
                .delete("/userswithacl/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(403);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeDefined();
        });

        it("Cannot delete document (anonymous). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const result = await request(server.getApplication()).delete("/userswithacl/" + user.uid);
            expect(result.status).toBe(403);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeDefined();
        });

        it("Can find document by id (admin). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server.getApplication())
                .get("/userswithacl/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual(user.firstName);
            expect(result.body.lastName).toEqual(user.lastName);
            expect(result.body.age).toEqual(user.age);
        });

        it("Can find document by id (me). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server.getApplication())
                .get("/userswithacl/me")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual(user.firstName);
            expect(result.body.lastName).toEqual(user.lastName);
            expect(result.body.age).toEqual(user.age);
        });

        it("Can find document by id (self). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server.getApplication())
                .get("/userswithacl/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual(user.firstName);
            expect(result.body.lastName).toEqual(user.lastName);
            expect(result.body.age).toEqual(user.age);
        });

        it("Can find document by id (other). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                roles: [],
                name: "other",
            });
            const result = await request(server.getApplication())
                .get("/userswithacl/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual(user.firstName);
            expect(result.body.lastName).toEqual(user.lastName);
            expect(result.body.age).toEqual(user.age);
        });

        it("Cannot find document by id (anonymous). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const result = await request(server.getApplication()).get("/userswithacl/" + user.uid);
            expect(result.status).toBe(403);
        });

        it("Can update document (admin). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            user.firstName = "Matt";
            user.lastName = "Smith";
            user.age = 36;
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server.getApplication())
                .put("/userswithacl/" + user.uid)
                .set("Authorization", `jwt ${token}`)
                .send(user);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(user.uid);
            expect(result.body.version).toBeGreaterThan(user.version);
            expect(result.body.firstName).toBe(user.firstName);
            expect(result.body.lastName).toBe(user.lastName);
            expect(result.body.age).toBe(user.age);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(result.body.uid);
                expect(existing.version).toBe(result.body.version);
                expect(existing.firstName).toBe(result.body.firstName);
                expect(existing.lastName).toBe(result.body.lastName);
                expect(existing.age).toBe(result.body.age);
            }
        });

        it("Can update document (me). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            user.firstName = "Matt";
            user.lastName = "Smith";
            user.age = 36;
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server.getApplication())
                .put("/userswithacl/me")
                .set("Authorization", `jwt ${token}`)
                .send(user);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(user.uid);
            expect(result.body.version).toBeGreaterThan(user.version);
            expect(result.body.firstName).toBe(user.firstName);
            expect(result.body.lastName).toBe(user.lastName);
            expect(result.body.age).toBe(user.age);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(result.body.uid);
                expect(existing.version).toBe(result.body.version);
                expect(existing.firstName).toBe(result.body.firstName);
                expect(existing.lastName).toBe(result.body.lastName);
                expect(existing.age).toBe(result.body.age);
            }
        });

        it("Can update document (self). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            user.firstName = "Matt";
            user.lastName = "Smith";
            user.age = 36;
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server.getApplication())
                .put("/userswithacl/" + user.uid)
                .set("Authorization", `jwt ${token}`)
                .send(user);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(user.uid);
            expect(result.body.version).toBeGreaterThan(user.version);
            expect(result.body.firstName).toBe(user.firstName);
            expect(result.body.lastName).toBe(user.lastName);
            expect(result.body.age).toBe(user.age);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(result.body.uid);
                expect(existing.version).toBe(result.body.version);
                expect(existing.firstName).toBe(result.body.firstName);
                expect(existing.lastName).toBe(result.body.lastName);
                expect(existing.age).toBe(result.body.age);
            }
        });

        it("Cannot update document (other). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            user.firstName = "Matt";
            user.lastName = "Smith";
            user.age = 36;
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "other",
                roles: [],
            });
            const result = await request(server.getApplication())
                .put("/userswithacl/" + user.uid)
                .set("Authorization", `jwt ${token}`)
                .send(user);
            expect(result.status).toBe(403);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(user.uid);
                expect(existing.version).toBe(user.version);
                expect(existing.firstName).toBe("David");
                expect(existing.lastName).toBe("Tennant");
                expect(existing.age).toBe(47);
            }
        });

        it("Cannot update document (anonymous). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            user.firstName = "Matt";
            user.lastName = "Smith";
            user.age = 36;
            const result = await request(server.getApplication())
                .put("/userswithacl/" + user.uid)
                .send(user);
            expect(result.status).toBe(403);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(user.uid);
                expect(existing.version).toBe(user.version);
                expect(existing.firstName).toBe("David");
                expect(existing.lastName).toBe("Tennant");
                expect(existing.age).toBe(47);
            }
        });
    });

    describe("Multiple Document Tests [MongoDB]", () => {
        it("Can count documents (admin). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(20);
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server.getApplication())
                .head("/userswithacl")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Can count documents (user). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(20);
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "user",
                roles: [],
            });
            const result = await request(server.getApplication())
                .head("/userswithacl")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Cannot count documents (anonymous). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(20);
            const result = await request(server.getApplication()).head("/userswithacl");
            expect(result.status).toBe(403);
        });

        it("Can count documents with criteria (eq) (admin). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(13);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "Matt", lastName: "Smith", age: 36 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "admin",
                roles: config.get("trusted_roles"),
            });
            const result = await request(server.getApplication())
                .head("/userswithacl?lastName=Doctor")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Can count documents with criteria (eq) (user). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(13);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "Matt", lastName: "Smith", age: 36 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "user",
                roles: [],
            });
            const result = await request(server.getApplication())
                .head("/userswithacl?lastName=Doctor")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Cannot count documents with criteria (eq) (anonymouos). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(13);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "Matt", lastName: "Smith", age: 36 });
            const result = await request(server.getApplication()).head("/userswithacl?lastName=Doctor");
            expect(result.status).toBe(403);
        });

        it("Can find all documents (admin). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server.getApplication())
                .get("/userswithacl")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
        });

        it("Can find all documents (user). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "user",
                roles: [],
            });
            const result = await request(server.getApplication())
                .get("/userswithacl")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
        });

        it("Cannot find all documents (anonymous). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const result = await request(server.getApplication()).get("/userswithacl");
            expect(result.status).toBe(403);
        });

        it("Can find documents with criteria (eq) (admin) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(13);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "Matt", lastName: "Smith", age: 36 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server.getApplication())
                .get("/userswithacl?lastName=Doctor")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
            for (const user of result.body) {
                expect(user.lastName).toBe("Doctor");
            }
        });

        it("Can find documents with criteria (eq) (user) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(13);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "Matt", lastName: "Smith", age: 36 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "user",
                roles: [],
            });
            const result = await request(server.getApplication())
                .get("/userswithacl?lastName=Doctor")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
            for (const user of result.body) {
                expect(user.lastName).toBe("Doctor");
            }
        });

        it("Can find documents with criteria paginated (eq) (user) [MongoDB].", async () => {
            // Create some dummy users
            await createUsers(5);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 2", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 3", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 4", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 5", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "user",
                roles: [],
            });
            const result = await request(server.getApplication())
                .get("/userswithacl?firstName=David&page=1&limit=1")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(1);
            expect(result.body[0].lastName).toEqual("Tennant 2");
        });

        it("Can find documents with criteria paginated middle of results (eq) (user) [MongoDB].", async () => {
            // Create some dummy users
            await createUsers(5);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 2", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 3", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 4", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 5", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "user",
                roles: [],
            });
            const result = await request(server.getApplication())
                .get("/userswithacl?firstName=David&page=1&limit=2")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(2);
            expect(result.body[0].lastName).toEqual("Tennant 3");
            expect(result.body[1].lastName).toEqual("Tennant 4");
        });

        it("Can not find documents with criteria paginated outside of range (eq) (user) [MongoDB].", async () => {
            // Create some dummy users
            await createUsers(5);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 2", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 3", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 4", age: 47 });
            await createUser({ firstName: "David", lastName: "Tennant 5", age: 47 });
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                name: "user",
                roles: [],
            });
            const result = await request(server.getApplication())
                .get("/userswithacl?firstName=David&page=7&limit=1")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(0);
        });

        it("Cannot find documents with criteria (eq) (anonymous) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(13);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "Matt", lastName: "Smith", age: 36 });
            const result = await request(server.getApplication()).get("/userswithacl?lastName=Doctor");
            expect(result.status).toBe(403);
        });

        it("Can truncate datastore (admin) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server.getApplication())
                .delete("/userswithacl")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(0);
        });

        it("Can truncate datastore for items only user has permissions for [MongoDB].", async () => {
            const userUid: string = uuidV4();
            const users: ProtectedUser[] = await createUsers(25);
            const myUsers: ProtectedUser[] = await createUsers(5, undefined, userUid);
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: userUid,
                name: "joe",
                roles: [],
            });
            const result = await request(server.getApplication())
                .delete("/userswithacl")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(users.length);
        });

        it("Cannot truncate datastore (user) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const token = JWTUtils.createToken(config.get("auth"), {
                uid: uuidV4(),
                roles: [],
                name: "user",
            });
            const result = await request(server.getApplication())
                .delete("/userswithacl")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(users.length);
        });

        it("Cannot truncate datastore (anonymous) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const result = await request(server.getApplication()).delete("/userswithacl");
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(users.length);
        });

        it("Can override default ACL behavior. [MongoDB]", async () => {
            const defaultACL: AccessControlListMongo | null = await aclRepo.findOne({ uid: "ProtectedUser" } as any);
            expect(defaultACL).toBeDefined();
            if (defaultACL) {
                defaultACL.records.push({
                    userOrRoleId: "anonymous",
                    create: null,
                    read: true,
                    update: null,
                    delete: null,
                    special: null,
                    full: null,
                });
                defaultACL.version++;

                await aclRepo.save(defaultACL);
            }

            const users: ProtectedUser[] = await createUsers(25);
            const result = await request(server.getApplication()).get("/userswithacl");
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
        });
    });
});
