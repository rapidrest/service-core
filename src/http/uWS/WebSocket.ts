///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { EventEmitter } from "events";
import { Duplex } from "stream";
import type { WebSocket } from "uWebSockets.js";
import type { HttpRequest } from "../types.js";
import type { IWebSocketShim } from "../IWebSocketShim.js";

/**
 * HTTP request type for handling WebSocket upgrade requests.
 * Extends `HttpRequest` with WebSocket-specific properties set by the router
 * after the WebSocket connection is opened.
 */
export interface RequestWS extends HttpRequest {
    /**
     * The WebSocket shim for this connection. Set on `open` after the upgrade.
     */
    websocket: IWebSocketShim | undefined;

    /**
     * Indicates that the WebSocket handler has processed this connection and the
     * connection should remain open. Set to `true` by `wrapMiddleware` when a
     * decorated handler returns successfully.
     */
    wsHandled: boolean;
}

/**
 * Wraps a uWS `WebSocket` handle and exposes an EventEmitter-based API compatible
 * with what route handlers (e.g. `AdminRoute`) expect.
 *
 * uWS WebSockets fire events via behavior callbacks on the route, not on the socket
 * object itself. This shim bridges that gap by:
 * - Forwarding `message` / `close` events from the route behavior to this emitter.
 * - Exposing `send(data, cb?)` and `close(code?, reason?)` that delegate to uWS.
 *
 * The Router's `ws()` implementation stores the shim in `ws.getUserData()` so that
 * behavior callbacks can call `shim.emit(...)`.
 */
export class UWSWebSocketShim extends EventEmitter implements IWebSocketShim {
    private readonly _ws: WebSocket<any>;
    public readyState: number = 1; // OPEN

    constructor(ws: WebSocket<any>) {
        super();
        this._ws = ws;
    }

    /**
     * Sends data over the WebSocket connection.
     * @param data The data to send.
     * @param cb Optional callback invoked on completion or error.
     */
    public send(data: any, cb?: (err?: Error) => void): void {
        try {
            const ok = this._ws.send(
                typeof data === "string" ? data : Buffer.from(data),
                typeof data !== "string"
            );
            if (cb) cb(ok ? undefined : new Error("uWS backpressure: send failed"));
        } catch (err: any) {
            if (cb) cb(err);
        }
    }

    /**
     * Closes the WebSocket connection with an optional code and reason.
     */
    public close(code?: number, reason?: string): void {
        try {
            this._ws.end(code, reason);
        } catch {
            // Socket may already be closed
        }
    }
}

/**
 * Creates a Node.js `Duplex` stream from a `UWSWebSocketShim`, compatible with the
 * `createWebSocketStream` API from the `ws` library.
 *
 * Incoming WebSocket messages are pushed as readable data; writes to the stream are
 * forwarded as WebSocket messages.
 */
export function createWebSocketStream(shim: UWSWebSocketShim): Duplex {
    const duplex = new Duplex({
        read() { return; },
        write(chunk, _encoding, callback) {
            shim.send(chunk, (err) => callback(err));
        },
        final(callback) {
            shim.close(1000);
            callback();
        },
    });

    shim.on("message", (data: any) => {
        duplex.push(data);
    });

    shim.on("close", () => {
        duplex.push(null);
        duplex.destroy();
    });

    duplex.on("close", () => {
        shim.close(1000);
    });

    return duplex;
}
