///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import config from "../config";
import { request } from "../../src/test/request.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import ProtectedUser from "../server/models/ProtectedUser";
import { MongoConnection, MongoRepository } from "../../src";
import { JWTUtils, Logger, EventUtils } from "@rapidrest/core";
import { AccessControlListMongo } from "../../src/security/AccessControlListMongo";
import { ACLAction, ACLRecord } from "../../src/security";
import { Server } from "../../src/Server";
import { ObjectFactory } from "../../src/ObjectFactory";
import { ConnectionManager } from "../../src/database/ConnectionManager";
import * as uuid from "uuid";

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
        name: obj.name || uuid.v4(),
    });

    const result: ProtectedUser = await repo.save(user);

    const records: ACLRecord[] = [];

    // The owner full CRUD access
    records.push({
        userOrRoleId: ownerUid || user.uid,
        actions: [
            ACLAction.CREATE,
            ACLAction.READ,
            ACLAction.UPDATE,
            ACLAction.DELETE,
            ACLAction.COUNT,
            ACLAction.LIST,
            ACLAction.TRUNCATE,
            ACLAction.EXISTS,
        ],
    });

    // Guests have create-only access
    records.push({
        userOrRoleId: "anonymous",
        actions: [ACLAction.CREATE],
    });

    // Everyone has read-only access
    records.push({
        userOrRoleId: ".*",
        actions: [ACLAction.READ, ACLAction.LIST, ACLAction.COUNT, ACLAction.EXISTS],
    });

    const acl: any = {
        uid: user.uid,
        dateCreated: new Date(),
        dateModified: Date.now(),
        version: 0,
        records,
        parentUid: "ProtectedUser",
    };
    await aclRepo.save(new AccessControlListMongo(acl));

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
                ownerUid,
            ),
        );
    }

    return results;
};

vi.setConfig({ testTimeout: 120000 });
describe("ModelRoute (ACLs Enabled) Tests [MongoDB]", () => {
    const basePath: string = "/api/userswithacl";
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", objectFactory });

    beforeAll(async () => {
        const authToken = JWTUtils.createTokenSync(config.get("auth"), {
            uid: uuid.v4(),
            name: "before",
            roles: config.get("trusted_roles"),
        });
        await EventUtils.init(config, Logger(), authToken);

        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        let conn: any = connMgr?.connections.get("acl");
        if (conn instanceof MongoConnection) {
            aclRepo = conn.getRepository(AccessControlListMongo);
        }
        conn = connMgr?.connections.get("mongodb");
        if (conn instanceof MongoConnection) {
            repo = conn.getRepository(ProtectedUser);
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
                name: "dtennant",
                firstName: "David",
                lastName: "Tennant",
                age: 47,
            });
            const result = await request(server).post(basePath).send(user);
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
                name: "dtennant",
                firstName: "David",
                lastName: "Tennant",
                age: 47,
            });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: config.get("trusted_roles"),
            } as any);
            const result = await request(server).post(basePath).send(user).set("Authorization", `jwt ${token}`);
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
                name: "dtennant",
                firstName: "David",
                lastName: "Tennant",
                age: 47,
            });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
            } as any);
            const result = await request(server).post(basePath).send(user).set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(403);
        });

        it("Can delete document (admin). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                name: user.name,
                uid: uuid.v4(),
                roles: config.get("trusted_roles"),
            });
            const result = await request(server)
                .delete(basePath + "/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeNull();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeNull();
        });

        it("Can delete document (me). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server)
                .delete(basePath + "/me")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeNull();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeNull();
        });

        it("Can delete document (self). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server)
                .delete(basePath + "/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeNull();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeNull();
        });

        it("Cannot delete document (other). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "other",
                roles: [],
            });
            const result = await request(server)
                .delete(basePath + "/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(403);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeDefined();
        });

        it("Cannot delete document (anonymous). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const result = await request(server).delete(basePath + "/" + user.uid);
            expect(result.status).toBe(403);

            const existing: ProtectedUser | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();

            const acl: AccessControlListMongo | null = await aclRepo.findOne({ uid: user.uid } as any);
            expect(acl).toBeDefined();
        });

        it("Can test if document exists (admin). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server)
                .head(basePath + "/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can test if document exists (me). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server)
                .head(basePath + "/me")
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can test if document exists (self). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server)
                .head(basePath + "/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can test if document exists (other). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: [],
                name: "other",
            });
            const result = await request(server)
                .head(basePath + "/" + user.uid)
                .set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Cannot test if document exists (anonymous). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const result = await request(server).head(basePath + "/" + user.uid);
            expect(result.status).toBe(403);
        });

        it("Can find document by id (admin). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server)
                .get(basePath + "/" + user.uid)
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server)
                .get(basePath + "/me")
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server)
                .get(basePath + "/" + user.uid)
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: [],
                name: "other",
            });
            const result = await request(server)
                .get(basePath + "/" + user.uid)
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
            const result = await request(server).get(basePath + "/" + user.uid);
            expect(result.status).toBe(403);
        });

        it("Can update document (admin). [MongoDB]", async () => {
            const user: ProtectedUser = await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            user.firstName = "Matt";
            user.lastName = "Smith";
            user.age = 36;
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server)
                .put(basePath + "/" + user.uid)
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server)
                .put(basePath + "/me")
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: user.uid,
                name: user.name,
                roles: [],
            });
            const result = await request(server)
                .put(basePath + "/" + user.uid)
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "other",
                roles: [],
            });
            const result = await request(server)
                .put(basePath + "/" + user.uid)
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
            const result = await request(server)
                .put(basePath + "/" + user.uid)
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server).head(basePath).set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Can count documents (user). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(20);
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "user",
                roles: [],
            });
            const result = await request(server).head(basePath).set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Cannot count documents (anonymous). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(20);
            const result = await request(server).head(basePath);
            expect(result.status).toBe(403);
        });

        it("Can count documents with criteria (eq) (admin). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(13);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "Matt", lastName: "Smith", age: 36 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "admin",
                roles: config.get("trusted_roles"),
            });
            const result = await request(server)
                .head(basePath + "?lastName=Doctor")
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "user",
                roles: [],
            });
            const result = await request(server)
                .head(basePath + "?lastName=Doctor")
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
            const result = await request(server).head(basePath + "?lastName=Doctor");
            expect(result.status).toBe(403);
        });

        it("Can find all documents (admin). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server).get(basePath).set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
        });

        it("Can find all documents (user). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "user",
                roles: [],
            });
            const result = await request(server).get(basePath).set("Authorization", `jwt ${token}`);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
        });

        it("Cannot find all documents (anonymous). [MongoDB]", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const result = await request(server).get(basePath);
            expect(result.status).toBe(403);
        });

        it("Excludes a record from find()/count() when its own per-record ACL denies the requester, even though the class-level ACL would allow it. [MongoDB]", async () => {
            const publicUsers: ProtectedUser[] = await createUsers(3);
            const privateUser: ProtectedUser = await createUser({ firstName: "Secret", lastName: "Holder", age: 99 });

            // Narrow the private user's own record ACL so it no longer grants broad `.*` read — only its owner
            // (and admins) can see it, regardless of what the class-level default ACL allows.
            const privateAcl: AccessControlListMongo | null = await aclRepo.findOne({ uid: privateUser.uid } as any);
            expect(privateAcl).toBeDefined();
            if (privateAcl) {
                const wildcard = privateAcl.records.find((r) => r.userOrRoleId === ".*");
                expect(wildcard).toBeDefined();
                if (wildcard) {
                    wildcard.actions = wildcard.actions.filter(
                        (a) =>
                            a !== ACLAction.READ &&
                            a !== ACLAction.LIST &&
                            a !== ACLAction.COUNT &&
                            a !== ACLAction.EXISTS,
                    );
                }
                privateAcl.version++;
                await aclRepo.save(privateAcl);
            }

            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "other-user",
                roles: [],
            });

            const listResult = await request(server).get(basePath).set("Authorization", `jwt ${token}`);
            expect(listResult.status).toBe(200);
            const listedUids: string[] = listResult.body.map((u: ProtectedUser) => u.uid);
            expect(listedUids).toEqual(expect.arrayContaining(publicUsers.map((u) => u.uid)));
            expect(listedUids).not.toContain(privateUser.uid);

            const countResult = await request(server).head(basePath).set("Authorization", `jwt ${token}`);
            expect(countResult.status).toBe(200);
            expect(countResult.headers["content-length"]).toBe(publicUsers.length.toString());

            // The owner can still see their own record.
            const ownerToken = JWTUtils.createTokenSync(config.get("auth"), {
                uid: privateUser.uid,
                name: privateUser.name,
                roles: [],
            });
            const ownerResult = await request(server).get(basePath).set("Authorization", `jwt ${ownerToken}`);
            expect(ownerResult.body.map((u: ProtectedUser) => u.uid)).toContain(privateUser.uid);
        });

        it("Can find documents with criteria (eq) (admin) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(13);
            await createUser({ firstName: "David", lastName: "Tennant", age: 47 });
            await createUser({ firstName: "Matt", lastName: "Smith", age: 36 });
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server)
                .get(basePath + "?lastName=Doctor")
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "user",
                roles: [],
            });
            const result = await request(server)
                .get(basePath + "?lastName=Doctor")
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "user",
                roles: [],
            });
            const result = await request(server)
                .get(basePath + "?firstName=David&page=1&limit=1")
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "user",
                roles: [],
            });
            const result = await request(server)
                .get(basePath + "?firstName=David&page=1&limit=2")
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
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                name: "user",
                roles: [],
            });
            const result = await request(server)
                .get(basePath + "?firstName=David&page=7&limit=1")
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
            const result = await request(server).get(basePath + "?lastName=Doctor");
            expect(result.status).toBe(403);
        });

        it("Can truncate datastore (admin) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: config.get("trusted_roles"),
                name: "admin",
            });
            const result = await request(server).delete(basePath).set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(0);
        });

        it("Can truncate datastore for items only user has permissions for [MongoDB].", async () => {
            const userUid: string = uuid.v4();
            const users: ProtectedUser[] = await createUsers(25);
            const myUsers: ProtectedUser[] = await createUsers(5, undefined, userUid);
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: userUid,
                name: "joe",
                roles: [],
            });
            const result = await request(server).delete(basePath).set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(users.length);
        });

        it("Cannot truncate datastore (user) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const token = JWTUtils.createTokenSync(config.get("auth"), {
                uid: uuid.v4(),
                roles: [],
                name: "user",
            });
            const result = await request(server).delete(basePath).set("Authorization", `jwt ${token}`);
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(users.length);
        });

        it("Cannot truncate datastore (anonymous) [MongoDB].", async () => {
            const users: ProtectedUser[] = await createUsers(25);
            const result = await request(server).delete(basePath);
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
                    actions: [ACLAction.LIST],
                });
                defaultACL.version++;

                await aclRepo.save(defaultACL);
            }

            const users: ProtectedUser[] = await createUsers(25);
            const result = await request(server).get(basePath);
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result).toHaveProperty("body");
            // Overriding the class-level default ACL grants anonymous class-level LIST (so the request succeeds
            // instead of a 403), but each user's own per-record ACL still explicitly denies anonymous read —
            // and per-record ACLs correctly take precedence over the class/default ACL for individual records.
            expect(result.body).toHaveLength(0);
        });
    });
});
