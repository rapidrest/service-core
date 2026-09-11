# Release Notes

## v2.0.0

- Reworked `ModelUtils` search query building for correctness and SQL/MongoDB parity. **Breaking:** `like()` now
  takes glob syntax (`*`/`?`) translated per backend instead of raw SQL `LIKE`/regex, and an unrecognized
  operator name (e.g. a typo) is now rejected with a 400 instead of silently falling back to an equality
  comparison (`eq(...)` remains the escape hatch for a literal value shaped like an operator call).
- Added a `regex()` operator for raw regular-expression matching on both backends - PostgreSQL (`~*`),
  MySQL/MariaDB (`REGEXP`) and now also `better-sqlite3`, via a `REGEXP` SQL function registered automatically
  per connection.
- Added an `exists()` operator (`exists(true)`/`exists(false)`) for null-checking, on both backends.
- Implemented the previously-unused `exactMatch` option: when `false`, a string-valued parameter with no
  explicit operator now matches as a case-insensitive "contains" search instead of always matching exactly.
- Added nested `$or` support on the SQL backend (previously MongoDB-only), and a new `QueryNode`/`GroupNode`/
  `PredicateNode` tree-shaped query form (`ModelUtils.buildQueryFromNode()`) for boolean nesting the flat
  `op(value)` query-parameter form can't express, plus `ModelUtils.toTsQuery()` for generating a PostgreSQL
  `tsquery` expression from that tree.
- `sort` now validates requested fields against the model's declared columns (when available) and supports the
  `sort=-fieldName` descending shorthand, on both backends.
- Fixed `not()`/`ne()` producing an invalid MongoDB query (`$not` on a scalar) - both now compile to `$ne`.
- Fixed `in()`/`nin()`/`range()` operands not being coerced to the field's declared type, and search values in
  general being coerced by guessing from their shape (e.g. a text value like `"Mar 5"` silently becoming a
  `Date`) rather than the model's declared column type.
- Fixed the `me` keyword only resolving as a bare value (not inside `eq(me)`/`in(me,other)`) and mutating the
  caller's query object when substituting it.
- Fixed the operator-injection guard only being applied on the MongoDB backend, not SQL.
- Improved the ReDoS guard on `regex()` to also catch quantified-alternation patterns (e.g. `(a|ab)*`).
- Added `$or`/query-tree depth and complexity bounds to guard against pathological nested queries.
- Added `ModelUtils.resolvePagination()` and `ModelUtils.toFindQuery()` helpers for callers building a MongoDB
  query directly (outside of `RepoUtils`) that want the same bounded pagination and single return shape the SQL
  path already provides.

## v1.8.0

- Raised `RateLimiter`'s default identifier-layer limit from 5 attempts/300s to 100 attempts/60s. That
  counter is keyed on `<method>|<path>` when driven by `@RateLimit` (i.e. shared across every caller of
  a route, not per-caller), so the old default was far stricter than the per-IP layer's default of
  100/300s and caused frequent lockouts once `@RateLimit` was applied to general, non-auth endpoints.
- `@RateLimit()` now takes options: `perUser` (default `true`) scopes the limit to the authenticated
  caller instead of globally across the whole route, and `id` sets an explicit identifier. **Breaking:**
  `RateLimiter.checkAndIncrement()`'s signature changed from `(identifier, req?)` to
  `(identifier, config?, req?)` - it also now accepts a per-call `RateLimitConfig` override of
  `maxAttempts`/`windowSeconds`/`ip` on top of the service-level config.

## v1.7.2

- Upgraded @rapidrest/core dependency

## v1.7.1

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
