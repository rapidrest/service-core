///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
/**
 * Superwstest-compatible WebSocket test helper built on the `ws` package.
 * Accepts a port number (or a Server instance with a `port` property).
 */
import { WebSocket } from "ws";

type WsAction =
    | { kind: "expectText"; value: string }
    | { kind: "expectJson"; value: any }
    | { kind: "expectClosed"; code?: number; reason?: string }
    | { kind: "sendText"; value: string }
    | { kind: "sendJson"; value: any }
    | { kind: "close" };

/** Fluent WebSocket test chain, mirrors the superwstest API. */
export class WsChain {
    private readonly url: string;
    private readonly wsOptions?: any;
    private readonly actions: WsAction[] = [];

    constructor(url: string, wsOptions?: any) {
        this.url = url;
        this.wsOptions = wsOptions;
    }

    expectText(value: string): this {
        this.actions.push({ kind: "expectText", value });
        return this;
    }

    expectJson(value: any): this {
        this.actions.push({ kind: "expectJson", value });
        return this;
    }

    expectClosed(code?: number, reason?: string): this {
        this.actions.push({ kind: "expectClosed", code, reason });
        return this;
    }

    sendText(value: string): this {
        this.actions.push({ kind: "sendText", value });
        return this;
    }

    sendJson(value: any): this {
        this.actions.push({ kind: "sendJson", value });
        return this;
    }

    close(): this {
        this.actions.push({ kind: "close" });
        return this;
    }

    /** Execute the queued actions and resolve when all pass. */
    then<TResult1 = void, TResult2 = never>(
        onFulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
        onRejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
    ): Promise<TResult1 | TResult2> {
        return this._run().then(onFulfilled, onRejected);
    }

    catch<TResult = never>(
        onRejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
    ): Promise<void | TResult> {
        return this._run().catch(onRejected);
    }

    private _run(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            const actions = [...this.actions];
            let actionIndex = 0;
            let closed = false;

            const ws = new WebSocket(this.url, this.wsOptions);
            const timeout = setTimeout(() => {
                ws.terminate();
                reject(new Error(`WebSocket test timed out at action ${actionIndex}: ${JSON.stringify(actions[actionIndex])}`));
            }, 10000);

            const fail = (err: any) => {
                clearTimeout(timeout);
                ws.terminate();
                reject(err instanceof Error ? err : new Error(String(err)));
            };

            const done = () => {
                clearTimeout(timeout);
                ws.terminate();
                resolve();
            };

            // Messages can arrive before the action that expects them is reached — e.g. a fast
            // server response racing the client's send() callback, which can resolve after the
            // response has already been delivered. Buffer every message as it arrives via a
            // persistent listener rather than reactively registering a `once("message")` handler
            // per action, so a message that arrives early is never silently dropped.
            const messageQueue: string[] = [];
            let pendingMessageHandler: ((raw: string) => void) | null = null;

            ws.on("message", (raw: any) => {
                const text = raw.toString();
                if (pendingMessageHandler) {
                    const handler = pendingMessageHandler;
                    pendingMessageHandler = null;
                    handler(text);
                } else {
                    messageQueue.push(text);
                }
            });

            const nextMessage = (handler: (raw: string) => void) => {
                if (messageQueue.length > 0) {
                    handler(messageQueue.shift()!);
                } else {
                    pendingMessageHandler = handler;
                }
            };

            /** Execute the next action, or resolve if all done. */
            const next = () => {
                if (actionIndex >= actions.length) {
                    done();
                    return;
                }

                const action = actions[actionIndex++];

                if (action.kind === "sendText") {
                    ws.send(action.value, (err) => {
                        if (err) { fail(err); return; }
                        next();
                    });
                } else if (action.kind === "sendJson") {
                    ws.send(JSON.stringify(action.value), (err) => {
                        if (err) { fail(err); return; }
                        next();
                    });
                } else if (action.kind === "close") {
                    ws.close();
                    next();
                } else if (action.kind === "expectClosed") {
                    const checkClose = (code: number, _reason: Buffer) => {
                        if (action.code !== undefined && code !== action.code) {
                            fail(new Error(`Expected close code ${action.code} but got ${code}`));
                            return;
                        }
                        if (action.reason !== undefined) {
                            const reasonStr = _reason.toString();
                            if (reasonStr !== action.reason) {
                                fail(new Error(`Expected close reason "${action.reason}" but got "${reasonStr}"`));
                                return;
                            }
                        }
                        closed = true;
                        next();
                    };
                    if (closed) {
                        next();
                    } else {
                        ws.once("close", checkClose);
                    }
                } else {
                    // expectText / expectJson — consume the next buffered/incoming message
                    nextMessage((text: string) => {
                        try {
                            if (action.kind === "expectText") {
                                if (text !== action.value) {
                                    fail(new Error(`Expected text "${action.value}" but got "${text}"`));
                                    return;
                                }
                            } else if (action.kind === "expectJson") {
                                const parsed = JSON.parse(text);
                                // Deep equal check
                                const exp = JSON.stringify(action.value);
                                const got = JSON.stringify(parsed);
                                if (exp !== got) {
                                    fail(new Error(`Expected JSON ${exp} but got ${got}`));
                                    return;
                                }
                            }
                            next();
                        } catch (err) {
                            fail(err);
                        }
                    });
                }
            };

            ws.on("error", fail);
            ws.on("close", () => { closed = true; });

            ws.on("open", () => {
                next();
            });
        });
    }
}

/** Creates a superwstest-style chain connected to `ws://localhost:<port>`. */
export function requestws(appOrPort: any) {
    const port = typeof appOrPort === "number"
        ? appOrPort
        : appOrPort?.port ?? appOrPort?.listenPort;

    if (!port) {
        throw new Error("requestws(): cannot determine port from argument");
    }

    return {
        ws(path: string, options?: any): WsChain {
            const wsOptions = options
                ? { headers: options.headers }
                : undefined;
            return new WsChain(`ws://localhost:${port}${path}`, wsOptions);
        },
    };
}
