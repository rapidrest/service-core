///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
import { EventEmitter } from "events";
import type { IWebSocketShim } from "../IWebSocketShim.js";

/**
 * Minimal structural slice of Bun's `ServerWebSocket` used by this shim. Deliberately NOT typed as
 * `Bun.ServerWebSocket` — a public constructor parameter typed against the ambient `Bun` namespace
 * would leak into this package's emitted `.d.ts`, breaking `tsc` for downstream consumers who don't
 * have `@types/bun` installed even though they never touch the Bun adapter. Bun's real
 * `ServerWebSocket` structurally satisfies this interface, so `bun/BunRouter.ts` (which has its own
 * `/// <reference types="bun" />`) can pass a real instance unchanged.
 */
export interface WebSocketSendTarget {
    send(data: string | Uint8Array): number;
    close(code?: number, reason?: string): void;
}

/**
 * Wraps a Bun `ServerWebSocket` handle and exposes an EventEmitter-based API compatible with
 * `IWebSocketShim`, mirroring `UWSWebSocketShim`'s behavior for the uWS-backed router so that
 * route handlers (e.g. `BaseAdminRoute`) and `AuthMiddleware.authWebSocket()` work unchanged
 * regardless of which runtime is active.
 */
export class BunWebSocketShim extends EventEmitter implements IWebSocketShim {
    private readonly _ws: WebSocketSendTarget;
    public readyState: number = 1; // OPEN

    constructor(ws: WebSocketSendTarget) {
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
            const result = this._ws.send(typeof data === "string" ? data : Buffer.from(data));
            // Bun's ws.send returns bytes sent on success, 0 when the message was dropped due to
            // backpressure, or a negative number when it was queued to be sent once backpressure
            // clears (not itself a failure) — only treat 0 as an actual send failure.
            if (cb) cb(result === 0 ? new Error("Bun backpressure: send dropped") : undefined);
        } catch (err: any) {
            if (cb) cb(err);
        }
    }

    /**
     * Closes the WebSocket connection with an optional code and reason.
     */
    public close(code?: number, reason?: string): void {
        try {
            this._ws.close(code, reason);
        } catch {
            // Socket may already be closed
        }
    }
}
