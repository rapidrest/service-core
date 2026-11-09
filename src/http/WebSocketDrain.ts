///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////

/**
 * Send-backpressure bookkeeping shared by the uWS and Bun WebSocket shims, so both report `writableNeedDrain`,
 * `onDrain()` and `waitForDrain()` with the same semantics (which mirror the HTTP response adapters).
 *
 * @internal
 */
export class WebSocketDrainTracker {
    private needDrain: boolean = false;
    private closed: boolean = false;
    private handlers: Array<() => void> = [];
    private waiters: Array<(canSend: boolean) => void> = [];

    /**
     * @param getBufferedAmount Returns the number of bytes currently queued for the client.
     */
    constructor(private readonly getBufferedAmount: () => number) {}

    /** `true` after a send was queued (or dropped) under backpressure, until the socket drains. */
    public get writableNeedDrain(): boolean {
        return this.needDrain;
    }

    /** Records that a send hit backpressure. */
    public markBackpressure(): void {
        if (!this.closed) {
            this.needDrain = true;
        }
    }

    public onDrain(callback: () => void): void {
        this.handlers.push(callback);
    }

    public waitForDrain(): Promise<boolean> {
        if (this.closed) return Promise.resolve(false);
        if (!this.needDrain && this.getBufferedAmount() === 0) return Promise.resolve(true);
        return new Promise<boolean>((resolve) => this.waiters.push(resolve));
    }

    /** Called by the router's drain callback. Settles only once nothing is left queued. */
    public handleDrain(): void {
        if (this.closed || this.getBufferedAmount() > 0) return;
        const wasWaiting = this.needDrain || this.waiters.length > 0;
        this.needDrain = false;
        if (!wasWaiting) return;
        const waiters = this.waiters;
        this.waiters = [];
        for (const resolve of waiters) resolve(true);
        for (const handler of this.handlers) handler();
    }

    /** Called when the socket closes: nothing will drain any more, so release every waiter with `false`. */
    public handleClose(): void {
        this.closed = true;
        this.needDrain = false;
        const waiters = this.waiters;
        this.waiters = [];
        for (const resolve of waiters) resolve(false);
    }
}
