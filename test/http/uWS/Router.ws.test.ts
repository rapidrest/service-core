///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// Real uWebSockets.js server + real `ws` client (no fakes): covers what a WebSocket route receives from the uWS router
// (`:param` path segments, both the plain and trailing-slash registration) and how per-route `wsOptions` reach uWS
// (the 16 KiB default message limit, an overridden limit, a field-by-field override of the defaults).
import uWS from "uWebSockets.js";
import WebSocket from "ws";
import { HttpRouter } from "../../../src/http/uWS/Router";
import { DEFAULT_WS_OPTIONS } from "../../../src/http/types";

const PORT = 37933;

/**
 * The close code a client observes when uWS rejects an over-long message. uWS drops the TCP connection without
 * sending a WebSocket close frame (verified with a raw socket), so a client reports 1006 ("abnormal closure") rather
 * than 1009. Only the Bun router closes with 1009.
 */
const UWS_MESSAGE_TOO_BIG = 1006;

/** A client whose received messages are queued from the moment it is created, so none is missed before `next()`. */
class Client {
    public readonly socket: WebSocket;
    private readonly queue: string[] = [];
    private waiting?: (message: string) => void;

    constructor(path: string) {
        this.socket = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
        this.socket.on("message", (data) => {
            const message = String(data);
            if (this.waiting) {
                const resolve = this.waiting;
                this.waiting = undefined;
                resolve(message);
            } else {
                this.queue.push(message);
            }
        });
    }

    /** Resolves once the connection is open. */
    public opened(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.socket.once("open", () => resolve());
            this.socket.once("error", reject);
        });
    }

    /** Resolves with the next message the server sent. */
    public next(): Promise<string> {
        const queued = this.queue.shift();
        if (queued !== undefined) {
            return Promise.resolve(queued);
        }
        return new Promise((resolve) => (this.waiting = resolve));
    }

    /** Resolves with the close code once the connection is closed. */
    public closed(): Promise<number> {
        return new Promise((resolve) => this.socket.once("close", (code: number) => resolve(code)));
    }
}

/** Opens a client and resolves with it once connected. */
async function connect(path: string): Promise<Client> {
    const client = new Client(path);
    await client.opened();
    return client;
}

describe("HttpRouter.ws() (real uWS)", () => {
    let router: HttpRouter;
    const seenParams: Array<Record<string, string>> = [];

    /** A handler that keeps the connection open and replies with the size of every message it receives. */
    const echoSize = (req: any, _res: any, next: any) => {
        req.websocket.on("message", (msg: Buffer | string) => {
            req.websocket.send(`got:${Buffer.byteLength(msg)}`);
        });
        req.wsHandled = true;
        next();
    };

    beforeAll(async () => {
        router = new HttpRouter(uWS.App());
        router.ws("/relay/:id", [
            (req: any, _res: any, next: any) => {
                seenParams.push({ ...req.params });
                req.websocket.send(`id:${req.params.id}`);
                req.wsHandled = true;
                next();
            },
        ]);
        router.ws("/rooms/:room/peers/:peer", [
            (req: any, _res: any, next: any) => {
                req.websocket.send(`${req.params.room}|${req.params.peer}`);
                req.wsHandled = true;
                next();
            },
        ]);
        // No options: every default applies.
        router.ws("/default", [echoSize]);
        // Only the payload limit is overridden: the other fields (one of them explicitly `undefined`) keep their defaults.
        router.ws("/big", [echoSize], { maxPayloadLength: 64 * 1024, maxBackpressure: undefined });
        router.ws("/idle", [echoSize], { idleTimeout: 8 });
        await router.listen("127.0.0.1", PORT);
    });

    afterAll(async () => {
        await router.shutdown(1000);
    });

    describe("path parameters", () => {
        it("populates req.params for an upgrade request", async () => {
            const client = await connect("/relay/abc123");
            expect(await client.next()).toBe("id:abc123");
            client.socket.close();
            expect(seenParams[seenParams.length - 1]).toEqual({ id: "abc123" });
        });

        it("populates req.params for the trailing-slash registration", async () => {
            const client = await connect("/relay/abc123/");
            expect(await client.next()).toBe("id:abc123");
            client.socket.close();
        });

        it("percent-decodes a param, like the HTTP routes do", async () => {
            const client = await connect(`/relay/${encodeURIComponent("jdoe@example.com")}`);
            expect(await client.next()).toBe("id:jdoe@example.com");
            client.socket.close();
        });

        it("falls back to the raw segment on malformed percent-encoding", async () => {
            const client = await connect("/relay/100%");
            expect(await client.next()).toBe("id:100%");
            client.socket.close();
        });

        it("populates every param of a multi-param pattern in order", async () => {
            const client = await connect("/rooms/r1/peers/p2");
            expect(await client.next()).toBe("r1|p2");
            client.socket.close();
        });
    });

    describe("wsOptions", () => {
        it("drops a route without options for a message just over the 16 KiB default", async () => {
            expect(DEFAULT_WS_OPTIONS.maxPayloadLength).toBe(16 * 1024);
            const client = await connect("/default");
            const code = client.closed();
            client.socket.send(Buffer.alloc(16 * 1024 + 1, 1));
            expect(await code).toBe(UWS_MESSAGE_TOO_BIG);
        });

        it("accepts a message of exactly the 16 KiB default on a route without options", async () => {
            const client = await connect("/default");
            const reply = client.next();
            client.socket.send(Buffer.alloc(16 * 1024, 1));
            expect(await reply).toBe(`got:${16 * 1024}`);
            client.socket.close();
        });

        it("accepts a message over the default on a route with a larger maxPayloadLength", async () => {
            const client = await connect("/big");
            const reply = client.next();
            client.socket.send(Buffer.alloc(64 * 1024, 1));
            expect(await reply).toBe(`got:${64 * 1024}`);
            client.socket.close();
        });

        it("still drops a route with a larger maxPayloadLength once its own limit is exceeded", async () => {
            const client = await connect("/big");
            const code = client.closed();
            client.socket.send(Buffer.alloc(64 * 1024 + 1, 1));
            expect(await code).toBe(UWS_MESSAGE_TOO_BIG);
        });

        it("applies the same options to the trailing-slash registration", async () => {
            const client = await connect("/big/");
            const reply = client.next();
            client.socket.send(Buffer.alloc(32 * 1024, 1));
            expect(await reply).toBe(`got:${32 * 1024}`);
            client.socket.close();
        });

        it("keeps the default payload limit on a route that only overrides another field", async () => {
            const client = await connect("/idle");
            const code = client.closed();
            client.socket.send(Buffer.alloc(16 * 1024 + 1, 1));
            expect(await code).toBe(UWS_MESSAGE_TOO_BIG);
        });
    });
});
