///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
// End to end: `@WebSocket(path, options)` routes registered through RouteUtils.registerRoute() onto a real uWebSockets.js
// router, driven by a real `ws` client. Covers `@Param()` on a WebSocket route (uWS used to leave req.params empty for
// an upgrade request) and the per-route message size limit reaching uWS (16 KiB default, larger when configured).
import "reflect-metadata";
import uWS from "uWebSockets.js";
import WebSocket from "ws";
import { HttpRouter } from "../../src/http/uWS/Router";
import { RouteUtils } from "../../src/routes/RouteUtils";
import { Param, Route, Socket, WebSocket as WebSocketRoute } from "../../src/decorators/RouteDecorators";

const PORT = 37934;

@Route("/relay")
class RelayRoute {
    /** Default limits. */
    @WebSocketRoute("/:id")
    public relay(@Param("id") id: string, @Socket socket: any): void {
        socket.on("message", (msg: Buffer) => socket.send(`${id}:${Buffer.byteLength(msg)}`));
        socket.send(`hello ${id}`);
    }

    /** A larger message limit and send buffer, for a route that streams big frames. */
    @WebSocketRoute("/stream/:room/:peer", { maxPayloadLength: 256 * 1024, maxBackpressure: 1024 * 1024 })
    public stream(@Param("room") room: string, @Param("peer") peer: string, @Socket socket: any): void {
        socket.on("message", (msg: Buffer) => socket.send(`${room}/${peer}:${Buffer.byteLength(msg)}`));
        socket.send(`hello ${room}/${peer}`);
    }
}

/** Connects and resolves with the socket and its first message (the greeting the route sends on connect). */
async function connect(path: string): Promise<{ socket: WebSocket; greeting: string; next: () => Promise<string> }> {
    const socket = new WebSocket(`ws://127.0.0.1:${PORT}${path}`);
    const queue: string[] = [];
    let waiting: ((message: string) => void) | undefined;
    socket.on("message", (data) => {
        const message = String(data);
        if (waiting) {
            const resolve = waiting;
            waiting = undefined;
            resolve(message);
        } else {
            queue.push(message);
        }
    });
    const next = (): Promise<string> => {
        const queued = queue.shift();
        return queued !== undefined ? Promise.resolve(queued) : new Promise((resolve) => (waiting = resolve));
    };
    await new Promise<void>((resolve, reject) => {
        socket.once("open", () => resolve());
        socket.once("error", reject);
    });
    return { socket, greeting: await next(), next };
}

describe("@WebSocket routes registered through RouteUtils on a real uWS router", () => {
    let router: HttpRouter;

    beforeAll(async () => {
        router = new HttpRouter(uWS.App());
        const routeUtils: any = new RouteUtils();
        routeUtils.logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
        await routeUtils.registerRoute(router, new RelayRoute());
        await router.listen("127.0.0.1", PORT);
    });

    afterAll(async () => {
        await router.shutdown(1000);
    });

    it("injects a :param into a @Param() argument", async () => {
        const client = await connect("/relay/abc123");
        expect(client.greeting).toBe("hello abc123");
        client.socket.close();
    });

    it("injects a :param on the trailing-slash registration, percent-decoded", async () => {
        const client = await connect(`/relay/${encodeURIComponent("jdoe@example.com")}/`);
        expect(client.greeting).toBe("hello jdoe@example.com");
        client.socket.close();
    });

    it("injects every :param of a multi-param route", async () => {
        const client = await connect("/relay/stream/room1/peerB");
        expect(client.greeting).toBe("hello room1/peerB");
        client.socket.close();
    });

    it("a route without options still drops a message just over 16 KiB, and accepts exactly 16 KiB", async () => {
        const ok = await connect("/relay/x");
        const reply = ok.next();
        ok.socket.send(Buffer.alloc(16 * 1024, 1));
        expect(await reply).toBe(`x:${16 * 1024}`);
        ok.socket.close();

        const tooBig = await connect("/relay/x");
        const closed = new Promise<number>((resolve) => tooBig.socket.once("close", (code: number) => resolve(code)));
        tooBig.socket.send(Buffer.alloc(16 * 1024 + 1, 1));
        // uWS drops the connection without a close frame, which a client reports as 1006.
        expect(await closed).toBe(1006);
    });

    it("a route with a larger maxPayloadLength accepts a message over 16 KiB, up to its own limit", async () => {
        const ok = await connect("/relay/stream/r/p");
        const reply = ok.next();
        ok.socket.send(Buffer.alloc(200 * 1024, 1));
        expect(await reply).toBe(`r/p:${200 * 1024}`);
        ok.socket.close();

        const tooBig = await connect("/relay/stream/r/p");
        const closed = new Promise<number>((resolve) => tooBig.socket.once("close", (code: number) => resolve(code)));
        tooBig.socket.send(Buffer.alloc(256 * 1024 + 1, 1));
        expect(await closed).toBe(1006);
    });
});
