# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.2.1] - 2026-09-23

### Added
- Added UWSResponse.attachBodyStream() and isBodyStreamFullyReceived(), tracking uWS onData's isLast independently of the stream's own readableEnded, which Node never sets without an active consumer even for an already-fully-arrived empty body
- Added ModelUtils.getScopedPropertyNames(), reading a constructed instance's own properties (matching ObjectUtils.deleteScopedProps()'s own strategy) instead of getReadOnlyPropertyNames()'s prototype-only walk, which does not see an ordinary @RequiresScope-decorated field since its class-field initializer compiles to an own-instance assignment that never reaches the prototype
- Added ApiErrors.SEARCH_SCOPED_FIELD
- Added regression tests for all of the above, including a real uWS raw-socket reproduction of the connection-hang exploit and confirmation a route that does drain the body keeps its normal graceful response path

### Changed
- Document the streaming-body connection-hang fix, the pause/resume coincident-EOF fix, and the query-time scope enforcement fix under Unreleased in RELEASE_NOTES.md, and record all findings plus the deferred idle-timeout and trackChanges+RequiresScope follow-ups in NOTES.md
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

### Fixed
- Fixed a @StreamingBody() route that responds without draining req.bodyStream leaving the uWS keep-alive connection open indefinitely, live-reproduced as a trivial anonymous-caller connection-exhaustion DoS via a declared Content-Length the client never sends; UWSResponse.end() now force-closes via uwsRes.close() instead of a graceful end() whenever the declared body was never fully received
- Fixed destroying an unread body stream (via the close() fix above, or an unrelated client disconnect) crashing the process with an unhandled 'error' event, in both makeBodyStream() and makeBunBodyStream()
- Fixed makeBodyStream() leaving uWS's incoming-data throttle permanently paused when a single chunk both overflows the buffer and is the final chunk of the body, since Node's Readable never calls _read() again once push(null) has run to issue the matching resume()
- Fixed @RequiresScope-protected model properties being exfiltrable through search filters, sort and count despite being redacted from responses, since the scope requirement was only ever enforced after a query already ran; add ModelUtils.assertFieldScope(), rejecting a filter, sort or count referencing a scoped field the caller can't read with a 400 at query-build time on both the SQL and MongoDB backends
- Fixed WebSocket routes bypassing Server.ts's non-ApiError message sanitization, letting an unexpected raw error (e.g. a genuine Redis or database failure) reach a client as the literal WebSocket close reason; add RouteUtils.sanitizeWsError(), appended as the last item of every WS route's middleware chain the same way Server.ts's handleError is the last item of globalMiddleware for HTTP

## [2.2.0] - 2026-09-23

### Added
- Added HttpRouteOptions.streamingBody, the @StreamingBody() route decorator and @BodyStream() argument decorator so a route can opt out of the framework's default full-body buffering and receive the raw request body as a backpressure-aware req.bodyStream Node Readable instead, leaving every other route's req.body/req.rawBody behavior completely unchanged
- Added makeBodyStream() to the uWS adapter, feeding a Readable from onData()/onAborted() with real backpressure via pause()/resume(), tracking a local paused flag since calling uWS's resume() without a matching prior pause() silently stops all further onData delivery and hangs the request forever
- Added makeBunBodyStream() to the Bun adapter, adapting the already-streaming Request.body via Readable.fromWeb() and destroying the stream when the request's AbortSignal fires mid-upload
- Added splitRouteArgs() shared by HttpRouter and BunRouter so a route can be registered as app.verb(path, { streamingBody: true }, ...handlers) without changing the call signature or behavior of every existing route that only ever passes handler functions
- Added regression tests covering byte-for-byte upload fidelity over both real uWS and Bun dispatch, client-disconnect-mid-upload cleanup, and an ordinary route on the same router being completely unaffected
- Added junit.xml to gitignore

### Changed
- Skip maxBodySize buffering and its 413 rejection entirely for a streaming route, leaving any size limit to the handler consuming req.bodyStream
- Document the uWS pause()/resume() non-idempotence pitfall in NOTES.md
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Document the streaming-body feature added in d556026 under Unreleased in RELEASE_NOTES.md
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>

## [2.1.1] - 2026-09-15

### Changed
- Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

### Fixed
- Fixed SQL connect() reusing a cached DataSource created for other entities, another URL or already destroyed, which left the new connection's models without metadata or tables, and release destroyed DataSources on disconnect()

## [2.1.0] - 2026-09-15

### Added
- Added RepoUpdateOptions.allowReadOnly to let trusted code write @ReadOnly fields
- Added RepoCreateOptions.preserveId for trusted code that must keep an _id, still insert-only, and report duplicate keys as IDENTIFIER_EXISTS
- Added ACLUtils.saveACL() createOnly so a fresh record ACL is claimed atomically and removed again if the record write fails
- Added coercion of ISO strings and numbers to Date for Date-typed columns on create and update, with 400 for invalid dates
- Added $and support, reject empty or malformed $or and $and and $-prefixed field keys with 400, give each regex() condition its own parameter name, and map null to IsNull() on SQL
- Added ModelUtils.literal() and PredicateNode.literal for passing values without operator parsing, substitution or coercion, and reject forged $literal keys from clients
- Added default, length, unique, precision, scale, array, enum, unsigned and comment to ColumnOptions and forward them to TypeORM, registering unique as an index for Mongo schema sync
- Added Mongo and SQL integration tests for create, ACL, update and query parity, and SQL synchronize tests for column options
- Added graceful shutdown that drains in-flight requests before closing datastores
- Added PATCH to CORS allowed methods

### Changed
- RepoUtils.update() previously reset every @ReadOnly field back to its
- existing persisted value unconditionally, with no way to opt out - which
- meant trusted server-side code that legitimately owns a @ReadOnly field's
- lifecycle outside the ordinary create/update path (a background job, a
- route action handler) could never adopt @ReadOnly for that field without
- breaking its own writes.
- allowReadOnly defaults to false/unset, preserving the exact existing
- behavior for every current caller. Mirrors the ignoreACL option already on
- RepoOperationOptions for the same "trusted internal code overriding a
- normally-enforced protection" shape.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Document the port 3000 conflict behind earlier red HTTP integration tests and the remaining SQL concurrency gaps
- Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
- Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>

### Fixed
- Fixed RepoUtils.create() overwriting an existing Mongo document when the input carries an _id, by always inserting through a new MongoRepository.save() insertOnly option
- Fixed RepoUtils.create() granting the creator an existing ACL that shares the new record's uid, reusing it only for new versions, trusted callers, allowExistingACL or callers already holding every creator action
- Fixed RepoUtils.update() passing dotted and $-prefixed keys into $set, rejecting them with 400 on both backends for update, bulk update and property updates
- Fixed optimistic locking being skipped when existing is a plain document with a numeric version
- Fixed Mongo updates returning 500 when a concurrent update lands before the read-back, using a new MongoRepository.findOneAndUpdate() with 409 on version mismatch
- Fixed SQL search queries letting a $or branch override a top-level key, combining colliding conditions with And() to match Mongo
- Fixed eq() and other operators ignoring values containing newlines, and add \, and \ escapes for in(), nin() and range() values
- Fixed creates reusing route, class and default ACLs by reserving their uids, never removing protected ACLs on delete or truncate, and recreating a missing user-editable ACL at startup
- Fixed planted ACL reuse, allowing an existing ACL only for new trackChanges versions or trusted code passing allowExistingACL
- Fixed @Protect routes registering without a permission check when their ACL is missing, always installing the check and denying without an ACL
- Fixed ACL route changes not reaching the permission cache by invalidating it on every ACL model write and no longer re-saving cache hits
- Fixed cached results leaking between users for me queries and through uid and query key collisions, using rec: and q: key prefixes, validating queries before cache lookups and stripping scoped fields from copies
- Fixed stale cached lists after updates and truncates
- Fixed push notifications carrying @RequiresScope fields to subscribers
- Fixed count() revealing soft-deleted records through operator spellings of the deleted filter
- Fixed unbounded record ACL work in truncate() by capping it at one page per request, and stream uids with batched permission checks in count() so it stays uncapped and avoids the MongoDB distinct size limit
- Fixed Prometheus request metrics growing without bound by labelling them with the matched route pattern
- Fixed X-Forwarded-For spoofing and IPv6 trusted proxy matching, and add NetUtils.getClientIP(), normalizeIP() and isTrustedProxy() with CIDR support
- Fixed @RateLimit keys bypassable through percent-encoding and shared by all anonymous callers
- Fixed bulk error responses exposing raw database errors
- Fixed Redis client errors crashing the process and add attachRedisErrorHandler()
- Fixed duplicate-key errors surfacing as 500s across MongoDB, PostgreSQL, MySQL and SQLite, and use insert() for SQL creates
- Fixed SQL date columns stored a day off and tighten date coercion to ISO 8601 strings and epoch milliseconds
- Fixed MongoDB schema sync dropping indexes for classes sharing a collection
- Fixed push socket setup leaking Redis connections and connection slots
- Fixed sessions persisted for every cookie-less bearer-token request
- Fixed an invalid cron expression leaving a background service running
- Fixed uWS WebSocket send() status handling and binary message buffers, and apply WebSocket options on Bun with shared defaults
- Fixed the query-string parser allowing prototype replacement
- Fixed WebSocket LOGIN ignoring the route's @Auth strategies, and try every auth strategy before failing
- Fixed bulk create and update validation errors to report per-object reasons

## [2.0.0] - 2026-09-11

### Changed
- Rework ModelUtils search query building for correctness and SQL/Mongo parity
- Fixes an invalid Mongo not()/ne() query, un-coerced in()/nin()/range()
- operands, inconsistent me substitution, and a SQL-only operator-injection
- gap. Adds regex()/exists() operators, nested $or on SQL, a QueryNode AST
- for boolean nesting the flat query-param form can't express, sort-field
- validation, and implements the previously dead exactMatch option.
- Breaking: like() now compiles glob syntax instead of raw SQL LIKE/regex,
- and an unrecognized operator name is rejected rather than silently
- treated as equality.
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>


### Added
- `regex()` search operator for raw regular-expression matching on both SQL (PostgreSQL, MySQL/MariaDB, and
  `better-sqlite3` via an auto-registered `REGEXP` SQL function) and MongoDB.
- `exists()` search operator (`exists(true)`/`exists(false)`).
- Nested `$or` support on the SQL search backend (previously MongoDB-only).
- `QueryNode`/`GroupNode`/`PredicateNode` tree-shaped query form and `ModelUtils.buildQueryFromNode()`, for
  boolean nesting the flat `op(value)` query-parameter form can't express.
- `ModelUtils.toTsQuery()` to generate a PostgreSQL `tsquery` expression from a `QueryNode` tree.
- `sort=-fieldName` descending shorthand and sort-field validation against the model's declared columns, on
  both search backends.
- `ModelUtils.resolvePagination()` and `ModelUtils.toFindQuery()` helpers for direct MongoDB query consumers.
- `$or`/query-tree depth and node-count bounds to guard against pathological nested queries.

### Changed
- **Breaking:** `like()` now takes glob syntax (`*`/`?`) translated per backend, instead of raw SQL
  `LIKE`/regular expression syntax.
- **Breaking:** an unrecognized search operator name is now rejected with a 400 instead of silently treated as
  equality; use `eq(...)` for a literal value shaped like an operator call.
- The `exactMatch` search option is now implemented: `false` makes a string-valued parameter with no explicit
  operator match as a case-insensitive "contains" search instead of always matching exactly.

### Fixed
- `not()`/`ne()` no longer produce an invalid MongoDB query (`$not` on a scalar); both compile to `$ne`.
- `in()`/`nin()`/`range()` operands are now coerced per-element to the field's declared column type, and search
  value coercion in general now prefers the model's declared type over guessing from the value's shape.
- The `me` keyword now resolves inside any operator (`eq(me)`, `in(me,other)`), not just as a bare value, and no
  longer mutates the caller's query object.
- The operator-injection guard is now applied uniformly on both the SQL and MongoDB backends.
- The ReDoS guard on `regex()` now also catches quantified-alternation patterns (e.g. `(a|ab)*`).

## [1.8.0] - 2026-09-09

### Added
- Added options to @RateLimit decorator for explicitly setting an id, toggling per-user rate limiting and overriding service-level defaults

## [1.7.2] - 2026-09-08

### Changed
- Upgraded @rapidrest/core dependency

## [1.7.1] - 2026-09-08

### Fixed
- Fixed issue with new @RateLimit middleware that causes any decorated endpoint to hang indefinitely
- Fixed release notes file

## [1.7.0] - 2026-09-08

### Added
- Added new RateLimiter utility for rate limiting requests
- Added @RateLimit decorator and accompanying middleware for applying rate limiting

### Changed
- Attempting to fix CI publish workflow

### Fixed
- Fixed issue with HTTP adpater that did not URL decode parameterized paths properly

## [1.6.0] - 2026-09-08

### Added
- Added installation of build-essential to CI build job
- Added install of python3 to build CI

### Changed
- - Check updateOne()/repo.update()'s result before falling through to the findOne(version+1) fallback
- - Throw INVALID_OBJECT_VERSION when zero rows matched/affected instead of returning a concurrent writer's row
- Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Changing how SQL eq(null) queries are built from `Equal(null)` to `IsNull())` which produces desired results
- Upgraded all package deps
- Switched from custom release script to rapidrest CLI
- Changed ACLUtils.getRecord to  allow controllable search depth and specificity

### Fixed
- Fixed RepoUtils.update() silently losing an optimistic-lock conflict
- Fixed issue with `yarn install` on CI
- Fixed more issues with CI jobs

### Removed
- Removed disable of redis build for CI build job


## [1.5.0] - 2026-09-07

### Added
- Added changelog and release script

### Changed
- Letting app-registered OPTIONS routes run instead of the blanket CORS preflight 204

## [1.4.0] - 2026-08-27

### Fixed
- Reverted a change that incorrectly restricted legitimate dot-notation queries of MongoDB sub-documents

## [1.3.1] - 2026-08-25

### Added
- Added a contributing guide

### Changed
- Renamed the contributors file to `CONTRIBUTORS.md`

### Fixed
- Fixed an issue where a newly created Redis client was not automatically connected before being injected into a constructed object

## [1.3.0] - 2026-08-22

### Changed
- Upgraded all dependencies
- Reverted the CI build image back to `node:lts-trixie-slim`
- `build.yml` test job now runs `yarn test` instead of invoking `vitest` directly
- Updated `@rapidrest/core`

### Fixed
- Fixed additional GitHub Actions workflow issues

## [1.2.1] - 2026-08-21

### Changed
- Switched the CI build image to `node:lts-bookworm-slim`

### Fixed
- Fixed license section in the README

## [1.2.0] - 2026-08-21

### Changed
- Changed scope of `_objectFactory` declaration from private to protected for `AuthMiddleware`, `SessionManager`, `RepoUtils`, `ModelRoute`, and `ACLUtils`

### Fixed
- Fixed outdated Bun smoke test
- Fixed GitHub CI publish workflow

## [1.1.0] - 2026-08-21

### Changed
- Upgraded all dependencies

## [1.0.0] - 2026-08-21

### Added
- Initial release

[Unreleased]: https://github.com/rapidrest/service-core/compare/v2.2.1...HEAD
[2.2.1]: https://github.com/rapidrest/service-core/compare/v2.2.0...v2.2.1
[2.2.0]: https://github.com/rapidrest/service-core/compare/v2.1.1...v2.2.0
[2.1.1]: https://github.com/rapidrest/service-core/compare/v2.1.0...v2.1.1
[2.1.0]: https://github.com/rapidrest/service-core/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/rapidrest/service-core/compare/v1.8.0...v2.0.0
[1.8.0]: https://github.com/rapidrest/service-core/compare/v1.7.2...v1.8.0
[1.7.2]: https://github.com/rapidrest/service-core/compare/v1.7.1...v1.7.2
[1.7.1]: https://github.com/rapidrest/service-core/compare/v1.7.0...v1.7.1
[1.7.0]: https://github.com/rapidrest/service-core/compare/v1.6.0...v1.7.0
[1.6.0]: https://github.com/rapidrest/service-core/compare/v1.5.0...v1.6.0
[1.5.0]: https://github.com/rapidrest/service-core/compare/v1.4.0...v1.5.0
[1.4.0]: https://github.com/rapidrest/service-core/compare/v1.3.1...v1.4.0
[1.3.1]: https://github.com/rapidrest/service-core/compare/v1.3.0...v1.3.1
[1.3.0]: https://github.com/rapidrest/service-core/compare/v1.2.1...v1.3.0
[1.2.1]: https://github.com/rapidrest/service-core/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/rapidrest/service-core/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/rapidrest/service-core/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/rapidrest/service-core/commit/3847e60f663be5100d74f855859819bb74984697
