///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { default as config } from "../config";
import { request } from "../../src/test/request.js";
import { Server, ConnectionManager, ObjectFactory, MongoConnection, MongoRepository, isSqlDataSource } from "../../src";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../server/models/User";
import { Logger } from "@rapidrest/core";
import * as uuid from "uuid";
import Player from "../server/models/Player";
import Item from "../server/models/Item";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
    },
});

vi.setConfig({ testTimeout: 60000 });
describe("ModelRoute Tests [MongoDB]", () => {
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", objectFactory });
    let repo: MongoRepository<any>;
    let itemRepo: any;

    const createUser = async (name: string, firstName: string, lastName: string, age: number = 21): Promise<User> => {
        const user: User = new User({
            name,
            firstName,
            lastName,
            age,
            password: "password",
        });

        return await repo.save(user);
    };

    const createUsers = async (num: number, lastName: string = "Doctor"): Promise<User[]> => {
        const results: User[] = [];

        for (let i = 1; i <= num; i++) {
            results.push(await createUser(`user-${i}`, String(i), lastName, 100 * i));
        }

        return results;
    };

    const createPlayer = async (
        name: string,
        firstName: string,
        lastName: string,
        age: number = 21,
        skillRating: number = 1500,
    ): Promise<Player> => {
        const player: Player = new Player({
            name,
            firstName,
            lastName,
            age,
            skillRating,
        });

        return await repo.save(player);
    };

    const createPlayers = async (
        num: number,
        lastName: string = "Doctor",
        skillRating: number = 1500,
    ): Promise<Player[]> => {
        const results: Player[] = [];

        for (let i = 1; i <= num; i++) {
            results.push(await createPlayer(`user-${i}`, String(i), lastName, 100 * i, skillRating));
        }

        return results;
    };

    const createItem = async (data?: any): Promise<Item> => {
        const item: Item = new Item(data);
        return await itemRepo.save(item);
    };

    const createItems = async (num: number, data?: any): Promise<Item[]> => {
        const results: Item[] = [];

        for (let i = 1; i <= num; i++) {
            results.push(await createItem({ name: "Item" + i }));
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
        conn = connMgr?.connections.get("sqlite");
        if (isSqlDataSource(conn)) {
            itemRepo = conn.getRepository(Item);
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
            await itemRepo.clear();
        } catch (err) {
            // The error "ns not found" occurs when the collection doesn't exist yet. We can ignore this error.
            if (err.message !== "ns not found") {
                throw err;
            }
        }
    });

    describe("Single Document Tests [MongoDB]", () => {
        it("Can create document. [MongoDB]", async () => {
            const user: User = new User({
                name: "dtennant",
                firstName: "David",
                lastName: "Tennant",
                age: 47,
                password: "password",
            });
            const result = await request(server).post("/users").send(user);
            expect(result.status).toBe(200);
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

        it("Cannot create document with same name. [MongoDB]", async () => {
            await createUser("dtennant", "David", "Tennant", 47);
            const user: User = new User({
                name: "dtennant",
                firstName: "David",
                lastName: "Tennant",
                age: 47,
                password: "password",
            });
            const result = await request(server).post("/users").send(user);
            expect(result.status).toBe(400);

            const stored: User | null = await repo.findOne({ uid: user.uid } as any);
            expect(stored).toBeNull();
            const count: number = await repo.count({ name: "dtennant" });
            expect(count).toBe(1);
        });

        it("Can create child document. [MongoDB]", async () => {
            const items: Item[] = await createItems(5);
            const parent: User = await createUser("parent", "John", "Smith");
            const player: Player = new Player({
                name: "dtennant",
                firstName: "David",
                lastName: "Tennant",
                age: 47,
                items: items.map((item) => item.uid),
                parentUid: parent.uid,
                password: "password",
                skillRating: 2500,
            });
            const result = await request(server).post("/users").send(player);
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(player.uid);
            expect(result.body.version).toEqual(player.version);
            expect(result.body.firstName).toEqual(player.firstName);
            expect(result.body.lastName).toEqual(player.lastName);
            expect(result.body.age).toEqual(player.age);
            expect(result.body.skillRating).toEqual(player.skillRating);

            // NOTE: We use aggregate here because if we use the find functions it will automatically filter
            // the results to the parent type (base class).
            const stored: Player | null = (await repo
                .aggregate([
                    {
                        $match: { uid: player.uid },
                    },
                ])
                .limit(1)
                .next()) as Player;
            expect(stored).toBeDefined();
            if (stored) {
                expect(stored.uid).toEqual(player.uid);
                expect(stored.version).toEqual(player.version);
                expect(stored.firstName).toEqual(player.firstName);
                expect(stored.lastName).toEqual(player.lastName);
                expect(stored.age).toEqual(player.age);
                expect(stored.skillRating).toEqual(player.skillRating);
            }
        });

        it("Cannot create child document with invalid parent id. [MongoDB]", async () => {
            const items: Item[] = await createItems(5);
            const player: Player = new Player({
                name: "dtennant",
                firstName: "David",
                lastName: "Tennant",
                age: 47,
                items: items.map((item) => item.uid),
                parentUid: uuid.v4(),
                skillRating: 2500,
                password: "password",
            });
            const result = await request(server).post("/users").send(player);
            expect(result.status).toBe(400);
        });

        it("Cannot create child document with invalid item id. [MongoDB]", async () => {
            const items: Item[] = await createItems(5);
            const parent: User = await createUser("parent", "John", "Smith");
            const player: Player = new Player({
                name: "dtennant",
                firstName: "David",
                lastName: "Tennant",
                age: 47,
                items: items.map((item) => item.uid).concat([uuid.v4()]),
                parentUid: parent.uid,
                skillRating: 2500,
                password: "password",
            });
            const result = await request(server).post("/users").send(player);
            expect(result.status).toBe(400);
        });

        it("Can delete document. [MongoDB]", async () => {
            const user: User = await createUser("dtennant", "David", "Tennant", 47);
            const result = await request(server).delete("/users/" + user.uid);
            expect(result.status).toBe(204);

            const existing: User | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeNull();
        });

        it("Can test if document exists. [MongoDB]", async () => {
            const user: User = await createUser("dtennant", "David", "Tennant", 47);
            const result = await request(server)
                .head("/users/" + user.uid)
                .send();
            expect(result.status).toBeGreaterThanOrEqual(200);
            expect(result.status).toBeLessThan(300);
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((1).toString());
        });

        it("Can test if document doesn't exist. [MongoDB]", async () => {
            const result = await request(server)
                .head("/users/" + uuid.v4())
                .send();
            expect(result.status).toBe(404);
        });

        it("Can find document by id. [MongoDB]", async () => {
            const user: User = await createUser("dtennant", "David", "Tennant", 47);
            const result = await request(server)
                .get("/users/" + user.uid.toUpperCase())
                .send();
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual("");
            expect(result.body.lastName).toEqual("");
            expect(result.body.age).toEqual(user.age);
        });

        it("Can find child document by id. [MongoDB]", async () => {
            const player: Player = await createPlayer("dtennant", "David", "Tennant", 47, 2500);
            const result = await request(server)
                .get("/users/" + player.uid.toUpperCase())
                .send();
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(player.uid);
            expect(result.body.version).toEqual(player.version);
            expect(result.body.firstName).toEqual("");
            expect(result.body.lastName).toEqual("");
            expect(result.body.age).toEqual(player.age);
            expect(result.body.skillRating).toEqual(player.skillRating);
        });

        it("Can find document by id by name. [MongoDB]", async () => {
            const user: User = await createUser("dtennant", "David", "Tennant", 47);
            await createUser("dtennant2", "David", "Tennant", 47);
            await createUser("dtennant3", "David", "Tennant", 47);
            const result = await request(server)
                .get("/users/" + user.name)
                .send();
            expect(result).toHaveProperty("body");
            expect(result.body.uid).toEqual(user.uid);
            expect(result.body.version).toEqual(user.version);
            expect(result.body.firstName).toEqual("");
            expect(result.body.lastName).toEqual("");
            expect(result.body.age).toEqual(user.age);
        });

        it("Can update document. [MongoDB]", async () => {
            const user: User = await createUser("dtennant", "David", "Tennant", 47);
            const diff: any = {
                firstName: "Doctor",
                lastName: "Who",
                uid: user.uid,
                version: user.version,
            };
            const result = await request(server)
                .put("/users/" + user.uid.toUpperCase())
                .send(diff);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(user.uid);
            expect(result.body.name).toBe(user.name);
            expect(result.body.version).toBeGreaterThan(user.version);
            expect(result.body.firstName).toBe(diff.firstName);
            expect(result.body.lastName).toBe(diff.lastName);
            expect(result.body.age).toBe(user.age);

            const existing: User | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(result.body.uid);
                expect(existing.name).toBe(result.body.name);
                expect(existing.version).toBe(result.body.version);
                expect(existing.firstName).toBe(result.body.firstName);
                expect(existing.lastName).toBe(result.body.lastName);
                expect(existing.age).toBe(result.body.age);
            }
        });

        it("Can update child document. [MongoDB]", async () => {
            const player: Player = await createPlayer("dtennant", "David", "Tennant", 47, 2500);
            const diff: any = {
                firstName: "Doctor",
                lastName: "Who",
                skillRating: 3500,
                uid: player.uid,
                version: player.version,
            };
            const result = await request(server)
                .put("/users/" + player.uid.toUpperCase())
                .send(diff);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(player.uid);
            expect(result.body.name).toBe(player.name);
            expect(result.body.version).toBeGreaterThan(player.version);
            expect(result.body.firstName).toBe(diff.firstName);
            expect(result.body.lastName).toBe(diff.lastName);
            expect(result.body.age).toBe(player.age);
            expect(result.body.skillRating).toBe(diff.skillRating);

            const existing: Player | null = (await repo
                .aggregate([{ $match: { uid: player.uid } }])
                .limit(1)
                .next()) as Player;
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(result.body.uid);
                expect(existing.name).toBe(result.body.name);
                expect(existing.version).toBe(result.body.version);
                expect(existing.firstName).toBe(result.body.firstName);
                expect(existing.lastName).toBe(result.body.lastName);
                expect(existing.age).toBe(result.body.age);
                expect(existing.skillRating).toBe(result.body.skillRating);
            }
        });

        // Disabling this test because sending a primitive JSON value via supertest doesn't work as expected
        it("Can update document property. [MongoDB]", async () => {
            const user: User = await createUser("dtennant", "David", "Tennant", 47);
            const diff: any = {
                firstName: "Doctor",
                lastName: "Who",
                age: 900,
            };
            let result = await request(server)
                .put("/users/" + user.uid.toUpperCase() + "/age")
                .send(diff.age);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(user.uid);
            expect(result.body.name).toBe(user.name);
            expect(result.body.version).toBeGreaterThan(user.version);
            expect(result.body.firstName).toBe(user.firstName);
            expect(result.body.lastName).toBe(user.lastName);
            expect(result.body.age).toBe(diff.age);

            result = await request(server)
                .put("/users/" + user.uid.toUpperCase() + "/firstName")
                .send(`"${diff.firstName}"`);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(user.uid);
            expect(result.body.name).toBe(user.name);
            expect(result.body.version).toBeGreaterThan(user.version);
            expect(result.body.firstName).toBe(diff.firstName);
            expect(result.body.lastName).toBe(user.lastName);
            expect(result.body.age).toBe(diff.age);

            result = await request(server)
                .put("/users/" + user.uid.toUpperCase() + "/lastName")
                .send(`"${diff.lastName}"`);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveProperty("uid");
            expect(result.body.uid).toBe(user.uid);
            expect(result.body.name).toBe(user.name);
            expect(result.body.version).toBeGreaterThan(user.version);
            expect(result.body.firstName).toBe(diff.firstName);
            expect(result.body.lastName).toBe(diff.lastName);
            expect(result.body.age).toBe(diff.age);

            const existing: User | null = await repo.findOne({ uid: user.uid } as any);
            expect(existing).toBeDefined();
            if (existing) {
                expect(existing.uid).toBe(result.body.uid);
                expect(existing.name).toBe(result.body.name);
                expect(existing.version).toBe(result.body.version);
                expect(existing.firstName).toBe(result.body.firstName);
                expect(existing.lastName).toBe(result.body.lastName);
                expect(existing.age).toBe(result.body.age);
            }
        });
    });

    describe("Multiple Document Tests [MongoDB]", () => {
        it("Can create documents in bulk. [MongoDB]", async () => {
            const users: User[] = [];
            const uids: string[] = [];
            for (let i = 1; i <= 5; i++) {
                const user: User = new User({
                    name: "dtennant" + i,
                    firstName: "David",
                    lastName: "Tennant",
                    age: 47,
                    password: "password",
                });
                users.push(user);
                uids.push(user.uid);
            }
            const result = await request(server).post("/users").send(users);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);

            const stored: User[] | null = await repo.find({ uid: { $in: uids } } as any).toArray();
            expect(stored).toBeDefined();
            expect(stored).toHaveLength(users.length);
            if (stored) {
                const userMap = new Map(users.map((u) => [u.uid, u]));
                for (const user of stored) {
                    const original = userMap.get(user.uid)!;
                    expect(original).toBeDefined();
                    expect(user.version).toEqual(original.version);
                    expect(user.firstName).toEqual(original.firstName);
                    expect(user.lastName).toEqual(original.lastName);
                    expect(user.age).toEqual(original.age);
                }
            }
        });

        it("Can create base and child documents in bulk. [MongoDB]", async () => {
            const users: Array<User | Player> = [];
            const uids: string[] = [];
            for (let i = 1; i <= 5; i++) {
                const data: any = {
                    name: "dtennant" + i,
                    firstName: "David",
                    lastName: "Tennant",
                    age: 47,
                    password: "password",
                };
                const user: User = Math.random() < 0.5 ? new User(data) : new Player(data);
                users.push(user);
                uids.push(user.uid);
            }
            const result = await request(server).post("/users").send(users);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);

            const stored: Array<User | Player> | null = await repo
                .aggregate([{ $match: { uid: { $in: uids } } }])
                .toArray();
            expect(stored).toBeDefined();
            expect(stored).toHaveLength(users.length);
            if (stored) {
                const userMap = new Map(users.map((u) => [u.uid, u]));
                for (const user of stored) {
                    const original = userMap.get(user.uid)!;
                    expect(original).toBeDefined();
                    expect(user.version).toEqual(original.version);
                    expect(user.firstName).toEqual(original.firstName);
                    expect(user.lastName).toEqual(original.lastName);
                    expect(user.age).toEqual(original.age);
                    if ((original as any)._type === "Player") {
                        expect((user as Player).skillRating).toEqual((original as Player).skillRating);
                    }
                }
            }
        });

        it("Cannot create documents in bulk with same name. [MongoDB]", async () => {
            const users: User[] = [];
            const uids: string[] = [];
            for (let i = 1; i <= 5; i++) {
                const user: User = new User({
                    name: "dtennant",
                    firstName: "David",
                    lastName: "Tennant",
                    age: 47,
                    password: "password",
                });
                users.push(user);
                uids.push(user.uid);
            }
            const result = await request(server).post("/users").send(users);
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
            expect(result.body[0]).toBeNull();
            for (let i = 1; i < result.body.length; i++) {
                const err: any = result.body[i];
                expect(err.status).toBe(400);
            }

            const stored: User[] | null = await repo.find({ uid: { $in: uids } } as any).toArray();
            expect(stored).toBeDefined();
            expect(stored).toHaveLength(1);
            if (stored) {
                const user: User = stored[0];
                expect(user.uid).toEqual(users[0].uid);
                expect(user.version).toEqual(users[0].version);
                expect(user.firstName).toEqual(users[0].firstName);
                expect(user.lastName).toEqual(users[0].lastName);
                expect(user.age).toEqual(users[0].age);
            }
        });

        it("Can count documents. [MongoDB]", async () => {
            const users: User[] = await createUsers(20);
            const result = await request(server).head("/users");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Can count base and child documents. [MongoDB]", async () => {
            const users: User[] = await createUsers(20);
            const players: Player[] = await createPlayers(30);
            const result = await request(server).head("/users");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((users.length + players.length).toString());
        });

        it("Can count documents with criteria (eq). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?lastName=Doctor");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toEqual(users.length.toString());
        });

        it("Can count documents with criteria (like-regex). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?lastName=like(Doc.*)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Can count documents with criteria (ne). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?lastName=ne(Doctor)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((2).toString());
        });

        it("Can count documents with criteria (like). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?lastName=like(Doc)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Can count documents with criteria (in). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?lastName=in(Tennant,Smith)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((2).toString());
        });

        it("Can count documents with criteria (nin). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?lastName=nin(Tennant,Smith)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Can count documents with criteria (gt). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?age=gt(100)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((users.length - 1).toString());
        });

        it("Can count documents with criteria (gte). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?age=gte(100)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe(users.length.toString());
        });

        it("Can count documents with criteria (lt). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?age=lt(100)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((2).toString());
        });

        it("Can count documents with criteria (lte). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?age=lte(100)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((3).toString());
        });

        it("Can count documents with criteria (range). [MongoDB]", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).head("/users?age=range(100,500)");
            expect(result.headers).toHaveProperty("content-length");
            expect(result.headers["content-length"]).toBe((5).toString());
        });

        it("Can find all documents. [MongoDB]", async () => {
            const users: User[] = await createUsers(25);
            const result = await request(server).get("/users");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
            for (let i = 0; i < users.length; i++) {
                expect(result.body[i].uid).toEqual(users[i].uid);
                expect(result.body[i].age).toEqual(users[i].age);
                expect(result.body[i].dateCreated).toEqual(users[i].dateCreated.toISOString());
                expect(result.body[i].dateModified).toEqual(users[i].dateModified.toISOString());
                expect(result.body[i].firstName).toEqual(users[i].firstName);
                expect(result.body[i].lastName).toEqual(users[i].lastName);
                expect(result.body[i].name).toEqual(users[i].name);
                // expect(result.body[i].uType).toEqual(users[i].uType);
                expect(result.body[i].version).toEqual(users[i].version);
            }
        });

        it("Can find all base and child documents. [MongoDB]", async () => {
            const all: Array<User | Player> = (await createUsers(5))
                .concat(await createPlayers(7))
                .concat(await createUsers(12))
                .concat(await createPlayers(18));
            const result = await request(server).get("/users");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(all.length);
            for (let i = 0; i < all.length; i++) {
                expect(result.body[i].uid).toEqual(all[i].uid);
                expect(result.body[i].age).toEqual(all[i].age);
                expect(result.body[i].dateCreated).toEqual(all[i].dateCreated.toISOString());
                expect(result.body[i].dateModified).toEqual(all[i].dateModified.toISOString());
                expect(result.body[i].firstName).toEqual(all[i].firstName);
                expect(result.body[i].lastName).toEqual(all[i].lastName);
                expect(result.body[i].name).toEqual(all[i].name);
                // expect(result.body[i].uType).toEqual(all[i].uType);
                expect(result.body[i].version).toEqual(all[i].version);
                if (all[i] instanceof Player) {
                    expect(result.body[i].skillRating).toEqual((all[i] as Player).skillRating);
                }
            }
        });

        it("Can find all documents with pagination. [MongoDB]", async () => {
            const users: User[] = await createUsers(25);
            let result = await request(server).get("/users?limit=5&page=0");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(5);
            for (let i = 0; i < result.body.length; i++) {
                expect(result.body[i].uid).toEqual(users[i].uid);
            }

            result = await request(server).get("/users?limit=5&page=1");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(5);
            for (let i = 0; i < result.body.length; i++) {
                expect(result.body[i].uid).toEqual(users[i + 5].uid);
            }

            result = await request(server).get("/users?limit=5&page=2");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(5);
            for (let i = 0; i < result.body.length; i++) {
                expect(result.body[i].uid).toEqual(users[i + 10].uid);
            }

            result = await request(server).get("/users?limit=10&page=1");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(10);
            for (let i = 0; i < result.body.length; i++) {
                expect(result.body[i].uid).toEqual(users[i + 10].uid);
            }
        });

        it("Can find documents with criteria (eq) [MongoDB].", async () => {
            const users: User[] = await createUsers(13);
            await createUser("dtennant", "David", "Tennant", 47);
            await createUser("msmith", "Matt", "Smith", 36);
            const result = await request(server).get("/users?lastName=Doctor");
            expect(result).toHaveProperty("body");
            expect(result.body).toHaveLength(users.length);
            for (const user of result.body) {
                expect(user.lastName).toBe("Doctor");
            }
        });

        it("Can truncate datastore [MongoDB].", async () => {
            const users: User[] = await createUsers(20, "Doctor");
            await createUsers(5, "Skywalker");
            const result = await request(server).delete("/users");
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(0);
        });

        it("Can truncate datastore with criteria (eq) [MongoDB].", async () => {
            const users: User[] = await createUsers(20, "Doctor");
            await createUsers(5, "Skywalker");
            const result = await request(server).delete("/users?lastName=Doctor");
            expect(result.status).toBe(204);

            const count: number = await repo.count();
            expect(count).toBe(5);
        });

        it("Can update documents in bulk. [MongoDB].", async () => {
            const users: User[] = await createUsers(5, "Smith");
            const uids: string[] = [];
            const updates: any[] = [];
            for (const user of users) {
                updates.push({
                    uid: user.uid,
                    firstName: "Matt",
                    version: user.version,
                });
                uids.push(user.uid);
            }

            const result = await request(server).put("/users").send(updates);
            expect(result.status).toBe(200);

            const existing: User[] = await repo.find({ uid: { $in: uids } } as any).toArray();
            expect(existing).toHaveLength(users.length);
            const userMap = new Map(users.map((u) => [u.uid, u]));
            for (const saved of existing) {
                const original = userMap.get(saved.uid)!;
                expect(original).toBeDefined();
                expect(saved.name).toBe(original.name);
                expect(saved.firstName).toBe("Matt");
                expect(saved.lastName).toBe(original.lastName);
                expect(saved.version).toBeGreaterThan(original.version);
            }
        });

        it("Can update base and child documents in bulk. [MongoDB].", async () => {
            const all: Array<User | Player> = (await createUsers(5))
                .concat(await createPlayers(7))
                .concat(await createUsers(12))
                .concat(await createPlayers(18));
            const uids: string[] = [];
            const updates: any[] = [];
            for (const user of all) {
                if (user instanceof Player) {
                    updates.push({
                        uid: user.uid,
                        firstName: "Matt",
                        version: user.version,
                        skillRating: Math.floor(Math.random() * 3000),
                    });
                } else {
                    updates.push({
                        uid: user.uid,
                        firstName: "Matt",
                        version: user.version,
                    });
                }
                uids.push(user.uid);
            }

            const result = await request(server).put("/users").send(updates);
            expect(result.status).toBe(200);

            const existing: Array<User | Player> = await repo.aggregate([{ $match: { uid: { $in: uids } } }]).toArray();
            expect(existing).toHaveLength(all.length);
            const allMap = new Map(all.map((u, i) => [u.uid, { entity: u, update: updates[i] }]));
            for (const saved of existing) {
                const { entity: original, update } = allMap.get(saved.uid)!;
                expect(original).toBeDefined();
                expect(saved.age).toEqual(original.age);
                expect(saved.dateCreated).toEqual(original.dateCreated);
                expect(saved.dateModified.getTime()).toBeGreaterThan(original.dateModified.getTime());
                expect(saved.firstName).toEqual(update.firstName);
                expect(saved.lastName).toEqual(original.lastName);
                expect(saved.name).toEqual(original.name);
                // expect(saved.uType).toEqual(original.uType);
                expect(saved.version).toBeGreaterThan(original.version);
                if (original instanceof Player) {
                    expect((saved as Player).skillRating).toEqual((update as Player).skillRating);
                }
            }
        });

        it("Cannot update documents in bulk with outdated version. [MongoDB].", async () => {
            const users: User[] = await createUsers(5, "Smith");
            // Create a second version
            for (let i = 0; i < users.length; i++) {
                const user: User = users[i];
                const newUser: User = new User({
                    ...user,
                    _id: undefined, // This is necessary to ensure we get a new record
                    version: user.version + 1,
                });
                users[i] = await repo.save(newUser);
                // Make sure we now have two of this uid
                const count: number = await repo.count({ uid: user.uid });
                expect(count).toBe(2);
            }

            const uids: string[] = [];
            const updates: any[] = [];
            for (const user of users) {
                updates.push({
                    uid: user.uid,
                    firstName: "Matt",
                    version: 0,
                });
                uids.push(user.uid);
            }

            // Lets make sure the first one goes through
            updates[0].version = users[0].version;

            const result = await request(server).put("/users").send(updates);
            expect(result.status).toBe(409);
            expect(result.body).toHaveLength(users.length);

            for (let i = 0; i < users.length; i++) {
                if (i === 0) {
                    expect(result.body[i]).toBeNull();
                } else {
                    const err: any = result.body[i];
                    expect(err.status).toBe(409);
                }
            }
        });
    });
});
