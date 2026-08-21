# Release Notes

## v1.2.0

- Changed scope of `_objectFactory` declaration from private to protected for `AuthMiddleware`, `SessionManager`,
  `RepoUtils`, `ModelRoute`, and `ACLUtils`

## v1.1.0

- Upgrading project dependencies

## v1.0.0

### Features

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
