# Release Notes

## Unreleased

## v2.7.0

### Added

- Added send backpressure to the WebSocket shim. `IWebSocketShim` gains the optional `bufferedAmount`,
  `writableNeedDrain`, `onDrain()` and `waitForDrain()`, named after and behaving like the HTTP response adapters'
  drain API, and the uWS and Bun shims implement them. `waitForDrain()` resolves `true` at once when nothing is queued
  or once the queue drains, and `false` if the socket closes first. `onDrain()` handlers never fire after close. All
  four members are optional, so custom shims still compile; treat `undefined` as "unknown". A producer loop is
  `if ((ws.bufferedAmount ?? 0) > limit && !(await ws.waitForDrain?.())) return;`.
- Added three `@WebSocket(path, options)` options that control a failed **required** authentication. Their defaults
  keep today's behaviour exactly:
    - `loginFallback` (default `true`). When `false`, the route doesn't wait `auth:socketTimeout` for a `LOGIN` frame
      and doesn't read the client's first frame. The strategies are tried once against the upgrade request, and a
      failed required auth closes the socket at once. With optional auth, the connection goes ahead anonymously.
    - `authCloseCode` (default `1002`) is the close code for every failed required auth after the upgrade: a missing
      credential, a bad `LOGIN` token or a malformed frame. It must be an integer from 1000 to 4999, other than 1005,
      1006 and 1015.
    - `authCloseReason` (default: the existing error text) is the close reason, at most 123 UTF-8 bytes.

  Invalid values throw when the route is registered. `AuthMiddleware.authWebSocket()` takes the matching
  `WebSocketAuthOptions` as an optional third argument.
- Added the `UNREAD_BODY_DRAIN` export (`{ maxBytes: 16 MiB, timeoutMs: 30000 }`), the limits for discarding a request
  body that a response was sent before reading (see Fixed). It is read on each such response, so an application can
  change it at startup. `maxBytes: 0` answers and closes at once.
- `makeBodyStream(uwsRes, res, contentLength?)` takes an optional declared length.

### Fixed

- **A response sent before a streamed request body was read never reached the client (uWS).** When a
  `@StreamingBody()` route, or middleware in front of it such as an auth 401, a rate-limit 429 or a size-limit 413,
  answered before reading the body, `UWSResponse.end()` called `uwsRes.close()`. The client saw a dropped connection
  instead of the answer. Closing after the response isn't enough either: the client's unsent body then hits a closed
  socket, and the TCP reset makes the client discard the answer. `end()` now:
    1. destroys `req.bodyStream` with the error "The response was sent before the request body was fully read.", so a
       consumer still reading it doesn't hang;
    2. lifts any pause still owed;
    3. reads and discards the rest of the body within `UNREAD_BODY_DRAIN`, without buffering it;
    4. sends the response on a connection that stays open.

  When the declared `Content-Length` leaves more than `maxBytes` to come, or the byte or time limit is reached, the
  response goes out with `Connection: close` and the connection closes. That keeps the 2026-09-23 fix for a declared
  but never-sent body. Nothing is sent if the client leaves first. A stream that `makeBodyStream()` didn't create is
  left alone and closed after the response. Bun was not affected.
- **A keep-alive connection stalled after a large streamed request body (uWS).** When the body stream's buffer
  filled, `makeBodyStream()` paused the socket. uWS can still deliver buffered chunks after `pause()`, including the
  last one. After the stream ended, nothing called `resume()`, so the next request on the connection was never read.
  The last chunk now lifts a pause that is still owed. Bun was not affected.

- **Two concurrent creates with the same `@Identifier` value could both succeed.** `RepoUtils.create()` rejects a
  record whose identifier matches an existing one, but it checks and inserts in separate steps, and nothing in the
  database enforced the rule. `BaseMongoEntity`'s unique `(uid, version)` index can't catch two records that each got
  a fresh `uid`. `MongoSchemaSync` now creates a unique index for every `@Identifier` property, so the database
  rejects the second insert and `create()` answers with the usual `IDENTIFIER_EXISTS` error.
    - There is one index per identifier property, not one compound index, since a match on any single identifier is a
      duplicate. The index is named `<property>_identifier`.
    - A `@TrackChanges` model keeps every version of a record under the same identifier, so its index is unique on
      the property and `version` (`<property>_version_identifier`).
    - The index uses the entity's collation, like every other index, so it agrees with `create()`'s lookups. With a
      case-insensitive collation, the same identifier in a different case is a duplicate.
    - The index is partial and leaves out the values `create()` treats as empty. For strings that's absent, null and
      `""`; for `Number` and `Date` properties, any value of another type. A `0` or `false` is still indexed.
    - An identifier that is already guaranteed unique gets no extra index. That covers a unique index on exactly that
      key, or on the property and `version` (as `uid_version` covers `uid`).
    - An index the model declared on exactly that key without `unique` is upgraded in place rather than duplicated.
      It keeps its name and options and becomes unique. It also becomes partial, unless it is `sparse` (MongoDB
      doesn't allow both).
- `MongoSchemaSync` now compares an index's `partialFilterExpression` when deciding whether a declared index changed.

- **A `@TrackChanges` model matched records by their old versions.** Every version of a record is its own row, and a
  search chose the newest version only after it had filtered. A record whose `status` changed from `pending` to
  `approved` still came back for `status=pending` (as its version 0), and was counted. `truncate()` went further: it
  collected the uids of any matching version, then deleted every version of those records, current one included. A
  record-level-ACL count had the same flaw. On SQL, nothing restricted a search to the current version at all, so
  `find()` and `count()` returned every version row. And a lookup by an identifier that a rename had since changed
  returned the old version as if it were current.

  The write paths now keep a `latest` marker on each record's current version, and searches and lookups use it:
    - `create()` writes `latest: true`. `update()` inserts the new version with `latest: true`, then clears the
      marker from the older ones, inside the update's transaction where there is one. The insert comes first, so a
      crash can leave two current versions (the next update fixes that) but never none.
    - Purging the current version makes the newest remaining one current.
    - `buildSearchQuery()` adds `latest: true` for a tracked model, so `find()`, `count()`, `truncate()` and the
      record-ACL count see each record once, as it is now. A query that filters on `version` (`?version=0`,
      `?version=gte(1)`) skips that and searches history, as before. A client-supplied `latest` is ignored.
    - `findOne()` and `exists()` by identifier, without a `version`, match the current version only. A record whose
      identifier was renamed is no longer found under the old value (unless you also give its `version`).
    - The MongoDB `$match`, `$sort`, `$group`, `$replaceRoot` aggregation is gone. A tracked search is a plain indexed
      `find()` or `countDocuments()`. `ModelUtils.buildSearchQueryMongo()` always returns `{ $match, $sort? }` now,
      never a pipeline array.
    - MongoDB tracked collections get a `{ uid: 1, latest: 1 }` index (`uid_latest`), and SQL tracked tables a
      `latest` boolean column (default `false`) with a `(uid, latest)` index.
    - `@TrackChanges(0)` is now untracked everywhere. It used to be tracked by `ModelUtils` and untracked by
      `RepoUtils`.

### Upgrading

- **Startup backfills the `latest` marker of existing tracked data, and a tracked model returns nothing until it
  has.** Records written before this release have no marker. Schema sync (MongoDB, when `synchronize` is on) and
  the SQL connect step (always) therefore mark the newest version of each `uid` as current, and the rest as not.
  It runs only when some record needs it, so a later startup costs one lookup per tracked collection or table.
    - MongoDB: one cursor over each tracked collection in `{ uid: -1, version: -1 }` order (the reverse of the
      `uid_version` index), rewriting only the documents whose marker is wrong, in batches of 1000. There is no
      aggregation. The check for "some document has no `latest`" is a `findOne` on `latest: { $exists: false }`, which
      scans the collection once it finds none, so it is not free on a very large collection.
    - SQL: two `UPDATE` statements in one transaction, comparing each row's `version` with its `uid`'s maximum.
      Needed once, and only if some record has no current row. It touches every row whose marker is wrong, so allow
      for it on a large table.
    - Both are safe to run again and from several instances at once. `MongoSchemaSync.backfillLatest(collection)` and
      `backfillLatest(connection, entities)` (from `TypeOrmSupport`) re-run it by hand.
    - With `synchronize` off on a MongoDB datasource, nothing runs it for you: call `backfillLatest()` yourself. A SQL
      tracked table also needs its `latest` column and index added by your own migration in that case.
- **Don't run old and new instances against the same data at once.** An instance that predates this release
  writes new versions without the marker. Its new versions then don't show up in lists, and the record they supersede
  stays current. Deploy without overlap, or re-run `backfillLatest()` once the old instances are gone. On MongoDB
  that repairs everything. On SQL the check only looks for a record with no current row, so after an overlap set
  `latest` to `false` on the table first (`UPDATE ... SET latest = false`) and then run it.
- **On SQL, `find()` and `count()` of a `@TrackChanges` model stop returning history rows.** They return one row
  per record, the current version, as MongoDB always has. Code that relied on seeing every version row needs a
  `version` filter.
- **`truncate()` of a tracked model stops deleting records whose current version doesn't match.** It removes the
  records whose current version matches the query, with all their versions. A query that filters on `version` still
  selects records by any of their versions, and still removes the whole record.
- **Tracked rows that you insert or update yourself, bypassing `RepoUtils`, need the marker too:** set `latest: true`
  on the newest version and `false` on the others, or lists won't see them.
- If you filter a tracked model by its own fields and care about the query plan, add indexes that include `latest`
  (for example `{ latest: 1, status: 1 }`). The marker is part of every such query now.
- `@TrackChanges(0)` is now treated as untracked by every part of the library (the search builders, the schema sync
  and the SQL entity bridge used to treat it as tracked). A model declared with it keeps one row per record and gets no
  `latest` marker, index or column. Use `@TrackChanges()` or a positive count to keep versions.
- **Startup fails if a collection already holds duplicate identifiers.** The index can't be built over them, so
  schema sync throws an error that names the index, the key and the collection, and says to resolve the duplicates
  and restart. If the failed index was replacing an existing one, the old index is restored first, so the collection
  isn't left without it. Check long-lived collections for duplicate identifier values before upgrading.
- **On a model without `@TrackChanges`, an identifier must now be unique across all of its documents,** including
  documents with a different `version`. Code or test data that stores a second document with the same identifier
  under another version is now rejected.
- On a large collection, building the new unique indexes adds time to the first startup after the upgrade.
- **On uWS, an early answer to a streamed upload now arrives after the rest of the body,** up to the
  `UNREAD_BODY_DRAIN` limits, rather than as an immediate close. A client that keeps sending past `maxBytes` after the
  answer can still see a connection reset instead of the response; that is the cost of bounding the drain.
- **A route that answers while it is still reading `req.bodyStream`** now sees the stream error with "The response
  was sent before the request body was fully read." Handle the error, or stop reading once you've answered.
- A `Connection: close` header added only to work around the dropped early answer or the keep-alive stall can be
  removed.

## v2.6.1

### Added

- Added the `cors:allowedHeaders` option. It lists request headers a cross-origin request may send, appended to the
  built-in list (`Accept`, `Authorization`, `Content-Type`, `Location`, `Origin`, `Set-Cookie`, `X-Requested-With`)
  and sent in `Access-Control-Allow-Headers`. The list used to be fixed, so browsers refused any cross-origin request
  carrying a custom header such as `X-File-Name`. Duplicates are dropped.
- Added the `cors:exposedHeaders` option, sent as `Access-Control-Expose-Headers` to an allowed origin, so browser
  scripts can read those response headers (for example `X-Total-Count`). Nothing is sent when it is unset.
- Both options take an array or a comma-separated string. Neither changes which origins are allowed.

## v2.6.0

### Added

- Added `HttpResponse.destroy(error?)`, implemented by the uWS and Bun response adapters, which terminates the connection
  abruptly so the client sees a failed transfer instead of a response that ended normally (the equivalent of Node's
  `ServerResponse.destroy()`). It runs the same bookkeeping as a client that went away: `aborted` becomes `true`,
  `onAbort()` listeners and `onFinish()` handlers fire, and a pending `waitForDrain()` resolves `false`. It is a no-op
  after `end()` and when called more than once. On Bun, a response that is streaming has its body stream errored; one
  that has not started is answered with a `500` and an empty body, since Bun cannot drop a connection before it has a
  response. Custom `HttpResponse` implementations need to add the method.

### Fixed

- **A route that streamed a response and then threw ended with a normal, complete-looking `200`.** `Server.handleError()`
  skipped the status once headers were sent and then called `res.json()` with the error, which ended the chunked body
  normally: the client received the truncated content with `{"message":…,"status":500}` appended and had no way to tell
  the transfer had failed (a download whose disk read failed part way was saved as a corrupted file). Once the response
  has started, `handleError()` now logs the error and calls `res.destroy()`, so the client sees an aborted transfer.
  Before the first write nothing changes: the client still receives the status and JSON of the error.

## v2.5.1

Dependency and CI maintenance only, with no source or API changes.

### Changed

- Upgraded the runtime dependencies: `axios` to `^1.21.0`, `node-schedule` to `^2.1.2` and `ws` to `^8.22.1`.
- Upgraded the development dependencies, including `@rapidrest/core` to `^6.1.0` (the peer range stays `6.x`),
  `@rapidrest/cli` to `^2.1.0`, `nock` to `^15`, `unplugin-swc` to `^2`, `eslint-plugin-jsdoc` to `^65`, and minor
  and patch bumps across the rest. Peer dependency ranges are unchanged.
- Refreshed `yarn.lock` to the latest versions the pinned ranges allow.

### CI

- The build, test, validate and publish workflows now install Corepack with `npm install --global corepack` before
  `corepack enable`, since Node 25 and later no longer bundle it.
- Dropped `REDISMS_DISABLE_POSTINSTALL=true` from the install steps.
- Removed the `bun-smoke` job from the build workflow.

## v2.5.0

Contains breaking behaviour changes (admin endpoints, WebSocket Origin check); the version is not bumped here.

### Security

- **BREAKING:** `BaseAdminRoute`'s `restart` and `clear-cache` endpoints are now `POST`, not `GET`. A GET is exempt
  from the CSRF check and the auth cookies are `SameSite=Lax`, so a link opened by a signed-in admin could restart every
  pod or flush the cache. Both now go through the CSRF check and also require a recent elevation: the user's most
  recent elevation must be no older than `admin:elevation_max_age` seconds (default `600`).
    - Migration: call `POST <base>/restart` and `POST <base>/clear-cache` (cookie-authenticated callers must send the
      CSRF header; token/API callers are unaffected), from a session that elevated within the window.
    - The old GET paths answer `405 Method Not Allowed` with `Allow: POST` and a message naming the replacement, and do
      nothing, so a stale script fails loudly instead of silently no-op'ing. Remove the stubs in a later major.
- **BREAKING (behavioural):** WebSocket upgrades now validate the `Origin` header, closing cross-site WebSocket
  hijacking (a page on any same-site host, such as a sibling subdomain, could open an authenticated socket using the
  visitor's cookies). A handshake is accepted when it has no `Origin` (non-browser clients), when the origin's host is
  the host the request was addressed to, or when the origin exactly matches `websocket:allowedOrigins` (falling back to
  `cors:origins` when unset). Anything else is refused with HTTP `403` before the upgrade. On by default.
    - A `"*"` in `cors:origins` is deliberately not treated as "allow any"; set `websocket:allowedOrigins: ["*"]` to
      allow every origin explicitly.
    - Same-origin compares host and port, not scheme (TLS is usually terminated by a proxy). If a proxy rewrites
      `Host`, list the public origin in `websocket:allowedOrigins`.
    - Opt out with `websocket:checkOrigin: false`.
    - Affected: browser pages on a different origin than the API that connect to a `@WebSocket` route (they must now be
      in `cors:origins` or `websocket:allowedOrigins`).

### Added

- Added `ElevationWindow` (`{ config, default }`) as an argument to `@RequiresElevation()`, reading the recency window
  in seconds from configuration on each request. `RouteUtils.checkElevation()` accepts it too.
- Added `WsUpgradeAuthResult.status` and `.message` so a pre-upgrade rejection can be something other than 401.
- Added response backpressure to the uWS and Bun response adapters: `write()` now returns a boolean (`false` when the
  buffer is full, as Node's `Writable`), and `waitForDrain()`, `onDrain()`, `writableNeedDrain` and `aborted` were
  added. `waitForDrain()` resolves `true` on drain and `false` on client abort or end, so a producer loop is
  `if (!res.write(c) && !(await res.waitForDrain())) return;`. `write()` returned `void` before; callers that ignored
  it are unaffected.

### Fixed

- Fixed `UWSResponse.write()` not being corked: streaming from an async context logged
  `uWS.HttpResponse writes must be made from within a corked callback` for every chunk and cost a syscall each. The
  status/headers flush and the chunk now go out in a single cork.

## v2.4.0

Additive, so a minor-level change (2.4.0 when it is released; the version is not bumped here).

### Added

- Added per-route WebSocket options: `@WebSocket(path?, options?)`, where `options` is the new
  `WebSocketRouteOptions` (`maxPayloadLength`, `maxBackpressure`, `idleTimeout`). Until now every `@WebSocket()` route
  got the router defaults (16 KiB messages, 64 KiB send backpressure, 120 s idle timeout) with no way to change them,
  which a route streaming large frames (e.g. video) cannot live with.
    - `maxPayloadLength`, in bytes, 1 to 16 MiB, default 16 KiB: the largest single message a client may send. A larger
      one is refused and the connection closed. uWebSockets.js drops the connection without a close frame, so a client
      sees code 1006; the Bun router closes with 1009.
    - `maxBackpressure`, in bytes, 1 to 64 MiB, default 64 KiB: how much may be queued for a slow client before
      further `send()` calls are dropped. Each connection can hold that much memory, so size it for the route.
    - `idleTimeout`, in seconds, `0` (disabled) or 8 to 960, default 120: how long a connection may receive nothing
      before it is closed. uWebSockets.js refuses 1 to 7 and anything over 960.
    - Every field is optional and a route with no options is unchanged. The options are validated when the route is
      registered, and a bad value (not an integer, out of range, an unknown option name) throws an Error naming the
      route rather than reaching uWebSockets.js, which aborts the process on a bad `idleTimeout`.
    - On the Bun router `maxPayloadLength` is enforced per route, but Bun has one WebSocket configuration per server, so
      `idleTimeout` and `maxBackpressure` use the largest value any route set.

### Fixed

- Fixed the uWS router never filling `req.params` for a WebSocket upgrade request. `@Param("id")` on a
  `@WebSocket("/relay/:id")` handler was `undefined` on uWS (the Bun router already filled it), because only the
  HTTP handlers captured the `:param` segments from the uWS request. The upgrade callback now captures them, percent-decoded
  like the HTTP routes (a malformed encoding keeps the raw segment). A side effect: a `@RateLimit` on such a route now
  keys its bucket on the real param value instead of an empty one, so different resources no longer share one.
- Fixed `HttpRouter.ws()` letting an option a route set to `undefined` overwrite the router's default for that field.

## v2.3.0

### Security

- Added CSRF (double-submit cookie) protection, closing a real gap: `@rapidrest/auth`'s `jwt`/`refresh`
  cookies had no CSRF protection at all, and are shared across sibling subdomains (e.g. `auth.example.com`
  and `mail.example.com`) for SSO — cookies `SameSite=Lax` does not protect against, since it only blocks
  genuinely cross-_site_ forgery, not same-site cross-_origin_ forgery from a sibling subdomain.
    - `RouteUtils.checkCsrf()` is wired automatically into every route and applies only to a request whose
      only credential is the browser-attached `jwt` cookie (`JWTAuthResult.source === "cookie"`, a new
      field) — a bearer-token/API-key/query-token caller is never affected.
    - The CSRF cookie (`src/http/csrf/csrf.ts`) is deliberately **host-only** (never `Domain`-scoped), even
      though the session cookie itself commonly is — a wildcard-domain double-submit cookie can be read via
      `document.cookie` by any same-site sibling subdomain, which would defeat the whole scheme. A
      legitimately cross-origin caller (whose JS can never read that host-only cookie) instead relies on an
      Origin/Referer allow-list check, defaulting to the same origins already configured for CORS.
    - `src/test/request.ts`'s `agent()` now echoes the CSRF cookie back automatically, so every existing
      downstream integration test suite keeps working unchanged.
    - See `@rapidrest/auth`/`@rapidrest/auth-server`/`@rapidmx/react-shared`'s own release notes for the
      rest of this fix — cookie issuance, the two routes that needed explicit handling, and the browser-side
      header echo.

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
