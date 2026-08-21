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

**Real-time & Background Work**

- Real-time push over WebSocket — channel-based pub/sub (Redis-backed) with per-subscription
  access control
- Scheduled, cron-style background services with lifecycle management
- An application-wide event system for decoupled, in-process pub/sub

**Operations**

- Prometheus metrics out of the box
- Ready-made admin routes: health/status, live log streaming over WebSocket, static asset serving

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
