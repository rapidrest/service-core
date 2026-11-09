///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { EventEmitter } from "events";
import type { IWebSocketShim } from "../IWebSocketShim.js";
import { WebSocketDrainTracker } from "../WebSocketDrain.js";

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
    /** Bun's `ServerWebSocket.getBufferedAmount()`. Optional so older stand-ins still satisfy the interface. */
    getBufferedAmount?(): number;
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
    private readonly _drain: WebSocketDrainTracker = new WebSocketDrainTracker(() => this.bufferedAmount);

    constructor(ws: WebSocketSendTarget) {
        super();
        this._ws = ws;
    }

    /** Bytes queued for the client and not yet written to the socket. `0` once the socket has closed. */
    public get bufferedAmount(): number {
        try {
            return this._ws.getBufferedAmount?.() ?? 0;
        } catch {
            return 0; // Socket already closed
        }
    }

    /** `true` after a `send()` met backpressure, until the socket reports it drained. */
    public get writableNeedDrain(): boolean {
        return this._drain.writableNeedDrain;
    }

    /** Registers a callback fired each time the backpressured socket has fully drained. */
    public onDrain(callback: () => void): void {
        this._drain.onDrain(callback);
    }

    /** Resolves `true` when it is safe to send more, `false` if the socket closes first. */
    public waitForDrain(): Promise<boolean> {
        return this._drain.waitForDrain();
    }

    /** Called by the router's `drain` handler. @internal */
    public notifyDrain(): void {
        this._drain.handleDrain();
    }

    /** Called by the router's `close` handler. @internal */
    public notifyClosed(): void {
        this._drain.handleClose();
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
            if (result <= 0) this._drain.markBackpressure();
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
