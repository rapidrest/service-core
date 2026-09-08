# Release Notes

## Unreleased

- Fixed issue with new @RateLimit middleware that causes any decorated endpoint to hang indefinitely

## v1.7.0

- Added `RateLimiter`, ported from `@rapidrest/auth`: attempt-count rate limiting, layered
  per-identifier and per-source-IP (reverse-proxy aware), Redis-backed and atomic across instances
  with an in-memory fallback.
- Added `@RateLimit()` route decorator (method or class level) that throttles a decorated endpoint
  via `RateLimiter`, keyed on `<method> <path>` of the incoming request.
- Fixed issue with path parameters not being decoded properly

## v1.6.0

- Changed `ACLUtils.getRecord()` to allow controllable search depth and specificity.
- Fixed issue with `ModelUtils.getQueryParamValue()` that produced incorrect SQL when passing in `eq(null)` or `ne(null)`.
- Fixed issue with `RepoUtils.update()` that ignored the result, not surfacing errors (such as index collisions).
- Upgraded all package dependencies

## v1.5.0

- Added support for custom @Options endpoints

## v1.4.0

- Reverted previous change that restricted dot-notation when searching for sub-documents in MongoDB queries

## v1.3.1

- Fixed issue with redis not being connected automatically before injection

## v1.3.0

- Upgraded all project dependencies
- Fixed multiple CI workflow issues

## v1.2.0

- Changed scope of `_objectFactory` declaration from private to protected for `AuthMiddleware`, `SessionManager`,
  `RepoUtils`, `ModelRoute`, and `ACLUtils`
- Fixed CI publish workflow

## v1.1.0

- Upgraded project dependencies

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
