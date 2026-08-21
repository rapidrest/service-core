///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
import type { HttpRequest, HttpResponse, RequestHandler } from "./types.js";

/**
 * Runs an ordered array of middleware handlers sequentially, Express-style.
 * Supports both 3-param `(req, res, next)` handlers and 4-param `(err, req, res, next)`
 * error handlers. On error, execution skips to the next error handler.
 *
 * Each handler is awaited via a Promise that resolves when next() is called, not when
 * the handler's return value resolves. This correctly handles: (1) sync handlers that
 * call next() synchronously, (2) async handlers that return next() or await before
 * calling it, and (3) sync handlers that schedule next() via callbacks such as
 * setTimeout or socket.once. The chain terminates early when a handler ends the
 * response without calling next().
 *
 * Framework-agnostic — used by both the uWS-backed and Bun-backed routers.
 */
export async function runChain(handlers: RequestHandler[], req: HttpRequest, res: HttpResponse): Promise<void> {
    let currentError: any = undefined;

    for (let i = 0; i < handlers.length; i++) {
        const handler = handlers[i];
        const isErrorHandler = handler.length === 4;

        if (currentError && !isErrorHandler) continue;
        if (!currentError && isErrorHandler) continue;

        const outcome = await new Promise<{ called: boolean; err?: any }>((resolve) => {
            let settled = false;

            const next = (err?: any): any => {
                if (!settled) {
                    settled = true;
                    resolve({ called: true, err });
                }
            };

            try {
                const handlerResult = isErrorHandler
                    ? (handler as any)(currentError, req, res, next)
                    : handler(req, res, next);

                if (handlerResult instanceof Promise) {
                    // Async handler: wait for the Promise, but next() may have already been
                    // called (or may be called later inside the Promise chain).
                    handlerResult
                        .then(() => {
                            if (!settled) {
                                settled = true;
                                resolve({ called: false });
                            }
                        })
                        .catch((err: any) => {
                            if (!settled) {
                                settled = true;
                                resolve({ called: true, err });
                            }
                        });
                } else {
                    // Sync handler returned. Three sub-cases:
                    //   a. next() was already called synchronously → already settled.
                    //   b. Response was sent without next() → stop chain.
                    //   c. Handler will call next() from an async callback (e.g. setTimeout)
                    //      → leave the Promise pending; it resolves when next() fires.
                    if (!settled && res.writableEnded) {
                        settled = true;
                        resolve({ called: false });
                    }
                    // else: wait for next() to be called asynchronously
                }
            } catch (err: any) {
                if (!settled) {
                    settled = true;
                    resolve({ called: true, err });
                }
            }
        });

        if (!outcome.called) break; // handler terminated chain (sent response)

        if (outcome.err !== undefined) {
            currentError = outcome.err;
        } else if (isErrorHandler) {
            currentError = undefined; // error was handled
        }
    }

    // End of chain with unhandled error
    if (currentError && !res.writableEnded) {
        const status: number = typeof currentError?.status === "number" ? currentError.status : 500;
        const code: string | undefined = typeof currentError?.code === "string" ? currentError.code : undefined;
        res.status(status).json({
            message: currentError?.message || "Internal Server Error",
            status,
            ...(code !== undefined ? { code } : {}),
        });
    }
}

/** Result returned by a pre-upgrade WebSocket auth function. */
export type WsUpgradeAuthResult = {
    user?: any;
    authPayload?: any;
    authToken?: string;
    /** Set to `true` to reject the connection with HTTP 401 before the WebSocket handshake. */
    reject?: boolean;
};

/**
 * Optional pre-upgrade auth function for WebSocket routes. Called synchronously before the
 * WebSocket handshake completes. Returning `{ reject: true }` sends an HTTP 401 and skips the
 * upgrade entirely. Returning `{}` falls through to the post-upgrade message-based LOGIN flow.
 * Returning `{ user, ... }` pre-authenticates the connection so clients that can send an
 * Authorization header skip the LOGIN step.
 */
export type WsUpgradeAuth = (req: HttpRequest) => WsUpgradeAuthResult;

/** Parses `:param` names out of a route pattern (e.g. `/users/:uid/:version` → `["uid","version"]`). */
export function extractParamNames(routePath: string): string[] {
    const names: string[] = [];
    for (const segment of routePath.split("/")) {
        if (segment.startsWith(":")) names.push(segment.slice(1));
    }
    return names;
}

/**
 * Builds a stub `HttpResponse` used for WebSocket routes: the framework middleware chain runs
 * against a WebSocket "request" that has no real HTTP response to write to, so all writes are
 * no-ops other than tracking `writableEnded`.
 *
 * @param onUnhandledError Invoked when `runChain()` reaches the end of the chain with an
 * unhandled error and falls back to `res.status(...).json(...)` — the only way that fallback
 * (or any other middleware) can signal an error for a WS connection, since there is no real
 * response to write to. The router's `ws()` open handler uses this to close the socket the same
 * way route handlers do themselves (a `1002` close carrying the error's short code), instead of
 * silently doing nothing.
 */
export function makeWsStubResponse(onUnhandledError?: (status: number, payload: any) => void): HttpResponse {
    const finishHandlers: Array<() => void | Promise<void>> = [];
    let finished = false;
    let lastStatus = 101;
    const fireFinish = () => {
        if (finished) return;
        finished = true;
        for (const handler of finishHandlers) {
            Promise.resolve()
                .then(() => handler())
                .catch(() => {
                    // WS routes have no real HttpResponse to report errors through; swallow.
                });
        }
    };
    return {
        statusCode: 101,
        headersSent: true,
        writableEnded: false,
        status(code: number) {
            lastStatus = code;
            return this;
        },
        setHeader() {
            return this;
        },
        appendHeader() {
            return this;
        },
        getHeader() {
            return undefined;
        },
        json(payload?: any) {
            onUnhandledError?.(lastStatus, payload);
        },
        send() {
            return;
        },
        end() {
            this.writableEnded = true;
            fireFinish();
        },
        onFinish(handler: () => void | Promise<void>) {
            if (finished) {
                void handler();
            } else {
                finishHandlers.push(handler);
            }
        },
    };
}
