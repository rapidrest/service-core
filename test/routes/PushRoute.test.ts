///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
// This mock MUST be defined before we import ConnectionManager (or anything that pulls it in such as Server)
vi.mock("ioredis", async () => {
    const RedisMock = await import("ioredis-mock");
    return { Redis: RedisMock.default || RedisMock };
});

import { default as config } from "../config";
import { BasePushRoute, MongoConnection, MongoRepository, ObjectFactory, Server } from "../../src";
import { ConnectionManager } from "../../src/database/ConnectionManager";
import { AccessControlListMongo } from "../../src/security/AccessControlListMongo";
import { MongoMemoryServer } from "mongodb-memory-server";
import * as sqlite3 from "sqlite3";
import * as uuid from "uuid";
import { requestws } from "../../src/test/requestws.js";
import { request } from "../../src/test/request.js";
import { WebSocket } from "ws";

import { ClassLoader, JWTUtils, Logger } from "@rapidrest/core";
import { Route } from "../../src/decorators/RouteDecorators";

const mongod: MongoMemoryServer = new MongoMemoryServer({
    instance: {
        port: 9999,
        dbName: "mongomemory-rrst-test",
    },
});
const sqlite: sqlite3.Database = new sqlite3.Database(":memory:");

@Route("/push")
class PushRoute extends BasePushRoute {}

vi.setConfig({ testTimeout: 60000 });
describe("BasePushRoute Tests", () => {
    const basePath = "/push";
    const classLoader: ClassLoader = new ClassLoader("./test/server", true, true, config.get("class_loader:ignore"));
    const objectFactory: ObjectFactory = new ObjectFactory(config, Logger());
    const server: Server = new Server({ config, basePath: "./test/server", classLoader, objectFactory });
    let aclRepo: MongoRepository<AccessControlListMongo>;

    /**
     * Saves a single ACL document for `channelUid` with the given records. Since Mongo `save()` inserts a new
     * document unless `_id` matches an existing one, all permissions for a given channel must be written together
     * in one call — saving them separately would create multiple documents sharing the same `uid`, and only one
     * would ever be found by `findACL`.
     */
    const saveChannelAcl = async (channelUid: string, records: any[]): Promise<void> => {
        await aclRepo.save(
            new AccessControlListMongo({
                uid: channelUid,
                dateCreated: new Date(),
                dateModified: Date.now(),
                version: 0,
                records,
            } as any),
        );
    };

    const readRecord = (userUid: string): any => ({
        userOrRoleId: userUid,
        create: false,
        read: true,
        update: false,
        delete: false,
        special: false,
        full: false,
    });

    const createRecord = (userUid: string): any => ({
        userOrRoleId: userUid,
        create: true,
        read: false,
        update: false,
        delete: false,
        special: false,
        full: false,
    });

    /** Grants the given user `read` access to the ACL entry identified by `channelUid`. */
    const grantChannelRead = (channelUid: string, userUid: string): Promise<void> =>
        saveChannelAcl(channelUid, [readRecord(userUid)]);

    /** Grants the given user `create` access to the ACL entry identified by `channelUid`. */
    const grantChannelCreate = (channelUid: string, userUid: string): Promise<void> =>
        saveChannelAcl(channelUid, [createRecord(userUid)]);

    beforeAll(async () => {
        config.set("datastores:events", { type: "redis", url: "redis://localhost:6379" });
        // Small caps make the limit tests fast and deterministic rather than needing to open dozens of
        // real sockets/subscriptions to hit the (much larger) production defaults.
        config.set("push:max_sockets_per_user", 2);
        config.set("push:max_subscriptions_per_user", 2);

        // Register the test route class with the class loader
        classLoader.getClasses().set("routes.PushRoute", PushRoute);

        await mongod.start();
        await server.start();

        const connMgr: ConnectionManager | undefined = objectFactory.getInstance(ConnectionManager);
        const conn: any = connMgr?.connections.get("acl");
        if (conn instanceof MongoConnection) {
            aclRepo = conn.getRepository(AccessControlListMongo);
        }
    });

    afterAll(async () => {
        await server.stop();
        await objectFactory.destroy();
        await mongod.stop();
        return await new Promise<void>((resolve) => {
            sqlite.close((err) => {
                if (err) {
                    console.log(err);
                }
                resolve();
            });
        });
    });

    describe("connect", () => {
        it("Can connect with a valid Authorization header.", async () => {
            const user: any = { uid: uuid.v4(), name: "user1" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);

            await requestws(server)
                .ws(basePath, { headers: { Authorization: `jwt ${token}` } })
                .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: [user.uid] })
                .close()
                .expectClosed();
        });

        it("Can connect via a LOGIN message.", async () => {
            const user: any = { uid: uuid.v4(), name: "user2" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);

            await requestws(server)
                .ws(basePath)
                .sendJson({ id: 0, type: "LOGIN", data: token })
                .expectJson({ id: 0, type: "LOGIN_RESPONSE", success: true })
                .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: [user.uid] })
                .close()
                .expectClosed();
        });

        it("Cannot connect with a malformed authentication token.", async () => {
            await requestws(server)
                .ws(basePath)
                .sendJson({ id: 0, type: "LOGIN", data: "not-a-valid-jwt" })
                .expectClosed(1002, "api-003");
        });

        it("Cannot connect without ever providing authentication.", async () => {
            await requestws(server)
                .ws(basePath)
                .expectClosed(1002, "Invalid or missing authentication token.");
        });

        it("Closes a connection beyond the per-user concurrent socket cap.", async () => {
            const user: any = { uid: uuid.v4(), name: "capuser1" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const wsOptions = { headers: { Authorization: `jwt ${token}` } };

            // The configured cap is 2 — the first two connections should succeed and stay open.
            const sockA: WebSocket = new WebSocket(`ws://localhost:${server.port}${basePath}`, wsOptions);
            await new Promise<void>((resolve, reject) => {
                sockA.once("open", () => resolve());
                sockA.once("error", reject);
            });
            const sockB: WebSocket = new WebSocket(`ws://localhost:${server.port}${basePath}`, wsOptions);
            await new Promise<void>((resolve, reject) => {
                sockB.once("open", () => resolve());
                sockB.once("error", reject);
            });

            try {
                // A third concurrent connection for the same user should be rejected immediately.
                const sockC: WebSocket = new WebSocket(`ws://localhost:${server.port}${basePath}`, wsOptions);
                const closeCode: number = await new Promise((resolve, reject) => {
                    sockC.once("close", (code: number) => resolve(code));
                    sockC.once("error", reject);
                });
                expect(closeCode).toBe(1008);
            } finally {
                sockA.close();
                sockB.close();
            }
        });
    });

    describe("SUBSCRIBE / UNSUBSCRIBE", () => {
        it("Can subscribe to a channel the user has read permission for.", async () => {
            const user: any = { uid: uuid.v4(), name: "subscriber1" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const channel: string = uuid.v4();
            await grantChannelRead(channel, user.uid);

            await requestws(server)
                .ws(basePath, { headers: { Authorization: `jwt ${token}` } })
                .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: [user.uid] })
                .sendJson({ id: 1, type: "SUBSCRIBE", data: channel })
                .expectJson({ id: 1, type: "SUBSCRIBED", success: true, data: [channel] })
                .close()
                .expectClosed();
        });

        it("Cannot subscribe to a channel the user does not have read permission for.", async () => {
            const user: any = { uid: uuid.v4(), name: "subscriber2" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const channel: string = uuid.v4(); // No ACL entry created — permission denied by default.

            await requestws(server)
                .ws(basePath, { headers: { Authorization: `jwt ${token}` } })
                .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: [user.uid] })
                .sendJson({ id: 1, type: "SUBSCRIBE", data: channel })
                .expectJson({ id: 1, type: "SUBSCRIBED", success: true, data: [] })
                .close()
                .expectClosed();
        });

        it("Only subscribes to the subset of requested channels the user has permission for.", async () => {
            const user: any = { uid: uuid.v4(), name: "subscriber3" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const allowed: string = uuid.v4();
            const denied: string = uuid.v4();
            await grantChannelRead(allowed, user.uid);

            await requestws(server)
                .ws(basePath, { headers: { Authorization: `jwt ${token}` } })
                .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: [user.uid] })
                .sendJson({ id: 1, type: "SUBSCRIBE", data: [allowed, denied] })
                .expectJson({ id: 1, type: "SUBSCRIBED", success: true, data: [allowed] })
                .close()
                .expectClosed();
        });

        it("Caps the number of channels a single user may be subscribed to.", async () => {
            const user: any = { uid: uuid.v4(), name: "subscriber5" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const channelA: string = uuid.v4();
            const channelB: string = uuid.v4();
            await grantChannelRead(channelA, user.uid);
            await grantChannelRead(channelB, user.uid);

            // The cap is 2, and connect() already subscribes the user to their own uid channel, leaving
            // budget for only 1 more — so of the 2 additionally-requested channels, only the first is approved.
            await requestws(server)
                .ws(basePath, { headers: { Authorization: `jwt ${token}` } })
                .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: [user.uid] })
                .sendJson({ id: 1, type: "SUBSCRIBE", data: [channelA, channelB] })
                .expectJson({ id: 1, type: "SUBSCRIBED", success: true, data: [channelA] })
                .close()
                .expectClosed();
        });

        it("Can unsubscribe from a previously subscribed channel.", async () => {
            const user: any = { uid: uuid.v4(), name: "subscriber4" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const channel: string = uuid.v4();
            await grantChannelRead(channel, user.uid);

            await requestws(server)
                .ws(basePath, { headers: { Authorization: `jwt ${token}` } })
                .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: [user.uid] })
                .sendJson({ id: 1, type: "SUBSCRIBE", data: channel })
                .expectJson({ id: 1, type: "SUBSCRIBED", success: true, data: [channel] })
                .sendJson({ id: 2, type: "UNSUBSCRIBE", data: channel })
                .expectJson({ id: 2, type: "UNSUBSCRIBED", success: true, data: [channel] })
                .close()
                .expectClosed();
        });
    });

    describe("invalid messages", () => {
        it("Ignores non-JSON messages without closing the connection.", async () => {
            const user: any = { uid: uuid.v4(), name: "invalidmsg1" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const channel: string = uuid.v4();
            await grantChannelRead(channel, user.uid);

            await requestws(server)
                .ws(basePath, { headers: { Authorization: `jwt ${token}` } })
                .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: [user.uid] })
                .sendText("this is not valid JSON")
                .sendJson({ id: 1, type: "SUBSCRIBE", data: channel })
                .expectJson({ id: 1, type: "SUBSCRIBED", success: true, data: [channel] })
                .close()
                .expectClosed();
        });

        it("Ignores messages with an unrecognized type without closing the connection.", async () => {
            const user: any = { uid: uuid.v4(), name: "invalidmsg2" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const channel: string = uuid.v4();
            await grantChannelRead(channel, user.uid);

            await requestws(server)
                .ws(basePath, { headers: { Authorization: `jwt ${token}` } })
                .expectJson({ id: 0, type: "SUBSCRIBED", success: true, data: [user.uid] })
                .sendJson({ id: 1, type: "UNKNOWN_TYPE", data: "whatever" })
                .sendJson({ id: 2, type: "SUBSCRIBE", data: channel })
                .expectJson({ id: 2, type: "SUBSCRIBED", success: true, data: [channel] })
                .close()
                .expectClosed();
        });
    });

    describe("send", () => {
        it("Returns a 401 when no authentication is provided.", async () => {
            const result = await request(server).post(`${basePath}/${uuid.v4()}`).send({ message: "hello" });
            expect(result.status).toBe(401);
            expect(result.body.code).toBe("api-101");
        });

        it("Returns a 403 when the user does not have create permission for the channel.", async () => {
            const user: any = { uid: uuid.v4(), name: "sender1" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const channel: string = uuid.v4(); // No ACL entry created — permission denied by default.

            const result = await request(server)
                .post(`${basePath}/${channel}`)
                .set("Authorization", `jwt ${token}`)
                .send({ message: "hello" });
            expect(result.status).toBe(403);
            expect(result.body.code).toBe("api-102");
        });

        it("Publishes the message and returns a 204 when the user has create permission.", async () => {
            const user: any = { uid: uuid.v4(), name: "sender2" };
            const token = JWTUtils.createTokenSync(config.get("auth"), user);
            const channel: string = uuid.v4();
            await grantChannelCreate(channel, user.uid);

            const result = await request(server)
                .post(`${basePath}/${channel}`)
                .set("Authorization", `jwt ${token}`)
                .send({ message: "hello" });
            expect(result.status).toBe(204);
        });

        it("Delivers the published message to a socket subscribed to the channel.", async () => {
            const receiver: any = { uid: uuid.v4(), name: "receiver1" };
            const receiverToken = JWTUtils.createTokenSync(config.get("auth"), receiver);
            const sender: any = { uid: uuid.v4(), name: "sender3" };
            const senderToken = JWTUtils.createTokenSync(config.get("auth"), sender);
            const channel: string = uuid.v4();
            await saveChannelAcl(channel, [readRecord(receiver.uid), createRecord(sender.uid)]);

            const sock: WebSocket = new WebSocket(`ws://localhost:${server.port}${basePath}`, {
                headers: { Authorization: `jwt ${receiverToken}` },
            });

            // Buffer incoming messages via a persistent listener registered immediately (rather than
            // one-shot listeners added after an `await`) to avoid a race where a message arrives in the
            // gap between an awaited event resolving and the next listener being attached.
            const messageQueue: any[] = [];
            const waiters: Array<(msg: any) => void> = [];
            sock.on("message", (raw: any) => {
                const msg: any = JSON.parse(raw.toString());
                const waiter = waiters.shift();
                if (waiter) {
                    waiter(msg);
                } else {
                    messageQueue.push(msg);
                }
            });
            const nextMessage = (): Promise<any> => {
                if (messageQueue.length > 0) {
                    return Promise.resolve(messageQueue.shift());
                }
                return new Promise((resolve) => waiters.push(resolve));
            };

            try {
                await new Promise<void>((resolve, reject) => {
                    sock.once("open", () => resolve());
                    sock.once("error", reject);
                });

                // Initial subscription to the user's own channel.
                expect(await nextMessage()).toEqual({ id: 0, type: "SUBSCRIBED", success: true, data: [receiver.uid] });

                // Subscribe to the target channel.
                sock.send(JSON.stringify({ id: 1, type: "SUBSCRIBE", data: channel }));
                expect(await nextMessage()).toEqual({ id: 1, type: "SUBSCRIBED", success: true, data: [channel] });

                // Publish a message to the channel via the HTTP endpoint.
                const result = await request(server)
                    .post(`${basePath}/${channel}`)
                    .set("Authorization", `jwt ${senderToken}`)
                    .send({ message: "hello" });
                expect(result.status).toBe(204);

                // The subscribed socket should receive the forwarded message.
                expect(await nextMessage()).toEqual({ type: "MESSAGE", channel, data: { message: "hello" } });
            } finally {
                sock.close();
            }
        });
    });
});
