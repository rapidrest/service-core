///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect, beforeEach } from "vitest";
import { default as config } from "../config.js";
import * as request from "supertest";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoRepository, DataSource } from "typeorm";
import { AccessControlListMongo, ACLRecordMongo } from "../../src/security/AccessControlListMongo.js";
import { JWTUtils, Logger, EventUtils } from "@rapidrest/core";
import { ObjectFactory } from "../../src/ObjectFactory.js";
import { ConnectionManager } from "../../src/database/ConnectionManager.js";
import { Server } from "../../src/Server.js";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});

describe("ACLRouteMongo Tests", () => {
    const admin: any = {
        uid: uuidV4(),
        roles: ["admin"],
    };
    const adminToken: string = JWTUtils.createToken(config.get("auth"), admin);
    const user: any = {
        uid: uuidV4(),
    };
    const userToken: string = JWTUtils.createToken(config.get("auth"), user);
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server(config, "./test/server", Logger(), objectFactory);
    let repo: MongoRepository<AccessControlListMongo>;

    const createACL = async (
        records: ACLRecordMongo[] = [],
        parentUid: string | undefined = undefined
    ): Promise<AccessControlListMongo> => {
        const acl: AccessControlListMongo = new AccessControlListMongo({
            records,
            parentUid,
        });

        return await repo.save(acl);
    };

    const createACLs = async (
        num: number,
        records: ACLRecordMongo[] = [],
        parentUid: string | undefined = undefined
    ): Promise<AccessControlListMongo[]> => {
        const results: AccessControlListMongo[] = [];

        for (let i = 1; i <= num; i++) {
            results.push(await createACL(records, parentUid));
        }

        return results;
    };

    beforeAll(async () => {
        EventUtils.init(config, Logger(), adminToken);

        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("acl");
        if (conn instanceof DataSource) {
            repo = conn.getMongoRepository(AccessControlListMongo.name);
        }
        const results: any[] = await repo.find();
        console.log(results.length);
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
    });

    beforeEach(async () => {
        try {
            // Don't delete the default ACLs initialized by the server
            await repo.deleteMany({
                uid: { $nin: ["default_ProtectedUser", "ProtectedUser", "default_Script", "Script"] },
            });
        } catch (err) {
            // The error "ns not found" occurs when the collection doesn't exist yet. We can ignore this error.
            if (err.message !== "ns not found") {
                throw err;
            }
        }
    });

    it("Can create ACL document.", async () => {
        const acl: AccessControlListMongo = new AccessControlListMongo({
            records: [
                new ACLRecordMongo({
                    userOrRoleId: "admin",
                    full: true,
                }),
                new ACLRecordMongo({
                    userOrRoleId: ".*",
                    create: true,
                    read: true,
                    update: false,
                    delete: false,
                }),
            ],
        });
        const result = await request(server.getApplication())
            .post("/acls")
            .send(acl)
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        const resultACL: AccessControlListMongo = new AccessControlListMongo(result.body);
        expect(resultACL.uid).toEqual(acl.uid);
        expect(resultACL.version).toEqual(acl.version);
        expect(resultACL.records).toHaveLength(acl.records.length);
        for (const record of acl.records) {
            let found: boolean = false;
            for (const r2 of resultACL.records) {
                if (record.userOrRoleId === r2.userOrRoleId) {
                    found = true;
                    expect(record.create).toEqual(r2.create);
                    expect(record.delete).toEqual(r2.delete);
                    expect(record.full).toEqual(r2.full);
                    expect(record.read).toEqual(r2.read);
                    expect(record.special).toEqual(r2.special);
                    expect(record.update).toEqual(r2.update);
                    break;
                }
            }
            expect(found).toBeTruthy();
        }

        const stored: AccessControlListMongo | null = await repo.findOne({ uid: result.body.uid } as any);
        expect(stored).toBeDefined();
        if (stored) {
            expect(stored.uid).toEqual(acl.uid);
            expect(stored.version).toEqual(acl.version);
            expect(stored.records).toHaveLength(acl.records.length);
            for (const record of acl.records) {
                let found: boolean = false;
                for (const r2 of stored.records) {
                    if (record.userOrRoleId === r2.userOrRoleId) {
                        found = true;
                        expect(record.create).toEqual(r2.create);
                        expect(record.delete).toEqual(r2.delete);
                        expect(record.full).toEqual(r2.full);
                        expect(record.read).toEqual(r2.read);
                        expect(record.special).toEqual(r2.special);
                        expect(record.update).toEqual(r2.update);
                        break;
                    }
                }
                expect(found).toBeTruthy();
            }
        }
    });

    it("Cannot create ACL document as non-admin.", async () => {
        const acl: AccessControlListMongo = new AccessControlListMongo({
            records: [
                new ACLRecordMongo({
                    userOrRoleId: "admin",
                    full: true,
                }),
                new ACLRecordMongo({
                    userOrRoleId: ".*",
                    create: true,
                    read: true,
                    update: false,
                    delete: false,
                }),
            ],
        });
        const result = await request(server.getApplication())
            .post("/acls")
            .send(acl)
            .set("Authorization", "jwt " + userToken);
        expect(result.status).toBe(403);

        const stored: AccessControlListMongo | null = await repo.findOne({ uid: acl.uid } as any);
        expect(stored).toBeNull();
    });

    it("Cannot create ACL document as anonymous.", async () => {
        const acl: AccessControlListMongo = new AccessControlListMongo({
            records: [
                new ACLRecordMongo({
                    userOrRoleId: "admin",
                    full: true,
                }),
                new ACLRecordMongo({
                    userOrRoleId: ".*",
                    create: true,
                    read: true,
                    update: false,
                    delete: false,
                }),
            ],
        });
        const result = await request(server.getApplication()).post("/acls").send(acl);
        expect(result.status).toBe(401);

        const stored: AccessControlListMongo | null = await repo.findOne({ uid: acl.uid } as any);
        expect(stored).toBeNull();
    });

    it("Can delete ACL document.", async () => {
        const acl: AccessControlListMongo = await createACL();
        const result = await request(server.getApplication())
            .delete("/acls/" + acl.uid)
            .set("Authorization", "jwt " + adminToken);
        expect(result.status).toBe(204);

        const existing: AccessControlListMongo | null = await repo.findOne({ uid: acl.uid } as any);
        expect(existing).toBeNull();
    });

    it("Cannot delete a default_ ACL document.", async () => {
        let count: number = await repo.count({ uid: "default_ProtectedUser" });
        expect(count).toBe(1);

        const result = await request(server.getApplication())
            .delete("/acls/default_ProtectedUser")
            .set("Authorization", "jwt " + adminToken);
        expect(result.status).toBe(403);

        count = await repo.count({ uid: "default_ProtectedUser" });
        expect(count).toBe(1);
    });
    it("Cannot delete ACL document as non-admin.", async () => {
        const acl: AccessControlListMongo = await createACL([
            new ACLRecordMongo({
                userOrRoleId: "admin",
                full: true,
            }),
            new ACLRecordMongo({
                userOrRoleId: ".*",
                create: false,
                read: true,
                update: false,
                delete: false,
            }),
            new ACLRecordMongo({
                userOrRoleId: "anonymous",
                create: false,
                read: true,
                update: false,
                delete: false,
            }),
        ]);
        const result = await request(server.getApplication())
            .delete("/acls/" + acl.uid)
            .set("Authorization", "jwt " + userToken);
        expect(result.status).toBe(403);

        const existing: AccessControlListMongo | null = await repo.findOne({ uid: acl.uid } as any);
        expect(existing).toBeDefined();
    });

    it("Cannot delete ACL document as anonymous.", async () => {
        const acl: AccessControlListMongo = await createACL([
            new ACLRecordMongo({
                userOrRoleId: "admin",
                full: true,
            }),
            new ACLRecordMongo({
                userOrRoleId: ".*",
                create: false,
                read: true,
                update: false,
                delete: false,
            }),
            new ACLRecordMongo({
                userOrRoleId: "anonymous",
                create: false,
                read: true,
                update: false,
                delete: false,
            }),
        ]);
        const result = await request(server.getApplication()).delete("/acls/" + acl.uid);
        expect(result.status).toBe(401);

        const existing: AccessControlListMongo | null = await repo.findOne({ uid: acl.uid } as any);
        expect(existing).toBeDefined();
    });

    it("Can find ACL document by id.", async () => {
        const acl: AccessControlListMongo = await createACL();
        const result = await request(server.getApplication())
            .get("/acls/" + acl.uid)
            .send()
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        expect(result.body.uid).toEqual(acl.uid);
        expect(result.body.version).toEqual(acl.version);
    });

    it("Can update ACL document.", async () => {
        const acl: AccessControlListMongo = await createACL([
            new ACLRecordMongo({
                userOrRoleId: "admin",
                full: true,
            }),
        ]);
        acl.records.push(
            new ACLRecordMongo({
                userOrRoleId: ".*",
                create: true,
                read: true,
                update: false,
                delete: false,
            })
        );
        const result = await request(server.getApplication())
            .put("/acls/" + acl.uid)
            .send(acl)
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        const resultACL: AccessControlListMongo = new AccessControlListMongo(result.body);
        expect(resultACL.uid).toBe(acl.uid);
        expect(resultACL.version).toBeGreaterThan(acl.version);
        for (const record of acl.records) {
            let found: boolean = false;
            for (const r2 of resultACL.records) {
                if (record.userOrRoleId === r2.userOrRoleId) {
                    found = true;
                    expect(record.create).toEqual(r2.create);
                    expect(record.delete).toEqual(r2.delete);
                    expect(record.full).toEqual(r2.full);
                    expect(record.read).toEqual(r2.read);
                    expect(record.special).toEqual(r2.special);
                    expect(record.update).toEqual(r2.update);
                    break;
                }
            }
            expect(found).toBeTruthy();
        }

        const existing: AccessControlListMongo | null = await repo.findOne({ uid: acl.uid } as any);
        expect(existing).toBeDefined();
        if (existing) {
            expect(existing.uid).toBe(result.body.uid);
            expect(existing.version).toBe(result.body.version);
            for (const record of existing.records) {
                let found: boolean = false;
                for (const r2 of result.body.records) {
                    if (record.userOrRoleId === r2.userOrRoleId) {
                        found = true;
                        expect(record.create).toEqual(r2.create);
                        expect(record.delete).toEqual(r2.delete);
                        expect(record.full).toEqual(r2.full);
                        expect(record.read).toEqual(r2.read);
                        expect(record.special).toEqual(r2.special);
                        expect(record.update).toEqual(r2.update);
                        break;
                    }
                }
                expect(found).toBeTruthy();
            }
        }
    });

    it("Can update ACL document as non-admin with permission.", async () => {
        const acl: AccessControlListMongo = await createACL([
            new ACLRecordMongo({
                userOrRoleId: "admin",
                full: true,
            }),
            new ACLRecordMongo({
                userOrRoleId: ".*",
                create: true,
                read: true,
                update: true,
                delete: false,
            }),
        ]);
        acl.records.push(
            new ACLRecordMongo({
                userOrRoleId: "anonymous",
                create: false,
                read: true,
                update: false,
                delete: false,
            })
        );
        const result = await request(server.getApplication())
            .put("/acls/" + acl.uid)
            .send(acl)
            .set("Authorization", "jwt " + userToken);
        const resultACL: AccessControlListMongo = new AccessControlListMongo(result.body);
        expect(resultACL.uid).toBe(acl.uid);
        expect(resultACL.version).toBeGreaterThan(acl.version);
        for (const record of acl.records) {
            let found: boolean = false;
            for (const r2 of resultACL.records) {
                if (record.userOrRoleId === r2.userOrRoleId) {
                    found = true;
                    expect(record.create).toEqual(r2.create);
                    expect(record.delete).toEqual(r2.delete);
                    expect(record.full).toEqual(r2.full);
                    expect(record.read).toEqual(r2.read);
                    expect(record.special).toEqual(r2.special);
                    expect(record.update).toEqual(r2.update);
                    break;
                }
            }
            expect(found).toBeTruthy();
        }

        const existing: AccessControlListMongo | null = await repo.findOne({ uid: acl.uid } as any);
        expect(existing).toBeDefined();
        if (existing) {
            expect(existing.uid).toBe(result.body.uid);
            expect(existing.version).toBe(result.body.version);
            for (const record of existing.records) {
                let found: boolean = false;
                for (const r2 of result.body.records) {
                    if (record.userOrRoleId === r2.userOrRoleId) {
                        found = true;
                        expect(record.create).toEqual(r2.create);
                        expect(record.delete).toEqual(r2.delete);
                        expect(record.full).toEqual(r2.full);
                        expect(record.read).toEqual(r2.read);
                        expect(record.special).toEqual(r2.special);
                        expect(record.update).toEqual(r2.update);
                        break;
                    }
                }
                expect(found).toBeTruthy();
            }
        }
    });

    it("Cannot update ACL document as non-admin without permission.", async () => {
        const acl: AccessControlListMongo = await createACL([
            new ACLRecordMongo({
                userOrRoleId: "admin",
                full: true,
            }),
            new ACLRecordMongo({
                userOrRoleId: ".*",
                create: false,
                read: true,
                update: false,
                delete: false,
            }),
        ]);
        acl.records.push(
            new ACLRecordMongo({
                userOrRoleId: "anonymous",
                create: false,
                read: true,
                update: false,
                delete: false,
            })
        );
        const result = await request(server.getApplication())
            .put("/acls/" + acl.uid)
            .send(acl)
            .set("Authorization", "jwt " + userToken);
        expect(result.status).toBe(403);
    });

    it("Cannot update ACL document as anonymous.", async () => {
        const acl: AccessControlListMongo = await createACL([
            new ACLRecordMongo({
                userOrRoleId: "admin",
                full: true,
            }),
            new ACLRecordMongo({
                userOrRoleId: ".*",
                create: false,
                read: true,
                update: false,
                delete: false,
            }),
            new ACLRecordMongo({
                userOrRoleId: "anonymous",
                create: false,
                read: true,
                update: false,
                delete: false,
            }),
        ]);
        acl.records.push(
            new ACLRecordMongo({
                userOrRoleId: ".*",
                create: true,
                read: true,
                update: false,
                delete: false,
            })
        );
        const result = await request(server.getApplication())
            .put("/acls/" + acl.uid)
            .send(acl);
        expect(result.status).toBe(401);
    });

    it("Cannot update default_ ACL document.", async () => {
        const acl: AccessControlListMongo | null = await repo.findOne({ uid: "default_ProtectedUser" } as any);
        expect(acl).toBeDefined();
        if (acl) {
            acl.records = [];

            const result = await request(server.getApplication())
                .put("/acls/" + acl.uid)
                .set("Authorization", "jwt " + adminToken)
                .send(acl);
            expect(result.status).toBe(403);
        }
    });

    it("Can count ACL documents.", async () => {
        const count: number = await repo.count();
        const acls: AccessControlListMongo[] = await createACLs(5);
        const result = await request(server.getApplication())
            .head("/acls")
            .set("Authorization", "jwt " + adminToken);
        expect(result.headers).toHaveProperty("content-length");
        // Add 4 to the ACL length to cover default server ACLs
        expect(Number(result.headers["content-length"])).toBe(acls.length + count);
    });

    it("Can count ACL documents with criteria (eq).", async () => {
        const parentUid: string = uuidV4();
        const acls: AccessControlListMongo[] = await createACLs(5, [], parentUid);
        await createACLs(5, [], uuidV4());
        await createACLs(5, [], uuidV4());
        const result = await request(server.getApplication())
            .head("/acls?parentUid=" + parentUid)
            .set("Authorization", "jwt " + adminToken);
        expect(result.headers).toHaveProperty("content-length");
        expect(Number(result.headers["content-length"])).toBe(acls.length);
    });

    it("Can find all ACL documents.", async () => {
        const count: number = await repo.count();
        const acls: AccessControlListMongo[] = await createACLs(5);
        const result = await request(server.getApplication())
            .get("/acls")
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        // Add 4 to the ACL length to cover default server ACLs
        expect(result.body).toHaveLength(acls.length + count);
    });

    it("Can find ACL documents with criteria (eq).", async () => {
        const parentUid: string = uuidV4();
        const acls: AccessControlListMongo[] = await createACLs(5, [], parentUid);
        await createACLs(5, [], uuidV4());
        await createACLs(5, [], uuidV4());
        const result = await request(server.getApplication())
            .get("/acls?parentUid=" + parentUid)
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        expect(result.body).toHaveLength(acls.length);
        for (const acl of result.body) {
            expect(acl.parentUid).toBe(parentUid);
        }
    });
});
