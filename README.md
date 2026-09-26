# RapidREST: service-core

[![CI](https://github.com/rapidrest/service-core/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/rapidrest/service-core/actions/workflows/build.yml)
[![Coverage Status](https://coveralls.io/repos/github/rapidrest/service-core/badge.svg?branch=main)](https://coveralls.io/github/rapidrest/service-core?branch=main)
[![npm version](https://img.shields.io/npm/v/@rapidrest/service-core)](https://www.npmjs.com/package/@rapidrest/service-core)

A library for implementing REST API services and backend applications using a decorator-driven, aspect oriented programming (AOP), architecture. It
combines a high-performance HTTP engine, built on [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js/) or [Bun](https://bun.sh/), with
integrated database abstraction with native MongoDB and SQL (via (TypeORM)[https://typeorm.io/]) support, sessions, JWT-based authenticaiton, Roles Based Access Control, and more.

For complete documentation please visit [RapidREST.dev](https://rapidrest.dev).

## Features

**API & Routing**

- Decorator-driven, aspect-oriented routing — declare REST and WebSocket endpoints on plain
  classes, with parameter injection, before/after hooks, and request validation
- Scaffolded CRUD — a full REST API (list, get, create, update, delete, filtering, pagination)
  for a data model from a single decorated class
- Automatic OpenAPI 3 spec generation from the same route and model decorators
- Runs on [uWebSockets.js](https://github.com/uNetworking/uWebSockets.js/) or native
  [Bun](https://bun.sh/)

**Data & Persistence**

- Unified data access layer over native MongoDB and SQL (via [TypeORM](https://typeorm.io/))
- Multi-connection ACID transactions via `@Transactional` decorator, with automatic
  fallback for backends that don't support them
- Soft-delete and optimistic-locked versioning built into the base entity model, with restore
  support
- Declarative Redis-backed caching

**Auth & Security**

- Built-in JWT authentication, plus a pluggable middleware for other schemes (OAuth/OIDC,
  WebAuthn passkeys, TOTP, etc.)
- Roles Based Access Control layered with per-record Access Control Lists for fine-grained,
  row-level authorization
- Server-side session management (in-memory or Redis-backed)
- Attempt-count rate limiting (`RateLimiter`) for brute-force/abuse defense, layered per-identifier
  and per-source-IP (reverse-proxy aware), Redis-backed and atomic across instances
- CSRF (double-submit cookie) protection (`RouteUtils.checkCsrf()`), applied automatically to every
  cookie-authenticated, state-changing request — never a bearer-token/API-key/query-token caller

**Real-time & Background Work**

- Real-time push over WebSocket — channel-based pub/sub (Redis-backed) with per-subscription
  access control
- Scheduled, cron-style background services with lifecycle management
- An application-wide event system for decoupled, in-process pub/sub

**Operations**

- Prometheus metrics out of the box
- Ready-made admin routes: health/status, live log streaming over WebSocket, static asset serving

## WebSocket routes

Declare a WebSocket endpoint with `@WebSocket(path?, options?)`. It takes the same argument decorators as an HTTP
route (`@Param()`, `@Query()`, `@User()`, `@Socket`, ...) and the same `@Auth`, `@RequiresRole`, `@RateLimit`
decorators, and runs on both uWebSockets.js and Bun:

```ts
@Route("/relay")
class RelayRoute {
    @WebSocket("/:id", { maxPayloadLength: 1024 * 1024, maxBackpressure: 8 * 1024 * 1024 })
    public relay(@Param("id") id: string, @Socket socket: any): void {
        socket.on("message", (data: Buffer) => socket.send(data));
    }
}
```

The options are all optional. A route without them (or a field left out) keeps the defaults, which are uWebSockets.js'
own:

| Option             | Unit    | Default | Allowed                | What happens past the limit                                                                                                                                                  |
| ------------------ | ------- | ------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxPayloadLength` | bytes   | 16 KiB  | 1 to 16 MiB            | A larger incoming message is refused and the connection is closed (uWebSockets.js drops it without a close frame, so clients see code 1006; the Bun router closes with 1009). |
| `maxBackpressure`  | bytes   | 64 KiB  | 1 to 64 MiB            | Once this much is queued for a slow client, further `send()` calls are dropped instead of buffered. Each connection may hold this much memory.                                |
| `idleTimeout`      | seconds | 120     | `0` (off), or 8 to 960 | A connection that receives nothing for this long is closed.                                                                                                                  |

Values are checked when the route is registered: anything that is not an integer in range, or an unknown option name,
throws an Error that names the route. On the Bun router, `idleTimeout` and `maxBackpressure` are server-wide (the
largest value any route set) while `maxPayloadLength` is enforced per route.

## Installation

### NPM

```
npm i @rapidrest/service-core
```

### Yarn

```
yarn add @rapidrest/service-core
```

## Requirements

This package targets Node.js `>=24.0.0` and is published as an ESM-only package.

It declares `@rapidrest/core` as required peer dependencies. The remaining peer
dependencies are optional and only need to be installed if you use the corresponding feature:

| Peer dependency    | Required for                              |
| ------------------ | ----------------------------------------- |
| `@rapidrest/core`  | Always                                    |
| `lodash-es`        | Always                                    |
| `mongodb`          | MongoDB datasources                       |
| `openapi3-ts`      | Always                                    |
| `prom-client`      | Always                                    |
| `redis`            | Caching, sessions, WebSocket/Push support |
| `reflect-metadata` | Always                                    |
| `typeorm`          | SQL datasources                           |
| `uWebSockets.js`   | Node.js runtime                           |
| `winston`          | Always                                    |

## License

MPL v2.0 — see [LICENSE](./LICENSE).
