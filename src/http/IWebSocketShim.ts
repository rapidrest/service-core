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
}
