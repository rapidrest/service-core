///////////////////////////////////////////////////////////////////////////////
// Copyright (C) 2020-2026 Jean-Philippe Steinmetz. All rights reserved.
// SPDX-License-Identifier: MPL-2.0
///////////////////////////////////////////////////////////////////////////////
export type {
    ErrorHandler,
    HttpRequest,
    HttpResponse,
    HttpRouteOptions,
    IHttpRouter,
    NextFunction,
    RequestHandler,
    WebSocketOptions,
} from "./types.js";
export { DEFAULT_WS_OPTIONS } from "./types.js";
export { isBunRuntime } from "./RuntimeDetect.js";
export type { IWebSocketShim } from "./IWebSocketShim.js";
export { extractParamNames, makeWsStubResponse, runChain, splitRouteArgs } from "./MiddlewareChain.js";
export type { WsUpgradeAuth, WsUpgradeAuthResult } from "./MiddlewareChain.js";

// Session support — populates req.session across requests via a signed cookie. Registered
// globally by Server.ts only when a `session` config block is present.
export type { SessionStore } from "./session/SessionStore.js";
export { RedisSessionStore } from "./session/RedisSessionStore.js";
export { SessionManager } from "./session/SessionManager.js";
export { createSessionMiddleware } from "./session/sessionMiddleware.js";

// CSRF support — double-submit cookie protection for the `jwt` cookie `@rapidrest/auth`'s `TokenUtils`
// issues. `RouteUtils.checkCsrf()` wires the check into every registered route automatically; the pieces
// below are exported for a route that must check by hand (session-only auth, not the `jwt` cookie — see
// `BaseOAuthAuthorizeRoute.decideConsent()` in `@rapidrest/auth`) or a service that registers its own
// middleware chain outside of `RouteUtils`.
export {
    DEFAULT_CSRF_COOKIE_NAME,
    DEFAULT_CSRF_HEADER_NAME,
    buildCsrfCookie,
    createCsrfMiddleware,
    ensureCsrfCookie,
    generateCsrfToken,
    verifyCsrfRequest,
} from "./csrf/csrf.js";
export type { CsrfCheckOptions, CsrfCookieOptions } from "./csrf/csrf.js";

// uWS-backed adapter. `HttpRouter` is exported as a type only — the class itself value-imports
// `uWebSockets.js` at module load, which does not work under Bun. Consumers that only annotate with
// the type stay safe on every runtime; constructing one is done internally by Server.ts via a
// dynamic import gated on `isBunRuntime()`.
export { UWSRequest, UWSResponse, makeBodyStream, readBody } from "./uWS/Adapters.js";
export type { HttpRouter } from "./uWS/Router.js";
export type { RequestWS } from "./uWS/WebSocket.js";
export { UWSWebSocketShim, createWebSocketStream } from "./uWS/WebSocket.js";

// Bun-backed adapter. Safe to value-export unconditionally on every runtime — these modules never
// touch the `Bun` global outside of method bodies invoked at runtime.
export { BunRequest, BunResponse, makeBunBodyStream, readBunBody } from "./bun/BunAdapters.js";
export { BunRouter } from "./bun/BunRouter.js";
export { BunWebSocketShim } from "./bun/BunWebSocket.js";
