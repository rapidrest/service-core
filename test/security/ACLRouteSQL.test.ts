///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { request } from "../../src/test/request.js";
import { BaseACLRoute } from "../../src";
import { AccessControlListSQL, ACLRecordSQL } from "../../src/security/AccessControlListSQL";
import { ACLAction } from "../../src/security/AccessControlList";
import { JWTUtils, Logger, EventUtils, ClassLoader } from "@rapidrest/core";
import { ObjectFactory } from "../../src/ObjectFactory";
import { ConnectionManager } from "../../src/database/ConnectionManager";
import { Server } from "../../src/Server";
import * as uuid from "uuid";
import { Model, Route } from "../../src/decorators/RouteDecorators";
import { DataSource, In, Not, Repository } from "typeorm";
import { MongoMemoryServer } from "mongodb-memory-server";

@Model(AccessControlListSQL)
@Route("/acls")
class ACLRouteSQL extends BaseACLRoute<AccessControlListSQL> {}

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
vi.setConfig({ testTimeout: 1200000 });
describe("ACLRouteSQL Tests", () => {
    const classLoader: ClassLoader = new ClassLoader("./test/server", true, true, config.get("class_loader:ignore"));
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", classLoader, objectFactory });
    let repo: Repository<AccessControlListSQL>;

    const admin: any = {
        uid: uuid.v4(),
        roles: ["admin"],
    };
    const adminToken: string = JWTUtils.createTokenSync(config.get("auth"), admin);
    const user: any = {
        uid: uuid.v4(),
    };
    const userToken: string = JWTUtils.createTokenSync(config.get("auth"), user);

    const createACL = async (
        records: ACLRecordSQL[] = [],
        parentUid: string | undefined = undefined,
    ): Promise<AccessControlListSQL> => {
        const acl: AccessControlListSQL = new AccessControlListSQL({
            records,
            parentUid,
        });

        return await repo.save(acl);
    };

    const createACLs = async (
        num: number,
        records: ACLRecordSQL[] = [],
        parentUid: string | undefined = undefined,
    ): Promise<AccessControlListSQL[]> => {
        const results: AccessControlListSQL[] = [];

        for (let i = 1; i <= num; i++) {
            results.push(await createACL(records, parentUid));
        }

        return results;
    };

    beforeAll(async () => {
        config.set("datastores:acl", {
            type: "better-sqlite3",
            host: "localhost",
            database: "rrst-test",
            synchronize: true,
        });

        await EventUtils.init(config, Logger(), adminToken);

        // Register the test route class with the class loader
        classLoader.getClasses().set("routes.ACLRouteSQL", ACLRouteSQL);

        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("acl");
        if (conn instanceof DataSource) {
            repo = conn.getRepository(AccessControlListSQL.name);
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
        // Don't delete the default ACLs initialized by the server
        await repo.delete({
            uid: Not(In(["default_ProtectedUser", "ProtectedUser", "default_Script", "Script"])),
        } as any);
    });

    it("Can create ACL document.", async () => {
        const acl: AccessControlListSQL = new AccessControlListSQL({
            records: [
                new ACLRecordSQL({
                    userOrRoleId: "admin",
                    actions: [ACLAction.FULL],
                }),
                new ACLRecordSQL({
                    userOrRoleId: ".*",
                    actions: [ACLAction.CREATE, ACLAction.READ],
                }),
            ],
        });
        const result = await request(server)
            .post("/acls")
            .send(acl)
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        expect(result.status).toBeGreaterThanOrEqual(200);
        expect(result.status).toBeLessThan(300);
        const resultACL: AccessControlListSQL = new AccessControlListSQL(result.body);
        expect(resultACL.uid).toEqual(acl.uid);
        expect(resultACL.version).toEqual(acl.version);
        expect(resultACL.records).toHaveLength(acl.records.length);
        for (const record of acl.records) {
            let found: boolean = false;
            for (const r2 of resultACL.records) {
                if (record.userOrRoleId === r2.userOrRoleId) {
                    found = true;
                    expect(record.actions).toEqual(r2.actions);
                    break;
                }
            }
            expect(found).toBeTruthy();
        }

        const stored: AccessControlListSQL | null = await repo.findOne({ where: { uid: result.body.uid } } as any);
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
                        expect(record.actions).toEqual(r2.actions);
                        break;
                    }
                }
                expect(found).toBeTruthy();
            }
        }
    });

    it("Cannot create ACL document as non-admin.", async () => {
        const acl: AccessControlListSQL = new AccessControlListSQL({
            records: [
                new ACLRecordSQL({
                    userOrRoleId: "admin",
                    actions: [ACLAction.FULL],
                }),
                new ACLRecordSQL({
                    userOrRoleId: ".*",
                    actions: [ACLAction.CREATE, ACLAction.READ],
                }),
            ],
        });
        const result = await request(server)
            .post("/acls")
            .send(acl)
            .set("Authorization", "jwt " + userToken);
        expect(result.status).toBe(403);

        const stored: AccessControlListSQL | null = await repo.findOne({ where: { uid: acl.uid } } as any);
        expect(stored).toBeNull();
    });

    it("Cannot create ACL document as anonymous.", async () => {
        const acl: AccessControlListSQL = new AccessControlListSQL({
            records: [
                new ACLRecordSQL({
                    userOrRoleId: "admin",
                    actions: [ACLAction.FULL],
                }),
                new ACLRecordSQL({
                    userOrRoleId: ".*",
                    actions: [ACLAction.CREATE, ACLAction.READ],
                }),
            ],
        });
        const result = await request(server).post("/acls").send(acl);
        expect(result.status).toBe(401);

        const stored: AccessControlListSQL | null = await repo.findOne({ where: { uid: acl.uid } } as any);
        expect(stored).toBeNull();
    });

    it("Can delete ACL document.", async () => {
        const acl: AccessControlListSQL = await createACL();
        const result = await request(server)
            .delete("/acls/" + acl.uid)
            .set("Authorization", "jwt " + adminToken);
        expect(result.status).toBe(204);

        const existing: AccessControlListSQL | null = await repo.findOne({ where: { uid: acl.uid } } as any);
        expect(existing).toBeNull();
    });

    it("Cannot delete a default_ ACL document.", async () => {
        let count: number = await repo.count({ where: { uid: "default_ProtectedUser" } });
        expect(count).toBe(1);

        const result = await request(server)
            .delete("/acls/default_ProtectedUser")
            .set("Authorization", "jwt " + adminToken);
        expect(result.status).toBe(403);

        count = await repo.count({ where: { uid: "default_ProtectedUser" } });
        expect(count).toBe(1);
    });
    it("Cannot delete ACL document as non-admin.", async () => {
        const acl: AccessControlListSQL = await createACL([
            new ACLRecordSQL({
                userOrRoleId: "admin",
                actions: [ACLAction.FULL],
            }),
            new ACLRecordSQL({
                userOrRoleId: ".*",
                actions: [ACLAction.READ],
            }),
            new ACLRecordSQL({
                userOrRoleId: "anonymous",
                actions: [ACLAction.READ],
            }),
        ]);
        const result = await request(server)
            .delete("/acls/" + acl.uid)
            .set("Authorization", "jwt " + userToken);
        expect(result.status).toBe(403);

        const existing: AccessControlListSQL | null = await repo.findOne({ where: { uid: acl.uid } } as any);
        expect(existing).toBeDefined();
    });

    it("Cannot delete ACL document as anonymous.", async () => {
        const acl: AccessControlListSQL = await createACL([
            new ACLRecordSQL({
                userOrRoleId: "admin",
                actions: [ACLAction.FULL],
            }),
            new ACLRecordSQL({
                userOrRoleId: ".*",
                actions: [ACLAction.READ],
            }),
            new ACLRecordSQL({
                userOrRoleId: "anonymous",
                actions: [ACLAction.READ],
            }),
        ]);
        const result = await request(server).delete("/acls/" + acl.uid);
        expect(result.status).toBe(401);

        const existing: AccessControlListSQL | null = await repo.findOne({ where: { uid: acl.uid } } as any);
        expect(existing).toBeDefined();
    });

    it("Can find ACL document by id.", async () => {
        const acl: AccessControlListSQL = await createACL();
        const result = await request(server)
            .get("/acls/" + acl.uid)
            .send()
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        expect(result.body.uid).toEqual(acl.uid);
        expect(result.body.version).toEqual(acl.version);
    });

    it("Can update ACL document.", async () => {
        const acl: AccessControlListSQL = await createACL([
            new ACLRecordSQL({
                userOrRoleId: "admin",
                actions: [ACLAction.FULL],
            }),
        ]);
        acl.records.push(
            new ACLRecordSQL({
                userOrRoleId: ".*",
                actions: [ACLAction.CREATE, ACLAction.READ],
            }),
        );
        const result = await request(server)
            .put("/acls/" + acl.uid)
            .send(acl)
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        const resultACL: AccessControlListSQL = new AccessControlListSQL(result.body);
        expect(resultACL.uid).toBe(acl.uid);
        expect(resultACL.version).toBeGreaterThan(acl.version);
        for (const record of acl.records) {
            let found: boolean = false;
            for (const r2 of resultACL.records) {
                if (record.userOrRoleId === r2.userOrRoleId) {
                    found = true;
                    expect(record.actions).toEqual(r2.actions);
                    break;
                }
            }
            expect(found).toBeTruthy();
        }

        const existing: AccessControlListSQL | null = await repo.findOne({ where: { uid: acl.uid } } as any);
        expect(existing).toBeDefined();
        if (existing) {
            expect(existing.uid).toBe(result.body.uid);
            expect(existing.version).toBe(result.body.version);
            for (const record of existing.records) {
                let found: boolean = false;
                for (const r2 of result.body.records) {
                    if (record.userOrRoleId === r2.userOrRoleId) {
                        found = true;
                        expect(record.actions).toEqual(r2.actions);
                        break;
                    }
                }
                expect(found).toBeTruthy();
            }
        }
    });

    it("Can update ACL document as non-admin with permission.", async () => {
        const acl: AccessControlListSQL = await createACL([
            new ACLRecordSQL({
                userOrRoleId: "admin",
                actions: [ACLAction.FULL],
            }),
            new ACLRecordSQL({
                userOrRoleId: ".*",
                actions: [ACLAction.FULL],
            }),
        ]);
        acl.records.push(
            new ACLRecordSQL({
                userOrRoleId: "anonymous",
                actions: [ACLAction.READ],
            }),
        );
        const result = await request(server)
            .put("/acls/" + acl.uid)
            .send(acl)
            .set("Authorization", "jwt " + userToken);
        const resultACL: AccessControlListSQL = new AccessControlListSQL(result.body);
        expect(resultACL.uid).toBe(acl.uid);
        expect(resultACL.version).toBeGreaterThan(acl.version);
        for (const record of acl.records) {
            let found: boolean = false;
            for (const r2 of resultACL.records) {
                if (record.userOrRoleId === r2.userOrRoleId) {
                    found = true;
                    expect(record.actions).toEqual(r2.actions);
                    break;
                }
            }
            expect(found).toBeTruthy();
        }

        const existing: AccessControlListSQL | null = await repo.findOne({ where: { uid: acl.uid } } as any);
        expect(existing).toBeDefined();
        if (existing) {
            expect(existing.uid).toBe(result.body.uid);
            expect(existing.version).toBe(result.body.version);
            for (const record of existing.records) {
                let found: boolean = false;
                for (const r2 of result.body.records) {
                    if (record.userOrRoleId === r2.userOrRoleId) {
                        found = true;
                        expect(record.actions).toEqual(r2.actions);
                        break;
                    }
                }
                expect(found).toBeTruthy();
            }
        }
    });

    it("Cannot update ACL document as non-admin without permission.", async () => {
        const acl: AccessControlListSQL = await createACL([
            new ACLRecordSQL({
                userOrRoleId: "admin",
                actions: [ACLAction.FULL],
            }),
            new ACLRecordSQL({
                userOrRoleId: ".*",
                actions: [ACLAction.READ],
            }),
        ]);
        acl.records.push(
            new ACLRecordSQL({
                userOrRoleId: "anonymous",
                actions: [ACLAction.READ],
            }),
        );
        const result = await request(server)
            .put("/acls/" + acl.uid)
            .send(acl)
            .set("Authorization", "jwt " + userToken);
        expect(result.status).toBe(403);
    });

    it("Cannot update ACL document as anonymous.", async () => {
        const acl: AccessControlListSQL = await createACL([
            new ACLRecordSQL({
                userOrRoleId: "admin",
                actions: [ACLAction.FULL],
            }),
            new ACLRecordSQL({
                userOrRoleId: ".*",
                actions: [ACLAction.READ],
            }),
            new ACLRecordSQL({
                userOrRoleId: "anonymous",
                actions: [ACLAction.READ],
            }),
        ]);
        acl.records.push(
            new ACLRecordSQL({
                userOrRoleId: ".*",
                actions: [ACLAction.CREATE, ACLAction.READ],
            }),
        );
        const result = await request(server)
            .put("/acls/" + acl.uid)
            .send(acl);
        expect(result.status).toBe(401);
    });

    it("Cannot update default_ ACL document.", async () => {
        const acl: AccessControlListSQL | null = await repo.findOne({ where: { uid: "default_ProtectedUser" } } as any);
        expect(acl).toBeDefined();
        if (acl) {
            acl.records = [];

            const result = await request(server)
                .put("/acls/" + acl.uid)
                .set("Authorization", "jwt " + adminToken)
                .send(acl);
            expect(result.status).toBe(403);
        }
    });

    it("Can count ACL documents.", async () => {
        const count: number = await repo.count();
        const acls: AccessControlListSQL[] = await createACLs(5);
        const result = await request(server)
            .head("/acls")
            .set("Authorization", "jwt " + adminToken);
        expect(result.headers).toHaveProperty("content-length");
        // Add 4 to the ACL length to cover default server ACLs
        expect(Number(result.headers["content-length"])).toBe(acls.length + count);
    });

    it("Can count ACL documents with criteria (eq).", async () => {
        const parentUid: string = uuid.v4();
        const acls: AccessControlListSQL[] = await createACLs(5, [], parentUid);
        await createACLs(5, [], uuid.v4());
        await createACLs(5, [], uuid.v4());
        const result = await request(server)
            .head("/acls?parentUid=" + parentUid)
            .set("Authorization", "jwt " + adminToken);
        expect(result.headers).toHaveProperty("content-length");
        expect(Number(result.headers["content-length"])).toBe(acls.length);
    });

    it("Can find all ACL documents.", async () => {
        const count: number = await repo.count();
        const acls: AccessControlListSQL[] = await createACLs(5);
        const result = await request(server)
            .get("/acls")
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        // Add 4 to the ACL length to cover default server ACLs
        expect(result.body).toHaveLength(acls.length + count);
    });

    it("Can find ACL documents with criteria (eq).", async () => {
        const parentUid: string = uuid.v4();
        const acls: AccessControlListSQL[] = await createACLs(5, [], parentUid);
        await createACLs(5, [], uuid.v4());
        await createACLs(5, [], uuid.v4());
        const result = await request(server)
            .get("/acls?parentUid=" + parentUid)
            .set("Authorization", "jwt " + adminToken);
        expect(result).toHaveProperty("body");
        expect(result.body).toHaveLength(acls.length);
        for (const acl of result.body) {
            expect(acl.parentUid).toBe(parentUid);
        }
    });
});
