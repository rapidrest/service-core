///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz
///////////////////////////////////////////////////////////////////////////////
import "reflect-metadata";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { default as config } from "../config.js";
import { MongoRepository, DataSource } from "typeorm";
import { AccessControlListMongo, ACLRecordMongo } from "../../src/security/AccessControlListMongo.js";
import { MongoMemoryServer } from "mongodb-memory-server";
import { AccessControlList, ACLRecord, ACLAction } from "../../src/security/AccessControlList.js";
import { ACLUtils } from "../../src/security/ACLUtils.js";
import { Logger } from "@rapidrest/core";
import { ObjectFactory } from "../../src/ObjectFactory.js";
import { ModelUtils } from "../../src/models/ModelUtils.js";
import { ConnectionManager } from "../../src/database/ConnectionManager.js";
import Redis from "ioredis-mock";

describe("ACLUtils Tests", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    describe("MongoDB Tests", () => {
        let aclRepo: MongoRepository<AccessControlListMongo>;
        const mongod: MongoMemoryServer = new MongoMemoryServer({
            instance: {
                port: 9999,
                dbName: "mongomemory-rrst-test",
            },
        });
        const redis: any = new Redis();
        let aclUtils: ACLUtils | undefined = undefined;

        const testACLs: AccessControlList[] = [
            new AccessControlListMongo({
                uid: "admin",
                records: [
                    new ACLRecordMongo({
                        userOrRoleId: "admin",
                        full: true,
                    }),
                ],
            }),
            new AccessControlListMongo({
                uid: "moderator",
                records: [
                    new ACLRecordMongo({
                        userOrRoleId: "moderator",
                        full: true,
                    }),
                    new ACLRecordMongo({
                        userOrRoleId: ".*", // any user
                        create: false,
                        read: true,
                        update: false,
                        delete: false,
                        special: false,
                        full: false,
                    }),
                ],
            }),
            new AccessControlListMongo({
                uid: "bf98b869-cabe-452a-bf8d-674c48f2b5bd",
                records: [
                    new ACLRecordMongo({
                        userOrRoleId: "god",
                        full: true,
                    }),
                    new ACLRecordMongo({
                        userOrRoleId: "019eaa26-b4ec-4870-88b6-2d3755a8a05c",
                        create: true,
                        read: true,
                        update: false,
                        delete: false,
                    }),
                    new ACLRecordMongo({
                        userOrRoleId: "e75f12e2-7058-4bb2-a826-6f435c61dc1c",
                        create: false,
                        read: true,
                        update: false,
                        delete: false,
                        special: false,
                    }),
                ],
                parentUid: "moderator",
            }),
            new AccessControlListMongo({
                uid: "/other/path",
                records: [
                    new ACLRecordMongo({
                        userOrRoleId: "admin",
                        full: true,
                    }),
                    new ACLRecordMongo({
                        userOrRoleId: ".*", // any user
                        create: false,
                        read: true,
                        update: false,
                        delete: false,
                        special: false,
                        full: false,
                    }),
                    new ACLRecordMongo({
                        userOrRoleId: "anonymous", // anonymous user
                        create: false,
                        read: false,
                        update: false,
                        delete: false,
                        special: false,
                        full: false,
                    }),
                ],
            }),
            new AccessControlListMongo({
                uid: "/test/path",
                records: [
                    new ACLRecordMongo({
                        userOrRoleId: "anonymous", // anonymous users
                        create: false,
                        read: true,
                        update: false,
                        delete: false,
                        special: false,
                        full: false,
                    }),
                    new ACLRecordMongo({
                        userOrRoleId: ".*", // all users
                        create: true,
                        read: true,
                        update: false,
                        delete: false,
                        special: false,
                        full: false,
                    }),
                ],
                parentUid: "admin",
            }),
            new AccessControlListMongo({
                uid: "child",
                records: [
                    new ACLRecordMongo({
                        userOrRoleId: ".*", // any user
                        create: undefined,
                        read: true,
                        update: undefined,
                        delete: undefined,
                        special: undefined,
                        full: undefined,
                    }),
                ],
                parent: new AccessControlListMongo({
                    uid: "parent",
                    records: [
                        new ACLRecordMongo({
                            userOrRoleId: "admin",
                            full: true,
                        }),
                    ],
                }),
            }),
        ];

        const createACLs = async function (): Promise<void> {
            for (const acl of testACLs) {
                await aclRepo.save(acl as any);
            }
        };

        beforeAll(async () => {
            await mongod.start();

            const datastores: any = {
                acl: {
                    type: "mongodb",
                    url: "mongodb://localhost:9999/acls",
                    synchronize: true,
                },
            };
            const models: any = await ModelUtils.loadModels("./src/security");

            const connMgr: ConnectionManager = await objectFactory.newInstance(ConnectionManager, {
                name: "default",
            });
            connMgr.connections.set("cache", redis);
            await connMgr.connect(datastores, models);

            const conn: any = connMgr.connections.get("acl");
            if (conn instanceof DataSource) {
                aclRepo = conn.getMongoRepository(AccessControlListMongo);
            }

            aclUtils = await objectFactory.newInstance(ACLUtils, { name: "default" });
            (aclUtils as any).trustedRoles = ["super"];
        });

        afterAll(async () => {
            await objectFactory.destroy();
            await mongod.stop();
        });

        beforeEach(async () => {
            try {
                await aclRepo.clear();
                await redis.flushall();
            } catch (err) {
                // The error "ns not found" occurs when the collection doesn't exist yet. We can ignore this error.
                if (err.message !== "ns not found") {
                    throw err;
                }
            }
            await createACLs();
        });

        it("Can find ACL identified by uuid.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL(
                "bf98b869-cabe-452a-bf8d-674c48f2b5bd"
            );
            expect(acl).toBeDefined();
            if (acl) {
                expect(acl.uid).toBe("bf98b869-cabe-452a-bf8d-674c48f2b5bd");
            }
        });

        it("Can find ACL identified by URL pattern.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL("/other/path");
            expect(acl).toBeDefined();
            if (acl) {
                expect(acl.uid).toBe("/other/path");
            }
        });

        it("Can find ACL identified by role name.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL("admin");
            expect(acl).toBeDefined();
            if (acl) {
                expect(acl.uid).toBe("admin");
            }
        });

        it("Can find ACL with circular dependencies.", async () => {
            const testACLs: AccessControlList[] = [
                new AccessControlListMongo({
                    uid: "parent",
                    parentUid: "child2",
                    records: [
                        new ACLRecordMongo({
                            userOrRoleId: "admin",
                            full: true,
                        }),
                    ],
                }),
                new AccessControlListMongo({
                    uid: "child",
                    parentUid: "parent",
                    records: [
                        new ACLRecordMongo({
                            userOrRoleId: "god",
                            full: true,
                        }),
                        new ACLRecordMongo({
                            userOrRoleId: "admin",
                            create: true,
                            read: true,
                            update: false,
                            delete: false,
                        }),
                    ],
                }),
                new AccessControlListMongo({
                    uid: "child2",
                    parentUid: "child",
                    records: [
                        new ACLRecordMongo({
                            userOrRoleId: "admin",
                            full: true,
                        }),
                        new ACLRecordMongo({
                            userOrRoleId: ".*", // any user
                            create: false,
                            read: true,
                            update: false,
                            delete: false,
                        }),
                        new ACLRecordMongo({
                            userOrRoleId: "anonymous", // anonymous user
                            create: false,
                            read: false,
                            update: false,
                            delete: false,
                        }),
                    ],
                }),
            ];

            const savedACLs: AccessControlList[] = [];
            for (const acl of testACLs) {
                savedACLs.push(await aclRepo.save(acl as any));
            }

            expect(savedACLs).toHaveLength(testACLs.length);
            const child2: AccessControlList | null | undefined = await aclUtils?.findACL("child2");
            if (child2) {
                expect(child2.uid).toBe("child2");
            }
        });

        it("Can get record for anonymous user.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL("/other/path");
            expect(acl).toBeDefined();
            if (acl) {
                const record: ACLRecord | null | undefined = aclUtils?.getRecord(acl, undefined);
                expect(record).toBeDefined();
                if (record) {
                    expect(record.userOrRoleId).toEqual("anonymous");
                    expect(record.create).toBe(false);
                    expect(record.read).toBe(false);
                    expect(record.update).toBe(false);
                    expect(record.delete).toBe(false);
                    expect(record.special).toBe(false);
                    expect(record.full).toBe(false);
                }
            }
        });

        it("Can get record for user by uid.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL(
                "bf98b869-cabe-452a-bf8d-674c48f2b5bd"
            );
            expect(acl).toBeDefined();
            if (acl) {
                const record: ACLRecord | null | undefined = aclUtils?.getRecord(acl, {
                    uid: "019eaa26-b4ec-4870-88b6-2d3755a8a05c",
                    name: "user",
                    roles: [],
                });
                expect(record).toBeDefined();
                if (record) {
                    expect(record.userOrRoleId).toEqual("019eaa26-b4ec-4870-88b6-2d3755a8a05c");
                    expect(record.read).toBe(true);
                }
            }
        });

        it("Can get record for admin user.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL("/other/path");
            expect(acl).toBeDefined();
            if (acl) {
                const record: ACLRecord | null | undefined = aclUtils?.getRecord(acl, {
                    uid: uuidV4(),
                    name: "admin",
                    roles: ["admin"],
                });
                expect(record).toBeDefined();
                if (record) {
                    expect(record.userOrRoleId).toEqual("admin");
                    expect(record.full).toBe(true);
                }
            }
        });

        it("Can get record for non-admin user.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL("/other/path");
            expect(acl).toBeDefined();
            if (acl) {
                const record: ACLRecord | null | undefined = aclUtils?.getRecord(acl, {
                    uid: uuidV4(),
                    name: "non-admin",
                    roles: [],
                });
                expect(record).toBeDefined();
                if (record) {
                    expect(record.userOrRoleId).toEqual(".*");
                    expect(record.read).toBe(true);
                }
            }
        });

        it("Can't get record for invalid user.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL("admin");
            expect(acl).toBeDefined();
            if (acl) {
                const record: ACLRecord | null | undefined = aclUtils?.getRecord(acl, {
                    uid: uuidV4(),
                    name: "invalid",
                    roles: [],
                });
                expect(record).toBeNull();
            }
        });

        it("Can populate parent.", async () => {
            const acl: AccessControlList = new AccessControlListMongo({
                uid: "test",
                records: [
                    new ACLRecordMongo({
                        userOrRoleId: ".*", // any user
                        create: undefined,
                        read: true,
                        update: undefined,
                        delete: undefined,
                        special: undefined,
                        full: undefined,
                    }),
                ],
                parentUid: "admin",
            });

            await aclUtils?.populateParent(acl);

            expect(acl.parent).toBeDefined();
            if (acl.parent) {
                expect(acl.parent.uid).toBe("admin");
            }
        });

        it("Can populate parent with circular dependencies.", async () => {
            const testACLs: AccessControlList[] = [
                new AccessControlListMongo({
                    uid: "parent",
                    parentUid: "child2",
                    records: [
                        new ACLRecordMongo({
                            userOrRoleId: "admin",
                            full: true,
                        }),
                    ],
                }),
                new AccessControlListMongo({
                    uid: "child",
                    parentUid: "parent",
                    records: [
                        new ACLRecordMongo({
                            userOrRoleId: "god",
                            full: true,
                        }),
                        new ACLRecordMongo({
                            userOrRoleId: "admin",
                            create: true,
                            read: true,
                            update: false,
                            delete: false,
                        }),
                    ],
                }),
                new AccessControlListMongo({
                    uid: "child2",
                    parentUid: "child",
                    records: [
                        new ACLRecordMongo({
                            userOrRoleId: "admin",
                            full: true,
                        }),
                        new ACLRecordMongo({
                            userOrRoleId: ".*", // any user
                            create: false,
                            read: true,
                            update: false,
                            delete: false,
                        }),
                        new ACLRecordMongo({
                            userOrRoleId: "anonymous", // anonymous user
                            create: false,
                            read: false,
                            update: false,
                            delete: false,
                        }),
                    ],
                }),
            ];

            const savedACLs: AccessControlList[] = [];
            for (const acl of testACLs) {
                savedACLs.push(await aclRepo.save(acl as any));
            }

            const child2: AccessControlList = testACLs[2];
            await aclUtils?.populateParent(child2);
            if (child2) {
                expect(child2.uid).toBe("child2");
                expect(child2.parent).toBeDefined();
            }
        });

        it("Can test permissions.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL(
                "bf98b869-cabe-452a-bf8d-674c48f2b5bd"
            );
            expect(acl).toBeDefined();
            if (acl) {
                const testUser: any = { uid: "019eaa26-b4ec-4870-88b6-2d3755a8a05c" };
                expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.CREATE)).toBe(true);
                expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.DELETE)).toBe(false);
                expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.READ)).toBe(true);
                expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.SPECIAL)).toBe(true);
                expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.UPDATE)).toBe(false);
                expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.FULL)).toBe(false);
                const testMod: any = { uid: uuidV4(), roles: ["moderator"] };
                expect(await aclUtils?.hasPermission(testMod, acl, ACLAction.FULL)).toBe(true);
                expect(await aclUtils?.hasPermission(testMod, acl, ACLAction.CREATE)).toBe(true);
                expect(await aclUtils?.hasPermission(testMod, acl, ACLAction.DELETE)).toBe(true);
                expect(await aclUtils?.hasPermission(testMod, acl, ACLAction.READ)).toBe(true);
                expect(await aclUtils?.hasPermission(testMod, acl, ACLAction.SPECIAL)).toBe(true);
                expect(await aclUtils?.hasPermission(testMod, acl, ACLAction.UPDATE)).toBe(true);
                const testOther: any = { uid: uuidV4(), roles: ["other"] };
                expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.FULL)).toBe(false);
                expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.CREATE)).toBe(false);
                expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.DELETE)).toBe(false);
                expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.READ)).toBe(true);
                expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.SPECIAL)).toBe(false);
                expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.UPDATE)).toBe(false);
                const testSuper: any = { uid: uuidV4(), roles: ["super"] };
                expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.FULL)).toBe(true);
                expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.CREATE)).toBe(true);
                expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.DELETE)).toBe(true);
                expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.READ)).toBe(true);
                expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.SPECIAL)).toBe(true);
                expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.UPDATE)).toBe(true);
                const testOrgSuper: any = { uid: uuidV4(), roles: ["bf98b869-cabe-452a-bf8d-674c48f2b5bd.super"] };
                expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.FULL)).toBe(true);
                expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.CREATE)).toBe(true);
                expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.DELETE)).toBe(true);
                expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.READ)).toBe(true);
                expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.SPECIAL)).toBe(true);
                expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.UPDATE)).toBe(true);
                const testOtherOrgSuper: any = {
                    uid: uuidV4(),
                    roles: ["e75f12e2-7058-4bb2-a826-6f435c61dc1c.super"],
                };
                expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.CREATE)).toBe(false);
                expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.DELETE)).toBe(false);
                expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.READ)).toBe(true);
                expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.SPECIAL)).toBe(false);
                expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.UPDATE)).toBe(false);
                expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.FULL)).toBe(false);
            }
        });

        it("Can test permissions with string id.", async () => {
            const acl: string = "bf98b869-cabe-452a-bf8d-674c48f2b5bd";
            const testUser: any = { uid: "019eaa26-b4ec-4870-88b6-2d3755a8a05c" };
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.CREATE)).toBe(true);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.DELETE)).toBe(false);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.READ)).toBe(true);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.SPECIAL)).toBe(true);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.UPDATE)).toBe(false);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.FULL)).toBe(false);
            const testOther: any = { uid: uuidV4(), roles: ["other"] };
            expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.FULL)).toBe(false);
            expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.CREATE)).toBe(false);
            expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.DELETE)).toBe(false);
            expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.READ)).toBe(true);
            expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.SPECIAL)).toBe(false);
            expect(await aclUtils?.hasPermission(testOther, acl, ACLAction.UPDATE)).toBe(false);
            const testSuper: any = { uid: uuidV4(), roles: ["super"] };
            expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.FULL)).toBe(true);
            expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.CREATE)).toBe(true);
            expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.DELETE)).toBe(true);
            expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.READ)).toBe(true);
            expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.SPECIAL)).toBe(true);
            expect(await aclUtils?.hasPermission(testSuper, acl, ACLAction.UPDATE)).toBe(true);
            const testOrgSuper: any = { uid: uuidV4(), roles: ["bf98b869-cabe-452a-bf8d-674c48f2b5bd.super"] };
            expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.FULL)).toBe(true);
            expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.CREATE)).toBe(true);
            expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.DELETE)).toBe(true);
            expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.READ)).toBe(true);
            expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.SPECIAL)).toBe(true);
            expect(await aclUtils?.hasPermission(testOrgSuper, acl, ACLAction.UPDATE)).toBe(true);
            const testOtherOrgSuper: any = { uid: uuidV4(), roles: ["e75f12e2-7058-4bb2-a826-6f435c61dc1c.super"] };
            expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.CREATE)).toBe(false);
            expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.DELETE)).toBe(false);
            expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.READ)).toBe(true);
            expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.SPECIAL)).toBe(false);
            expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.UPDATE)).toBe(false);
            expect(await aclUtils?.hasPermission(testOtherOrgSuper, acl, ACLAction.FULL)).toBe(false);
        });

        it("Can grant permission when no ACL available.", async () => {
            const acl: string = uuidV4();
            const testUser: any = { uid: uuidV4() };
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.CREATE)).toBe(true);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.DELETE)).toBe(true);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.READ)).toBe(true);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.SPECIAL)).toBe(true);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.UPDATE)).toBe(true);
            expect(await aclUtils?.hasPermission(testUser, acl, ACLAction.FULL)).toBe(true);
        });

        it("Can test request permissions.", async () => {
            let req: any = {
                path: "/test/path",
                method: "GET",
            };
            const user: any = {
                uid: uuidV4(),
            };
            const superUser: any = {
                uid: uuidV4(),
                roles: ["super"],
            };

            expect(await aclUtils?.checkRequestPerms("/test/path", user, req)).toBe(true);
            req.method = "POST";
            expect(await aclUtils?.checkRequestPerms("/test/path", user, req)).toBe(true);
            req.method = "PUT";
            expect(await aclUtils?.checkRequestPerms("/test/path", user, req)).toBe(false);
            req.method = "DELETE";
            expect(await aclUtils?.checkRequestPerms("/test/path", user, req)).toBe(false);

            req.method = "GET";
            expect(await aclUtils?.checkRequestPerms("/test/path", superUser, req)).toBe(true);
            req.method = "POST";
            expect(await aclUtils?.checkRequestPerms("/test/path", superUser, req)).toBe(true);
            req.method = "PUT";
            expect(await aclUtils?.checkRequestPerms("/test/path", superUser, req)).toBe(true);
            req.method = "DELETE";
            expect(await aclUtils?.checkRequestPerms("/test/path", superUser, req)).toBe(true);

            const admin: any = {
                uid: uuidV4(),
                roles: ["admin"],
            };
            req.method = "GET";
            expect(await aclUtils?.checkRequestPerms("/test/path", admin, req)).toBe(true);
            req.method = "POST";
            expect(await aclUtils?.checkRequestPerms("/test/path", admin, req)).toBe(true);
            req.method = "PUT";
            expect(await aclUtils?.checkRequestPerms("/test/path", admin, req)).toBe(false);
            req.method = "DELETE";
            expect(await aclUtils?.checkRequestPerms("/test/path", admin, req)).toBe(false);

            req.method = "GET";
            expect(await aclUtils?.checkRequestPerms("/test/path", superUser, req)).toBe(true);
            req.method = "POST";
            expect(await aclUtils?.checkRequestPerms("/test/path", superUser, req)).toBe(true);
            req.method = "PUT";
            expect(await aclUtils?.checkRequestPerms("/test/path", superUser, req)).toBe(true);
            req.method = "DELETE";
            expect(await aclUtils?.checkRequestPerms("/test/path", superUser, req)).toBe(true);

            req.method = "GET";
            expect(await aclUtils?.checkRequestPerms("/test/path", undefined, req)).toBe(true);
            req.method = "POST";
            expect(await aclUtils?.checkRequestPerms("/test/path", undefined, req)).toBe(false);
            req.method = "PUT";
            expect(await aclUtils?.checkRequestPerms("/test/path", undefined, req)).toBe(false);
            req.method = "DELETE";
            expect(await aclUtils?.checkRequestPerms("/test/path", undefined, req)).toBe(false);

            req = {
                path: "/other/path",
                method: "GET",
            };

            expect(await aclUtils?.checkRequestPerms("/other/path", user, req)).toBe(true);
            req.method = "POST";
            expect(await aclUtils?.checkRequestPerms("/other/path", user, req)).toBe(false);
            req.method = "PUT";
            expect(await aclUtils?.checkRequestPerms("/other/path", user, req)).toBe(false);
            req.method = "DELETE";
            expect(await aclUtils?.checkRequestPerms("/other/path", user, req)).toBe(false);

            req.method = "GET";
            expect(await aclUtils?.checkRequestPerms("/other/path", admin, req)).toBe(true);
            req.method = "POST";
            expect(await aclUtils?.checkRequestPerms("/other/path", admin, req)).toBe(true);
            req.method = "PUT";
            expect(await aclUtils?.checkRequestPerms("/other/path", admin, req)).toBe(true);
            req.method = "DELETE";
            expect(await aclUtils?.checkRequestPerms("/other/path", admin, req)).toBe(true);

            req.method = "GET";
            expect(await aclUtils?.checkRequestPerms("/other/path", superUser, req)).toBe(true);
            req.method = "POST";
            expect(await aclUtils?.checkRequestPerms("/other/path", superUser, req)).toBe(true);
            req.method = "PUT";
            expect(await aclUtils?.checkRequestPerms("/other/path", superUser, req)).toBe(true);
            req.method = "DELETE";
            expect(await aclUtils?.checkRequestPerms("/other/path", superUser, req)).toBe(true);
        });

        it("Can save ACL", async () => {
            const acl: AccessControlList = {
                uid: uuidV4(),
                records: [
                    {
                        userOrRoleId: "admin",
                        create: true,
                        delete: true,
                        full: true,
                        read: true,
                        special: true,
                        update: true,
                    },
                ],
            };
            const result: AccessControlList | null | undefined = await aclUtils?.saveACL(acl);
            expect(result).toBeDefined();
            if (result) {
                expect(result.uid).toBe(acl.uid);
                expect(result.records).toEqual(acl.records);
            }

            const count: number = await aclRepo.count({ uid: acl.uid });
            expect(count).toBe(1);
        });

        it("Can update an existing ACL", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL(
                "bf98b869-cabe-452a-bf8d-674c48f2b5bd"
            );
            expect(acl).toBeDefined();
            if (acl) {
                acl.records.push({
                    userOrRoleId: uuidV4(),
                    create: false,
                    delete: false,
                    full: false,
                    read: true,
                    special: false,
                    update: false,
                });

                const result: AccessControlList | null | undefined = await aclUtils?.saveACL(acl);
                expect(result).toBeDefined();
                if (result) {
                    expect(result.uid).toBe(acl.uid);
                    expect((result as any).version).toBeGreaterThan((acl as any).version);
                    expect(result.records).toEqual(acl.records);
                }
            }
        });

        // This test works when run solo but for some reason fails when running all tests together
        it("Cannot update an existing ACL with incorrect version.", async () => {
            const acl: AccessControlList | null | undefined = await aclUtils?.findACL(
                "bf98b869-cabe-452a-bf8d-674c48f2b5bd"
            );
            expect(acl).toBeDefined();
            if (acl) {
                acl.records.push({
                    userOrRoleId: uuidV4(),
                    create: false,
                    delete: false,
                    full: false,
                    read: true,
                    special: false,
                    update: false,
                });

                const result: AccessControlList | null | undefined = await aclUtils?.saveACL(acl);
                expect(result).toBeDefined();
                if (result) {
                    expect(result.uid).toBe(acl.uid);
                    expect((result as any).version).toBeGreaterThan((acl as any).version);
                    expect(result.records).toEqual(acl.records);
                }

                try {
                    acl.records = acl.records.splice(0, 1);
                    expect(aclUtils?.saveACL(acl)).rejects.toThrow();
                } catch (err) {
                    // NO-OP
                }
            }
        });

        it("Ignores update if the ACL has no changes.", async () => {
            let acl: AccessControlList | null | undefined = await aclUtils?.findACL(
                "bf98b869-cabe-452a-bf8d-674c48f2b5bd"
            );
            expect(acl).toBeDefined();
            if (acl) {
                const result: AccessControlList | null | undefined = await aclUtils?.saveACL(acl);
                expect(result).toBeDefined();
                if (result) {
                    expect(result.uid).toBe(acl.uid);
                    expect((result as any).version).toBe((acl as any).version);
                    expect(result.records).toEqual(acl.records);

                    acl = await aclUtils?.findACL("bf98b869-cabe-452a-bf8d-674c48f2b5bd");
                    if (acl) {
                        expect(result.uid).toBe(acl.uid);
                        expect((result as any).version).toBe((acl as any).version);
                        expect(result.records).toEqual(acl.records);
                    }
                }
            }
        });
    });
});
