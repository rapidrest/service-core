///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import { EventEmitter } from "events";

/**
 * Framework-agnostic WebSocket shim surface. Both the uWS-backed and Bun-backed WebSocket shims
 * implement this, so route/middleware code (e.g. `BaseAdminRoute`, `AuthMiddleware.authWebSocket`)
 * never depends on the concrete runtime implementation.
 */
export interface IWebSocketShim extends EventEmitter {
    readyState: number;
    send(data: any, cb?: (err?: Error) => void): void;
    close(code?: number, reason?: string): void;

    /**
     * Number of bytes accepted by `send()` that are still queued for the client. A producer can compare it to a
     * threshold (below the route's `maxBackpressure`) and slow down before sends are dropped.
     *
     * Optional for backward compatibility: custom shims that don't implement it keep working, and consumers must
     * treat `undefined` as "unknown".
     */
    readonly bufferedAmount?: number;

    /**
     * `true` after a `send()` met backpressure, until the queue has drained (like `HttpResponse.writableNeedDrain`).
     * Optional, see `bufferedAmount`.
     */
    readonly writableNeedDrain?: boolean;

    /**
     * Registers a callback fired every time a backpressured socket has fully drained and it is safe to send more.
     * Never called after the socket closed. Optional, see `bufferedAmount`.
     */
    onDrain?(callback: () => void): void;

    /**
     * Resolves `true` once it is safe to send more: immediately when nothing is queued, or when the queue drains.
     * Resolves `false` if the socket closes while waiting, meaning the producer must stop. Optional, see
     * `bufferedAmount`.
     */
    waitForDrain?(): Promise<boolean>;
}
