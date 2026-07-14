///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
///////////////////////////////////////////////////////////////////////////////
export type { ErrorHandler, HttpRequest, HttpResponse, IHttpRouter, NextFunction, RequestHandler } from "./types.js";
export { isBunRuntime } from "./RuntimeDetect.js";
export type { IWebSocketShim } from "./IWebSocketShim.js";
export { extractParamNames, makeWsStubResponse, runChain } from "./MiddlewareChain.js";
export type { WsUpgradeAuth, WsUpgradeAuthResult } from "./MiddlewareChain.js";

// uWS-backed adapter. `HttpRouter` is exported as a type only — the class itself value-imports
// `uWebSockets.js` at module load, which does not work under Bun. Consumers that only annotate with
// the type stay safe on every runtime; constructing one is done internally by Server.ts via a
// dynamic import gated on `isBunRuntime()`.
export { UWSRequest, UWSResponse, readBody } from "./uWS/Adapters.js";
export type { HttpRouter } from "./uWS/Router.js";
export type { RequestWS } from "./uWS/WebSocket.js";
export { UWSWebSocketShim, createWebSocketStream } from "./uWS/WebSocket.js";

// Bun-backed adapter. Safe to value-export unconditionally on every runtime — these modules never
// touch the `Bun` global outside of method bodies invoked at runtime.
export { BunRequest, BunResponse, readBunBody } from "./bun/BunAdapters.js";
export { BunRouter } from "./bun/BunRouter.js";
export { BunWebSocketShim } from "./bun/BunWebSocket.js";
