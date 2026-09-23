# Release Notes

## v2.2.1

### Security

- Fixed a `@StreamingBody()` route that responds without reading `req.bodyStream` (an auth failure, a validation
  error, or any other pre-body-touch rejection) leaving the underlying keep-alive connection open indefinitely if
  the client's declared `Content-Length` was never fully delivered — reachable by a fully anonymous caller sending
  only headers and zero body bytes, at a fraction of the cost of a classic slowloris attack. `UWSResponse.end()`
  now force-closes the connection instead of a graceful `end()` whenever the streaming route's declared body was
  never fully received. Fixed alongside it: destroying an unread body stream (as this fix, or an unrelated client
  disconnect, can do) no longer crashes the process (a stream with no consumer previously had no `error` listener,
  and Node treats an unhandled `error` event as fatal).
- Fixed `@RequiresScope`-protected model properties being exfiltrable through search filters, sort and count, even
  though their value was always redacted from the response. The scope requirement was only ever enforced AFTER a
  query already ran (`ObjectUtils.deleteScopedProps()`, applied to the fetched result) — a caller without the
  required scope could still binary-search a scoped field's exact value via repeated `gt()`/`lt()`/`range()`
  filters, use a `HEAD` request's `Content-Length` as an existence/equality oracle via `count()`, or read a scoped
  field's relative ordering via `sort`. Filtering, sorting or counting by a scoped field a caller can't read is now
  rejected with a 400 at query-build time, on both the SQL and MongoDB backends.
- Fixed WebSocket routes bypassing the same error-message sanitization every HTTP route gets from `Server.ts`. An
  unexpected non-`ApiError` thrown inside a `@WebSocket()` route's middleware chain (e.g. a genuine Redis/database
  failure) previously reached the client as the literal WebSocket close reason, unsanitized. WS routes now get
  their own copy of the same sanitization HTTP routes already had.

### Fixed

- Fixed `makeBodyStream()` (the uWS adapter behind `@StreamingBody()`) leaving the connection's incoming-data
  throttle permanently paused when a single chunk both overflowed the internal buffer and was the final chunk of
  the body — a narrow timing coincidence, but one a real (non-malicious) large-and-nearly-full upload could hit.

## v2.2.0

### Added

- Added opt-in streaming request bodies. A route can now be registered as `app.post(path, { streamingBody: true },
  ...handlers)`, or declared with the new `@StreamingBody()` route decorator, to receive the raw request body as a
  backpressure-aware Node `Readable` on `req.bodyStream` (also injectable directly into a handler parameter with the
  new `@BodyStream()` argument decorator) instead of the framework buffering it into `req.body`/`req.rawBody` first.
  `maxBodySize` enforcement and its 413 rejection are skipped entirely for a streaming route, leaving any size limit
  to the handler consuming the stream. Every other route's body handling is unchanged — this is purely opt-in. Built
  for consumers that need to accept very large uploads (multi-gigabyte files) without buffering the whole body in
  process memory first. On uWS, the stream is fed from `onData()`/`onAborted()` with real backpressure via
  `pause()`/`resume()`; on Bun, it adapts the platform's already-streaming `Request.body` via `Readable.fromWeb()`.
  The stream is destroyed on a client disconnect mid-upload. Not supported in combination with `@Validate` or
  `before`/`after` functions that expect `req.body` to be populated — those see `undefined` on a streaming route.

## v2.1.1

### Fixes

- Fixed a SQL `ConnectionManager.connect()` silently reusing an earlier TypeORM DataSource with the same datastore
  name, even when that one was created for different entities or a different URL, or had already been destroyed.
  The reused DataSource kept its original entity list, so the new connection's other models had no metadata ("No
  metadata for …") and `synchronize` never created their tables. This happened whenever code connected a datastore
  name for a few models first (e.g. to read startup state) and the service then connected the same name for all of
  them. A cached DataSource is now reused only while it's still initialized and was created for the same URL and the
  same entity classes; otherwise a new one replaces it. `ConnectionManager.disconnect()` also removes each destroyed
  SQL DataSource from the cache (new `TypeOrmSupport.release()`).

## v2.1.0

This release is mostly security and correctness hardening from an adversarial review of the framework and its
largest consumer. Several fixes tighten behaviour that services may have relied on; those are marked **Breaking**.

### Security

- Fixed `RepoUtils.create()` overwriting an unrelated MongoDB document when the input carries an `_id`. A create now
  always inserts (a new `MongoRepository.save()` `insertOnly` option); trusted code that must keep an `_id` can pass
  `RepoCreateOptions.preserveId`, which is still insert-only.
- Fixed creates taking over an existing ACL that shares the new record's uid, including route, class and `default_*`
  ACLs. **Breaking:** an existing ACL is now reused only for a new version of a `trackChanges` record or when trusted
  server code passes the new `RepoCreateOptions.allowExistingACL`; a trusted role alone is no longer enough, and
  reserved (route/class/default) ACL uids can never be used by a record. Otherwise the create is refused with
  `IDENTIFIER_EXISTS` (400). A fresh record ACL is claimed atomically (`ACLUtils.saveACL()` `createOnly`) and removed
  again if the record write fails, and deleting or truncating a record never removes a protected ACL.
- Fixed a `@Protect`ed route registering with no permission check when its user-editable ACL was missing at startup.
  The permission check is now always installed, a missing ACL denies, and `ACLUtils.saveDefaultACL()` recreates a
  missing user-editable ACL.
- Fixed ACL changes made through the ACL routes not taking effect until the cached copy expired (a revoked user kept
  access while it was kept warm). Every ACL model write now invalidates the permission cache, and a cache hit is no
  longer re-saved.
- Fixed `RepoUtils.update()` passing dotted and `$`-prefixed keys straight into MongoDB `$set`, bypassing validation.
  **Breaking:** such keys are rejected with 400 on both backends for update, bulk update and property updates.
- Fixed optimistic locking being skipped when `existing` is a plain document (e.g. a MongoDB `find()` result) that
  carries a numeric `version`.
- Fixed SQL search queries letting a `$or` branch override a top-level key, so a forced scope could be bypassed
  (reachable through the base64 `q` query parameter). Colliding conditions are now ANDed, matching MongoDB. Added
  `$and` support. **Breaking:** an empty or malformed `$or`/`$and`, and a `$`-prefixed field key, are rejected with
  400 on both backends.
- Fixed result caching leaking data between users: a query using `me` shared one cache key across callers, and a
  client-chosen uid could collide with another record's cache key. Record and query cache entries now use separate
  `rec:`/`q:` prefixes (existing Redis entries simply expire), a hit must match the requested id, queries are
  validated before the cache is consulted, and scoped fields are stripped from copies rather than from the cached
  objects themselves.
- Fixed push notifications carrying `@RequiresScope` fields to subscribers without those scopes. **Breaking:**
  create and update payloads never contain scoped fields; a consumer that needs one must fetch the record.
- Fixed `count()` revealing the number of soft-deleted records through operator spellings such as
  `?deleted=eq(true)`; whether deleted rows are included is now decided from the built query.
- Fixed unbounded per-record ACL work from an anonymous `DELETE /<model>` on a `recordACL` model. **Breaking:**
  `truncate()` on a `recordACL` model (when ACLs are checked) removes at most one page per request. `count()` is not
  capped: it still returns the true total, now streaming uids and checking permissions in batches so memory stays
  bounded and large MongoDB collections no longer hit the 16MB `distinct` limit.
- Fixed an unauthenticated memory leak through Prometheus metrics. **Breaking:** request metrics are now labelled
  with the matched route pattern (e.g. `/items/:id`), or `<unmatched>`, instead of the raw request path.
- Fixed `X-Forwarded-For` handling: the header is walked right to left skipping trusted proxies, and
  `X-Original-Forwarded-For` is no longer read, so a client can't spoof its IP for rate limiting or audit logs.
  `trusted_proxies` now matches normalized IPv4/IPv6 addresses (including expanded and IPv4-mapped forms) and CIDR
  ranges. Added `NetUtils.getClientIP()`, `NetUtils.normalizeIP()` and `NetUtils.isTrustedProxy()`.
- Fixed `@RateLimit` keys being bypassable with percent-encoded paths, and anonymous callers of a `perUser` limit
  sharing one global bucket; anonymous callers are now limited per client IP.
- Fixed bulk error responses exposing raw database errors (SQL text, parameters, driver details); non-`ApiError`
  items are returned as a generic internal error and logged server-side.
- Fixed the query-string parser letting a request replace the query object's prototype (`?__proto__=...`).

### Reliability

- Fixed any Redis client error crashing the process (no `error` listener). Every Redis client and duplicate created
  by the framework now logs errors and reconnects; added `attachRedisErrorHandler()`.
- Added graceful shutdown: `Server.stop()` stops accepting connections, drains in-flight requests
  (`shutdown:drain_timeout`, default 10000ms), destroys the event listener manager and then disconnects datastores.
  Added `IHttpRouter.shutdown()`.
- Fixed MongoDB updates returning 500 when a concurrent update lands between the write and its read-back; updates now
  use a new `MongoRepository.findOneAndUpdate()` and return 409 on a version mismatch.
- Fixed duplicate-key errors surfacing as 500s. They map consistently on MongoDB, PostgreSQL, MySQL and SQLite: 400
  `IDENTIFIER_EXISTS` on create, 409 for a version/identity clash on update and 400 for another unique column. Added
  `isDuplicateKeyError()` and related helpers. SQL `create()` now uses `insert()`, so a racing create can no longer
  turn into an update (TypeORM relation cascades no longer run on create).
- Fixed MongoDB schema sync dropping indexes when several classes share a collection (e.g. `@ChildEntity`).
- Fixed stale cached lists after an update or truncate.
- Fixed push socket setup leaking a Redis connection and a connection slot when the client disconnects during setup.
- Fixed sessions being created and stored on every request by bearer-token clients without a cookie; a session is
  now only persisted when the client already holds one or a handler writes to it.
- Fixed an invalid cron expression leaving a background service started but never stopped.
- Fixed uWS WebSocket `send()` reporting queued messages as failures and dropped messages as sent, and binary
  messages being read after uWS freed their buffer.
- Fixed Bun ignoring WebSocket options. **Breaking (Bun):** both runtimes now use the same explicit defaults
  (`DEFAULT_WS_OPTIONS`: 16KiB max payload, 120s idle timeout, 64KiB backpressure limit).

### Authentication

- WebSocket `LOGIN` messages and header tokens are now authenticated with the route's own `@Auth([...])` strategies,
  so routes using async-only strategies (e.g. `oauth_bearer`) work. **Breaking:** an invalid header token on a WebSocket
  route that requires auth is now rejected right after the upgrade (close code 1002) instead of with HTTP 401.
- `AuthMiddleware.authenticate()` now tries every configured strategy before failing, instead of stopping at the first
  one that throws. `@Auth("name")` with a single string now works.

### Data and queries

- Added `ModelUtils.literal(value, op)` and `PredicateNode.literal` for passing values without operator parsing, `me`
  or `null` substitution or type coercion; a client can't forge a literal. Added `\,` and `\\` escapes for values in
  `in()`, `nin()` and `range()`, and fixed `eq()` and other operators ignoring values containing newlines.
- Added coercion of ISO 8601 strings (a missing zone means UTC) and epoch milliseconds to `Date` for date-typed
  columns on create and update. **Breaking:** invalid dates, numeric strings and epoch-second numbers are rejected
  with 400, and SQL `date` columns take `YYYY-MM-DD` strings, stored as given.
- Added `default`, `length`, `unique`, `precision`, `scale`, `array`, `enum`, `unsigned` and `comment` to
  `ColumnOptions`, forwarded to TypeORM (`unique` is also enforced by MongoDB schema sync), so for example a NOT NULL
  column with a default can be added to an existing SQL table.
- Added `RepoUpdateOptions.allowReadOnly` to let trusted code write `@ReadOnly` fields.
- Fixed `regex()` conditions overwriting each other's parameter when a query has more than one, and a programmatic
  `null` value on SQL (now `IsNull()`).
- Bulk create validation failures now return `BULK_CREATE_FAILURE` with one entry per object, and bulk update
  validation failures likewise keep per-object reasons.
- Added `PATCH` to the CORS allowed methods.

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
