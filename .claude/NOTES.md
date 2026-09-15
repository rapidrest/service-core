# service-core — Design Decisions & Session Notes

This file exists so that Claude sessions working in this repo don't re-litigate settled
decisions or re-discover the same issues from scratch. It is local to this repo (not tied to
any one machine's global Claude memory), so it travels with the code.

**Maintenance rule:** when a standing decision changes, update the section below in place
(don't just append a contradiction lower down). When a new investigation/session produces a
decision, finding, or reverted approach worth remembering, add a dated entry under Session Log.
Keep entries terse — this is a reference, not a transcript.

## Standing design decisions & constraints

- **Commit discipline.** Don't `git commit` unless explicitly asked for _that specific piece of
  work_. An autonomous-execution/"commit as you go" approval given for one approved plan (e.g. via
  plan mode) is scoped to that plan only — it does not carry forward to later, separate requests in
  the same session, even ones that look similar in kind (a follow-up review-and-fix pass, a
  refactor, a new feature), and even after a full review-and-fix cycle with passing tests. Default
  to leaving changes staged/unstaged and saying so; only commit automatically within the exact
  scope of a plan that was explicitly approved as autonomous. If unsure whether new work falls
  inside that scope, treat it as outside and ask.

- **Commit message style: a flat list of one-line, verb-led items — no summary/title line, no
  `-`/`*` bullet markers.** This isn't just a style preference — it's dictated by how `release`
  (`@rapidrest/cli`) actually builds `CHANGELOG.md`. `collectChangelogBullets`/
  `classifyChangelogLine` (that repo's `src/lib/release.ts`) parse `git log --pretty=format:%B` and
  treat **every non-blank line of a commit's full message as its own changelog bullet** — there is
  no subject/body distinction. A conventional "short imperative subject + blank line + prose body"
  commit therefore leaks one changelog bullet per body sentence, and a `-`/`*`-prefixed line breaks
  `classifyChangelogLine`'s verb detection (it reads the line's first whitespace-delimited word as
  the verb; a leading `-` defeats that lookup and the dash leaks into the changelog text as
  `"- - Added foo"`). Correct format:
    - No separate summary/title line — if a commit needs an overview, that overview is itself just
      one more flat line, not a heading distinct from the rest.
    - No bullet-marker prefix of any kind — write bare lines.
    - Lead each line with an imperative verb where it fits: `Add`/`Fix`/`Remove` (and `-ing` forms)
      are recognized and become `Added`/`Fixed`/`Removed` entries; `Configuring`/`Converting`/
      `Refactoring`/`Updating`/etc. become `Changed`. Anything else still works, defaulting to
      `Changed` verbatim — see `CHANGELOG_VERB_REWRITES` in that repo's `src/lib/release.ts` for the
      full map.
    - A blank line before a trailing git trailer (`Co-Authored-By:`, `Signed-off-by:`, etc.) is fine
      — trailers matching `CHANGELOG_NOISE_PATTERNS` are dropped from the changelog — but nothing
      else should follow the item list.
      This mirrors JP's standing convention across his other repos; copy this exact rule verbatim into
      each sibling repo's own NOTES.md rather than paraphrasing it, since the paraphrase is what caused
      this to be gotten wrong in the first place (see `@rapidrest/cli`'s own NOTES.md, 2026-09-07 entry,
      for the full incident writeup and the `CHANGELOG_NOISE_PATTERNS` fix that accompanied it).

- **No MongoDB aggregation pipelines.** The project owner has already tuned performance
  throughout this framework away from `.aggregate()` — it's a measured bottleneck here, not a
  style preference. Use plain `find()` / `distinct()` / `count()`, and if a result needs
  bounding, do it client-side (e.g. `.slice(0, limit)`) rather than reaching for aggregation.
  The one pre-existing exception is `RepoUtils.count()`'s non-`recordACL` Mongo branch, which
  uses `.aggregate()` for multi-branch `$or` queries with `$count` — that's existing precedent,
  not license to add more.

- **Vulnerability/review threat model: externally-exploitable only.** This library is a power
  tool for developers building their own services, not a hardened black box. When reviewing for
  "vulnerabilities," only count issues reachable from a downstream, untrusted HTTP/WebSocket
  client hitting a service built on the framework (anonymous or low-privilege caller). Do NOT
  flag: developer-only footguns (misusing an API, a decorator applied wrong in your own code),
  internal utilities only the operator touches (build/CLI/startup wiring), or purely theoretical
  races with no concrete external trigger path. Every finding should be able to name the actual
  HTTP route/method or WS message type that reaches the code in question.

- **Extract already-computed values; don't re-derive them.** `ModelUtils.buildSearchQuerySQL()`
  already resolves a `take` (row limit: no client `limit` → 100, explicit `limit` → hard-capped
  at 1000) onto every SQL search query it builds. When some other method needs that same limit,
  read it off the built query object — don't recompute the same rule independently from the raw
  client query. This class of mistake (parallel computation drifting from the source of truth)
  is why the `count()`/`truncate()` ACL-enumeration cap (see Session Log, 2026-08-15/16) took
  three iterations to land correctly.

- **Two-agent adversarial review pattern.** For a "full codebase review for bugs/vulns/perf,"
  split the `src/` tree across two parallel agents rather than reviewing serially or duplicating
  full coverage twice: one on the auth/ACL/security surface (`auth/`, `security/`, `decorators/`,
  `routes/`, `ApiErrors.ts`), one on the core runtime/data layer (`database/`, `http/`,
  `Server.ts`, background services, `models/`, `EventListenerManager.ts`, etc). Brief both
  agents to trace a concrete failure scenario for every finding — no speculative "could
  theoretically" issues — and to apply the threat-model scope above.

- **Test coverage gate.** `yarn test` enforces global coverage thresholds (~97% statements /
  92% branches / 99% functions / 97% lines as of 2026-08). New conditional logic (error paths,
  fallback branches) needs a matching test or the whole suite fails on the coverage gate, not
  just on assertions. Prefer fast unit tests with mocked repos over slow integration tests when
  the goal is just hitting a specific branch (see `test/RepoUtils.unit.test.ts` for the pattern:
  construct `new RepoUtils(SomeModel)` as `any`, stub `.repo` directly).

- **Aspect/method decorators resolve DI dependencies via `this._objectFactory`, never a bespoke
  side-effect map.** Core `ObjectFactory` sets `_objectFactory` (non-enumerable) on every
  instance it creates specifically so decorators can reach the container without being field-
  injected — e.g. `this._objectFactory?.getInstance(ConnectionManager)`. `@Transactional`
  originally resolved its connection from a `_datasources` Map that only got populated as a side
  effect of `@DataSource`/`@Repository` field injection; any class that didn't declare one of
  those fields (`ModelRoute`, `CRUDRoute`) silently got no connection, making the decorator a
  no-op until someone hand-copied a matching `_datasources.set(...)` into that class's own
  init path. Removed entirely (from `ObjectFactory.ts`, `RepoUtils.ts`, `ModelRoute.ts`) in favor
  of the `_objectFactory.getInstance()` lookup. Don't reintroduce a similar per-instance map for
  any future decorator that needs container access.

- **Any method decorator that reassigns `descriptor.value` must explicitly restore the
  function's `.name`.** `descriptor.value = async function (...) {}` doesn't trigger JS's
  function-name inference (that only fires for identifier/object-literal-property assignment),
  so the wrapper's `.name` becomes `""`. `RouteUtils.wrapMiddleware()` looks up
  `@Param`/`@Query`/`@User`/etc. argument metadata via
  `Reflect.getMetadata("rrst:args", proto, func.name)` — an empty name makes that lookup miss
  silently, and the route handler receives zero arguments (no error at decoration time). Fix:
  `Object.defineProperty(descriptor.value, "name", { value: propertyKey, configurable: true });`
  right after building the wrapper. This bit `@Transactional` once it was added to
  `CRUDRoute.delete/truncate/update/updateProperty` — every one of those routes started 500ing,
  with a stack trace that looked like an unrelated null-deref, nothing about decorators.

- **Prefer extending a general function with an option flag over adding a narrow bespoke one —
  but verify default-filter semantics match before swapping, don't just match the call
  signature.** Same spirit as "extract already-computed values" above. Concrete case: reused
  `RepoUtils.count()` (with `ignoreACL: true, includeDeleted: true`) instead of keeping a
  separate `countByUid()`, but `count()`/`exists()` silently exclude soft-deleted rows by
  default — naively swapping to `exists()` would have made every ordinary (non-purge) soft-
  delete misreport as `purged: true`. Had to add a real `includeDeleted` option to `count()`
  first so it could reproduce the bespoke function's exact behavior.

- **A write path on a different connection than its caller's transaction needs its own
  `@Transactional(<connection-name>)` scope, plus a `registerRollbackHook()` compensating action
  if something elsewhere depends on it rolling back together.** `ACLUtils` is the reference
  implementation (see Session Log, 2026-08-21) — `acl` is commonly a genuinely separate physical
  connection from an entity's own datastore, so passing the caller's `session`/`entityManager`
  into it doesn't work (Mongo rejects a session from a different `MongoClient`; SQL just
  misbehaves). `saveACL()`/`removeACL()` instead open/join their own `acl`-scoped transaction and
  commit independently; `RepoUtils.create()/delete()/truncate()` register a `registerRollbackHook()`
  compensating action (delete a freshly-created ACL, or restore a removed one from its snapshot)
  so the entity-side transaction aborting still cleans up the ACL side, best-effort. Don't reuse
  the caller's own session/entityManager across a connection boundary — open a new scope instead.

## Open / in-progress design threads

- **Transaction support is implemented, ongoing refinement.** `@Transactional`
  (`src/decorators/DatabaseDecorators.ts`) now covers `RepoUtils.create/update/delete/truncate()`
  plus `ModelRoute`/`CRUDRoute`'s `doCreateObject`/`doDelete`/`doTruncate`/`doUpdate`/
  `doUpdateProperty`/`delete`/`truncate`/`update`/`updateProperty`. Nested `@Transactional` calls
  merge into a single outer transaction by default (`TransactionalMode.MERGE`); pass
  `{mode: TransactionalMode.CREATE}` to force a genuinely independent second one. This supersedes
  the "planned transaction support" note that used to be here — the in-process lock/rollback
  approach from 2026-08-15/16 has not been reintroduced. Still open: whether any `runExclusive`-
  based workarounds elsewhere in the codebase (the ones this whole effort set out to unwind) are
  now actually redundant and can be removed — hasn't been swept end-to-end.

## Session Log

### 2026-08-15/16 — Two-agent adversarial review, 3 rounds, ultimately reverted for a transactions-based redesign

**Round 1** (auth/security surface + core runtime/data layer split, see pattern above). Found
and fixed 6 issues:

1. `EventListenerManager.init()` invoked 2-3x per `Server` startup (once automatically via
   `ObjectFactory.newInstance()`'s default `initialize: true`, once explicitly in `Server.ts`,
   plus a redundant registration `forEach`) — every `@OnEvent` handler fired multiple times per
   event.
2. `RepoUtils.count()/exists()/truncate()` used an unbounded (Mongo) or wrongly-capped (SQL,
   stuck at the default `take` of 100) `find()` + a single unbounded `Promise.all` for ACL
   fan-out on `recordACL` models — silently wrong counts/incomplete truncates on large tables.
3. Residual cross-model TOCTOU race in the ACL-hijacking fix from commit `b32dfe5` — two
   different models' concurrent `create()` calls could both claim the same globally-uid-keyed
   ACL record, since the existing lock was scoped per-`RepoUtils`-instance (per model).
4. `BasePushRoute.connect()`'s per-user socket cap and `activeSubs` bookkeeping had a TOCTOU
   race (unlike `SUBSCRIBE`/`UNSUBSCRIBE`, which already used `runExclusive`).
5. `@Protect` decorator's ACL clone (`RouteDecorators.ts` + `ModelDecorators.ts`) was shallow —
   `records` array still shared by reference across classes sharing one ACL object.
6. `userOrRoleId` API docs (`AccessControlListSQL.ts`/`AccessControlListMongo.ts`) falsely
   claimed regex support; corrected to state only `"*"`/`".*"` wildcards match.

Note: commit `ba7c852` (already on `main` before this session) has an almost identically-worded
message ("Removing duplicate EventListenerManager.init() call... BasePushRoute now wraps
socket-check... @Protect now performs deep clone..."), but the working tree still had the actual
bugs present when this round started — the relationship between that commit and these findings
was never fully reconciled. Don't assume `ba7c852` already covers this ground; verify current
code directly.

**Round 2** (re-scoped to the externally-exploitable-only threat model, same two-agent split).
Both agents independently converged on the same regression, introduced by round 1's own fix #2:

1. **[HIGH] Anonymous DoS via `count()`/`truncate()` on `recordACL` models.** Removing the
   accidental pagination cap (to fix the undercounting bug) also removed the only thing bounding
   how much work a single anonymous request could trigger — `count()`/`truncate()`
   intentionally skip their class-level permission check for `recordACL` models (auth happens
   per-record instead, by design), so an anonymous `DELETE /<model>` against a large table
   became a cheap full-table-scan-plus-fan-out DoS.
2. **[MEDIUM-HIGH] Orphaned row on losing the cross-model ACL race.** Round 1's shared
   per-uid lock closed the ACL-claim race, but the data row save happens outside that lock — the
   loser's row was already committed by the time it lost the claim, leaving an orphaned,
   ACL-less row governed only by the winner's foreign ACL.

**Round 3** (fixing finding #1 above — three iterations before the user reverted the whole
thing):

- (a) First cut: an explicit `QUERY_TOO_BROAD` error at a 10,000-row ceiling. User rejected:
  wanted silent automatic capping instead, matching pre-session behavior.
- (b) Second cut: capping via an independently-recomputed limit (no `limit` → 100, explicit
  `limit` → hard-capped at 1000), with the Mongo side implemented as an aggregation
  `$group`/`$limit` pipeline. User rejected the aggregation specifically — see the standing
  decision above.
- (c) Third cut: stopped recomputing the limit independently and extracted `searchQuery.take`
  directly (already resolved by `ModelUtils.buildSearchQuerySQL()`), falling back to a plain
  `100` only for Mongo (which never bakes a `take` onto its built query at all). Mongo capping
  used plain `distinct()` + `.slice(0, take)` in JS — no aggregation.

**Outcome:** after (c) passed build + full test suite (1033 tests, coverage gate satisfied), the
user reverted all of rounds 2-3 (and possibly round 1 — see the `ba7c852` note above) via direct
git operations, stating they're going to solve the underlying concurrency issues by implementing
transaction support throughout the library instead. As of 2026-08-16 the working tree is back to
a single pre-existing, session-unrelated one-line docstring fix in `ModelUtils.ts`
(`buildSearchQueryMongo`'s `@returns` comment). See "Open / in-progress design threads" above —
do not redo the lock/cap/rollback approach without checking whether transactions have landed.

### 2026-08-20 — @Transactional: merge-context review, DI redesign, soft-delete query support

Continuation of the transaction-support effort referenced above. The user had added a
merge-context feature to `@Transactional` (nested calls reuse an outer transaction by default —
`TransactionalMode.MERGE`/`CREATE`) and applied the decorator to several `CRUDRoute`/`ModelRoute`
handler methods, and asked for a correctness/vuln/perf review plus test coverage.

**Bugs found and fixed:**

1. The merge-context flag was computed but never actually used to skip opening a second, nested
   transaction — nesting always opened a fresh one regardless of mode.
2. `ModelRoute`/`CRUDRoute` had no way to resolve a connection at all (see the `_datasources` →
   `_objectFactory` standing decision above) — `@Transactional` was a silent no-op on every route
   handler until that was fixed.
3. `conn.startSession(options)` passed the whole `TransactionalOptions` object instead of
   `options.driverOptions`.
4. **The big one:** once (1) and (2) were fixed and `@Transactional` started actually running on
   route handlers, every route decorated with it (`CRUDRoute.delete/truncate/update/
updateProperty`) started 500ing — root cause was the decorator's wrapper function losing its
   `.name` (see standing decision above), which broke `RouteUtils`' `@Param`/`@Query`/`@User`
   argument injection. Not discovered until running the _full_ test suite, not just the files
   touched — worth remembering that a change to a shared decorator needs a full-suite run even
   when the diff looks contained to `RepoUtils`/`ModelRoute`.
5. `ModelRoute.doDelete()`'s `recordEvent` path computed its `purged` flag via
   `this.repoUtils.repo.count(...)` directly against the raw repo, bypassing whatever transaction
   was now active — once merge-context nesting was real, that read could observe stale
   pre-commit state. Fixed (see below).

**Redesign:** user rejected the `_datasources` connection-resolution mechanism outright once
bugs #1-2 surfaced from it, calling it "more code to maintain, opportunities for mistakes" — see
the `_objectFactory` standing decision above for the replacement.

**`countByUid()` added then removed:** first fix for bug #5 was a new `RepoUtils.countByUid()`
helper. User pushed to reuse `count()`/`exists()` instead — see the "prefer extending a general
function" standing decision above. Net result: `count()` gained a real `includeDeleted` option
(and two of its own latent transaction-visibility bugs got fixed along the way: the Mongo
non-aggregate branch never passed `{session}`, the SQL branch never used the active
`entityManager`), `countByUid()` was deleted.

**Follow-on requirement:** user flagged that soft-deleted records must be independently queryable
via the API (e.g. an admin history/restore UI) — `find()`/`count()` already supported this
transparently (a client's `?deleted=true` flows untouched through `ModelUtils.buildSearchQuery()`),
but `findOne()`/`exists()` hard-excluded soft-deleted rows with no override at all. Both now
respect the new `includeDeleted` option; `ModelRoute.doFindById()`/`doExists()` translate a
`?deleted=true` query param into it.

**Outcome:** 1093 tests passing, `yarn lint` and `tsc --noEmit` clean. See the global Claude
memory project/feedback notes on this same effort for more detail than fits here.

### 2026-08-21 — ACLUtils gets its own transaction scope + rollback compensation; rounds 3-5 of adversarial review

Continuation of the `@Transactional` effort above. Root problem: `ACLUtils` is commonly
configured on a genuinely separate physical connection (`acl`) from an entity's own datastore,
but `RepoUtils` was passing its own `session`/`entityManager` straight into `ACLUtils` calls —
throws on Mongo (`ClientSession must be from the same MongoClient`), misbehaves on SQL, whenever
`acl` really is a different connection.

**Fix — ACLUtils owns its own transaction scope.** `ACLUtils.saveACL()`/`removeACL()` are now
themselves `@Transactional("acl")` — each opens/joins a transaction scoped to `acl`, fully
decoupled from the caller's. Consequence: an ACL write now commits independently and _can't_ be
rolled back by the entity-side transaction aborting. Compensated via a new mechanism in
`DatabaseDecorators.ts`:

- `registerRollbackHook(fn)` — call from inside a `@Transactional`-wrapped method to register a
  best-effort compensating action.
- `TransactionContext.onRollback` — a fresh hook array per _real_ transaction boundary (shared
  across merged/nested `@Transactional` calls via `TransactionalMode.MERGE`), run via
  `Promise.allSettled` in that boundary's `catch` before rethrowing.
- `RepoUtils.create()/delete()/truncate()` register compensating actions (delete a freshly-created
  ACL on rollback, or restore a removed one) using the ACL snapshot returned by `saveACL()`/
  `removeACL()`.

Other ACLUtils changes from the same effort:

- `removeACL()` does an atomic find-and-delete (new `MongoRepository.findOneAndDelete()`) instead
  of separate find+delete, so the returned document is a race-free snapshot to restore from.
- `saveACL()` gained `preserveVersion?: boolean` — a restore-from-snapshot write needs to write the
  snapshot's _own_ version back, not recompute one (right after a delete there's nothing to diff
  against, so recomputing always forced version 0, silently discarding the real prior version).
  Also refuses rather than clobbers if something already exists at that uid by restore time.
- `saveACL()`/`findACL()` gained `skipCache?: boolean`, mirroring `RepoUtils`'s existing flag.
- `removeACL()`'s error handling narrowed to only swallow `"ns not found"`, not all errors.
- `removeACLs()`/`saveACLs()` batch methods run sequentially, not via concurrent `Promise.all` —
  each inner call merges onto the _same_ transactional session/entityManager the batch method
  opened, and concurrent writes against one session are unsupported by the Mongo/SQL drivers.
  `filterPermittedUids()`'s existing concurrent-batch pattern is safe only because it does
  non-transactional _reads_ — don't assume that pattern generalizes to writes on a shared session.
- `ACLUtilsOptions` interface removed entirely (was superseded by the above).

**`MongoRepository.save()` gained an opt-in `mergeByUid?: boolean`** (default `false`, behavior
otherwise unchanged) so `saveACL()` can match/replace by `uid` — the framework's true logical
primary key — instead of requiring `_id`, which may not have been preserved on a freshly
spread-constructed object. Implemented via `findOneAndReplace()` (not `replaceOne()`) so the
real `_id` is captured on both the insert and the update path in one round trip. **Do not** change
`save()`'s _default_ matching behavior — a first attempt at this did, and broke real MongoDB
integration tests: a test fixture and `RepoUtils`'s own trackChanges/versioned-save paths rely on
the "no `_id` → always insert" default to keep multiple documents per `uid` (one per version).
Changing a shared method's default for one caller's benefit is high blast-radius; verify with the
full test suite (including real DB integration tests, not unit mocks) before assuming a "smarter
default" is safe, and prefer an opt-in flag when only one caller needs the new behavior.

**Two-agent adversarial review, rounds 3-5** (see pattern in standing decisions above), run after
the redesign above landed. Each round's agents were briefed on everything already fixed so they
hunted fresh ground. Findings, most significant first:

1. **[CRITICAL] `@Transactional`'s non-transactional fallback leaked a foreign connection's
   session.** When a call's own connection didn't support transactions but was nested inside an
   outer transaction on a _different_ connection (exactly the `acl`-is-a-separate-connection
   shape this whole redesign was for), the fallback silently ran the method body inside the
   _outer_ connection's ambient session. Fixed: the fallback now checks whether the ambient
   context's datasource differs from the current call's own and, if so, re-scopes to a
   session-less context instead of leaking the foreign one through.
2. **[Correctness]** ACL rollback-restore silently reset the ACL's version to 0 — see
   `preserveVersion` above.
3. **[Medium]** Soft-deleted-record visibility (`?deleted=true`) required only ordinary
   READ/LIST/EXISTS/COUNT permission, not the DELETE+UPDATE actually needed to restore a record.
   Fixed across `findOne`/`exists`/`find`/`count` in `RepoUtils` via a new `canViewDeleted()`
   helper.
4. **[Real, cheaply client-triggerable]** Unbounded ACL-check amplification via WS `SUBSCRIBE` —
   `BasePushRoute`'s per-channel loop only stopped early once the subscription _budget_ was
   exhausted by grants; a denial never consumed budget, so an authenticated client naming
   thousands of denied channel names in one frame forced that many sequential ACL/DB lookups.
   Fixed by bounding the channels _checked_ (not just granted) to the remaining budget upfront
   (`requested.slice(0, remaining)` before the permission-check loop).
5. `BasePushRoute`'s socket `close` handler now runs through the same per-user `runExclusive()`
   lock as `connect()`/`SUBSCRIBE`/`UNSUBSCRIBE` — it used to mutate `activeSocks`/`activeSubs`
   directly, unguarded, and could race a concurrent connect/subscribe for the same user.
6. **[Fixed separately, same session]** `RouteUtils`' WS pre-upgrade auth (`upgradeAuth` in
   `registerRoute()`) now respects the optional-auth contract: an invalid/expired token caught
   during `authenticateSync()` only rejects the upgrade when the route actually requires auth
   (`authRequired`); otherwise it falls through anonymous, matching the post-upgrade
   `authWebSocket()` message-based path's equivalent handling. Previously any thrown auth error
   rejected the connection regardless of whether auth was optional.
7. **[Accepted, not a bug — do not re-flag]** MongoDB's driver-level `session.withTransaction()`
   can retry its _entire_ callback on a transient conflict, so `RepoUtils.create()/delete()/
truncate()`'s calls into `ACLUtils` and the outbound push notification can double-fire on
   retry. User explicitly accepted this: a real fix needs either restructuring where
   `@Transactional` boundaries sit relative to `RepoUtils`'s method bodies, or idempotency keys on
   notifications/ACL calls — both bigger than the actual risk, since every side effect examined so
   far is idempotent in effect under retry (`saveACL()`'s no-op-on-no-diff check, `removeACL()`'s
   not-found handling).
8. `MongoRepository.save()`'s `mergeByUid` mode originally dropped `_id` when replacing (not
   inserting) — see `findOneAndReplace()` fix above.

**Outcome:** 1143 tests passing (up from 1093), `yarn build` and `yarn lint` clean, coverage gate
satisfied. Several of these bugs (the `withTransaction` fallback leak, the `save()`
default-behavior break) were only caught by running the _full_ suite including real Mongo/SQL
integration tests — a change that looks contained to one file (`ACLUtils.ts`, `RepoUtils.ts`) can
still need a full-suite run when it touches a shared decorator or a shared repository method.

### 2026-09-06 — App-registered `OPTIONS` routes now run instead of the blanket CORS preflight 204

Found while auditing `@rapidmx/activesync` for `[MS-ASCMD]` spec compliance: `Server.ts`'s global
CORS middleware unconditionally answered every `OPTIONS` request with a bare `204` _before_ any
app route ever ran, so an app-defined `@Options()` handler (e.g. EAS's own
`MS-ASProtocolVersions`/`MS-ASProtocolCommands` capability-discovery response) could never fire.

Fixed via `c8cde0b`: `IHttpRouter` gained `hasExplicitOptionsRoute(path): boolean`
(`src/http/types.ts`), implemented in both `HttpRouter`/uWS (`src/http/uWS/Router.ts`) and
`BunRouter` (`src/http/bun/BunRouter.ts`) by tracking literal (non-`/*`) paths registered via
`.options()` in a `Set`, normalized for a trailing-slash mismatch either side (`normalizePath()`
helper, duplicated identically in both router files since they don't share a base class). The
framework's own internal `/*` CORS-preflight fallback (registered in `listen()`) is deliberately
never tracked as "explicit" — it must keep deferring to the blanket 204, not to itself.
`Server.ts`'s CORS middleware condition changed to
`if (req.method === "OPTIONS" && !this.app.hasExplicitOptionsRoute(req.path))`. This has to be a
request-time check (not resolved at build/registration time) since route registration order
relative to the CORS middleware's own setup isn't guaranteed — see `hasExplicitOptionsRoute`'s own
doc comment.

Verified via the full existing suite (1153/1153 passing) plus new unit tests on both routers
(`test/http/uWS/Router.test.ts`, `test/http/bun/BunRouter.test.ts`) and a new `Server.test.ts`
end-to-end case (`test/server/routes/DefaultRoute.ts` gained a fixture `@Options("capabilities")`
route that now actually answers with its own JSON body, while an unregistered path still gets the
old blanket `204`). `test/routes/OpenAPIRoute.test.ts` needed a path-count fix (37→38) since the
new fixture route adds one more registered path.

Downstream consumers (e.g. `@rapidmx/activesync`'s `BaseEasRoute.ts`) only get real `OPTIONS`
capability discovery once their own `@rapidrest/service-core` dependency is bumped to a version
that includes this commit — on an older `service-core`, `OPTIONS` still always gets the bare `204`
and a client falls back to just trying its first `POST` directly.

### 2026-09-08 — Neither router ever percent-decoded a `:param` path segment

Found by a Claude session working in `rapidmx/server` (its `.claude/NOTES.md`, Phase 3 entry of the
`@rapidmx/restapi` feature-wiring plan, has the fuller downstream story) via a live `yarn dev` smoke
test — not the test suite, which mocks `fetch` everywhere and never exercises a real request against
a real server. `GET /api/mail/mailboxes/jdoe%40example.com` 404'd even though the mailbox existed;
`GET /api/mail/mailboxes/jdoe@example.com` (unencoded) worked. Root cause: `http/uWS/Router.ts`
(`uwsReq.getParameter(i)`) and `http/bun/BunRouter.ts` (`reqSegments` from `URL.pathname`) both hand a
`:param` value straight to `req.params` with no `decodeURIComponent()` — unlike query-string parsing
in `http/uWS/Adapters.ts`, which already decodes. `BunRouter.test.ts` even had a test asserting the
buggy behavior as intentional ("extracts :param values without percent-decoding") — this was a
deliberate design choice, just an incorrect one: any consumer that `encodeURIComponent()`s a uid
before building a URL (a normal, common thing to do — the affected downstream code did this for every
email-address-derived uid) gets the literal encoded string back in `req.params`, which then fails
every lookup keyed on the real (decoded) value.

Fixed: both param-extraction sites now `decodeURIComponent()` each raw segment, falling back to the
raw value on malformed percent-encoding (a bare `%`) — same defensive pattern `Adapters.ts`'s
query-string parsing already used. Updated `BunRouter.test.ts`'s stale test to assert the fixed
behavior, added a matching malformed-encoding fallback test to both `Router.test.ts` and
`BunRouter.test.ts`. `Server.test.ts`'s own integration suite was independently flaky in that
session's environment (real `mongodb-memory-server`, real port bind) at the time — confirmed via
`git stash` that the flakiness reproduced identically with the fix removed, i.e. unrelated to this
change; the new unit tests (which fake the uWS/Bun request objects, no real port) passed cleanly
throughout, and the downstream `rapidmx/server` repo's own equivalent real-server/real-DB integration
tests came back fully green once patched in.

Downstream consumers only get correctly-decoded path params once their own `@rapidrest/service-core`
dependency is bumped to a version including this fix — any route whose `:param` values are ever
built via `encodeURIComponent()` upstream (which, for a uid containing `@`, `/`, `%`, or any other
character that function escapes, is the *only* correct way to build that URL) is affected until then.

### 2026-09-08 — `RateLimiter` adopted from `@rapidrest/auth`

JP's call: the rate limiter that had been living in `@rapidrest/auth` is a general framework utility,
so it now lives here as `src/RateLimiter.ts` (+ `test/RateLimiter.test.ts`, 33 tests, all green).
`@rapidrest/auth` deleted its copy and imports this one; that repo's NOTES.md carries the consumer-side
half of this entry.

- **Deliberately un-namespaced** (JP chose a clean break over a compat shim): config path `rateLimit`,
  cache-key prefix `ratelimit:`, and event type `ratelimit.exceeded`, exported as the
  `RATELIMIT_EXCEEDED_EVENT` const. The auth-side names it replaced were `auth:rateLimit`,
  `auth:ratelimit:` and `auth.ratelimit.exceeded` — a breaking change for `@rapidrest/auth` consumers,
  documented in that repo's `RELEASE_NOTES.md`.
- **Dependencies were already all local** — `ApiErrors`, `ConnectionManager`, `HttpRequest` and
  `NetUtils` are ours; `ApiError`/`EventUtils`/`MemoryStore`/`ObjectDecorators` come from
  `@rapidrest/core` (note `EventUtils` is exported from core's `TelemetryUtils.ts`, not a file of its
  own). No new package deps; `redis` was already a required peer, and the index barrel now pulls in a
  *value* import of its `ErrorReply`.
- **The class is not safely subclassable for re-namespacing** — worth knowing before anyone tries:
  re-declaring `@Config(...)` on the same property in a subclass does not override the base, because
  `ObjectFactory._getOrBuildMetadata()` collects a match from *every* proto in the chain and
  `initialize()` applies them subclass-first/base-last, so the base path wins. And two classes sharing
  the name `RateLimiter` collide on the `` `${className}:${name}` `` registry key. Per-consumer
  namespacing should go through `@Inject(RateLimiter, { name, args })` instead.
- **`INCREX` requires Redis 8.8+**, which Redis Software/Redis Cloud/Memurai do not have yet — hence
  the `redisIncrexUnsupported` latch and in-memory fallback. That fallback is a real, deliberate
  degradation (counters stop being atomic across instances for the life of the process) and its
  regression tests came over with the class; don't "simplify" it away.
- **Pre-existing, unrelated: ~16 HTTP integration test files were already red on this working tree**
  (`Server*`, most of `routes/`, `security/ACLRoute*`) — plausibly the in-flight uncommitted
  `BunRouter`/`uWS/Router` percent-decode work above, since those two routers serve every one of them.
  Confirmed not caused by the `RateLimiter` addition: with it removed and the index export reverted, the
  full suite failed *more* (17 files/261 tests vs 16/234), and the with-RateLimiter failing set is a
  strict subset of the control's — the one difference (`routes/ModelRoute.SQL.test.ts`) failed only in
  the control, i.e. flake. `test/RateLimiter.test.ts` itself is green in both the isolated and full runs.

### 2026-09-08 — `@RateLimit()` route decorator added (JP), consuming routes picked in `@rapidrest/auth`

JP added `@RateLimit()` (`RouteDecorators.ts`) + `RouteUtils.checkRateLimiter()` directly, on top of the
`RateLimiter` port above — applicable at the method or class level, runs as the *first* middleware in the
chain (ahead of elevation/auth/roles/scopes/permissions/validator), and keys `RateLimiter.checkAndIncrement()`
on the literal `` `${req.method} ${req.path}` `` of the incoming request.

- **`req.path` is the real request path, params included** — `this.path = rawUrl` in both adapters (see
  `Adapters.ts`) — not the route pattern. So the identifier this decorator produces is per-*resource* for a
  parameterized route (`POST /clients/abc123/regenerate-secret` and `.../xyz789/...` throttle independently)
  but a single identifier **shared globally by every caller** for a fixed-path route (`GET /jwks.json` has
  exactly one bucket for the whole deployment, not one per caller).
- **That global-sharing is a real trap for high-traffic identity endpoints specifically**, worth flagging to
  anyone reaching for this decorator: `RateLimiter`'s default config (`maxAttempts: 5`, `windowSeconds: 300`)
  is calibrated for "attempts against one claimed identity," not "requests to one endpoint from the whole
  caller population." Slapping `@RateLimit()` on e.g. a login/refresh/authorize route at that default would
  throttle the 6th *unrelated* legitimate caller in 5 minutes, not just an attacker — a straightforward
  regression, not a stricter version of the existing per-identifier protection. It's also not straightforward
  to fix by config alone: `RateLimiter` is a single shared singleton/config, so raising `maxAttempts` to suit
  a volumetric use case also weakens every identifier-keyed `checkAndIncrement()` call site sharing that same
  config. There's no per-route override today - only a flat global `rateLimit`/`ip` config section.
- **Consuming-side picks landed in `@rapidrest/auth`** (that repo's NOTES.md carries the reasoning in full):
  `BaseOAuthDiscoveryRoute.discovery()`, `BaseOAuthJwksRoute.jwks()` (both public/unauthenticated with no
  identifier available at all), `BaseOAuthClientRoute.regenerateSecret()` (parameterized path, so effectively
  per-client), and `BaseImpersonationRoute.impersonate()` (fixed path, but deliberately global — catches an
  attacker rotating the *target* on every request, which a per-target counter structurally can't). Every
  existing manual `checkAndIncrement(identifier, req)` call site elsewhere in that repo was deliberately left
  alone for the reason above.

### 2026-09-14 — Query/schema layer fixes from the `@rapidmx/restapi` adversarial review (agent B)

Found downstream (restapi's `.claude/NOTES.md` has the workarounds). Ran alongside a second agent working on the
`RepoUtils`/`MongoRepository`/route write paths, so none of those files were touched here.

1. **[HIGH] SQL `$or` replaced colliding top-level keys.** `buildSearchQuerySQL()` built each `$or` branch with
   `{...existing, ...orClause}`, so `{folderUid: "mine", $or: [{folderUid: "x"}]}` became `WHERE folderUid = 'x'`
   (Mongo ANDs it correctly). This is externally reachable: `RouteUtils` decodes the base64 `q` JSON query parameter
   on GET/HEAD into an arbitrary object, including `$or`. restapi's note that "`parseQueryString` is flat, so a client
   can't build `$or`" only covers the plain query string. The same spread was in `compileNodeSQL`'s AND reducer.
   Fixed with `andBranches()`/`mergeWhereBranches()`: a key on both sides becomes a flat TypeORM `And(...)` (raw
   values wrapped as `Equal`/`IsNull`, nested plain objects merged per key), and the cross-product bound is checked
   before allocating. Related holes closed at the same time:
   - `$or: []` expanded to zero branches, which deleted the whole `where` and matched every row (a total scope bypass).
     Mongo 500'd on it. Both now return 400.
   - A non-array `$or`, or an array of non-objects (a repeated `?$or=`), is now 400 on both (it was a 500 or
     meaningless per-character sub-queries).
   - `$`-prefixed keys/segments are now 400 on SQL too (they were TypeORM 500s), matching Mongo.
   - `$and` is now supported on both backends. It's needed to combine two `$or`s, e.g. a forced one and a client one.
   - Every `regex()` `Raw()` now gets a unique parameter name (`rrst_regex_<n>`). Two regex conditions in one query
     used to share `:pattern`, so the second silently replaced the first.
   - A programmatic bare `null` value compiles to `IsNull()` on SQL. TypeORM throws on it by default.
2. **[HIGH] No literal escape for programmatic values.** Findings verified against the current code:
   - `eq()` did take everything between the first `(` and the last `)`, but not across a newline: the regex used
     `.`, so `eq(a\nb)` fell through to a bare literal `"eq(a\nb)"`. It now uses `[\s\S]`.
   - `eq()` operands are still coerced (`me`, `null`, declared type, JSON/date heuristic without metadata). That is
     public HTTP API behavior, so it was kept and documented.
   - `in()`/`nin()`/`range()` now split with `splitListOperand()`: `\,` is a comma, `\\` is a backslash, and any other
     backslash is kept.
   - Added `ModelUtils.literal(value, op = "eq")`, which returns a frozen `QueryLiteral`. Ops are
     eq/ne/gt/gte/lt/lte/in/nin/range. A literal skips operator parsing, `me`/`null` substitution and type coercion.
     Only the hidden-`$`-key check still runs. It works in zipped arrays and `$or`/`$and` branches.
   - Added `PredicateNode.literal`, the same flag for the AST path.
   - `QueryLiteral.toJSON()` serializes under a `$literal` key, so `RepoUtils`' query hash differs from a plain value
     and a client echoing that JSON gets a 400 (operator-injection guard).
   - Documented the escape rules in `buildSearchQuery`'s doc comment (the README has no query DSL section).
3. **[MEDIUM] `ColumnOptions` gained `default`, `length`, `unique`, `precision`, `scale`, `array`, `enum`,
   `unsigned` and `comment`.** `TypeOrmSupport` forwards the keys listed in `FORWARDED_SQL_COLUMN_OPTIONS`.
   - `unique` is not forwarded as a column option. `@Column` registers it as the same single-property unique index
     `@Unique()` creates, so `MongoSchemaSync` enforces it too, and it dedupes with an explicit `@Unique()`.
   - Everything else is documented as SQL only. Mongo has no document-default layer, so use property initializers there.
   - `test/database/TypeOrmColumnOptions.test.ts` reproduces restapi's `NOT NULL constraint failed` on a real
     file-backed SQLite `synchronize`, and shows that `default` fixes it.

Tests:
- `test/database/SearchQueryParity.test.ts` runs identical queries against real Mongo (port 9999) and SQLite and
  requires the same rows back, including the count path and truncate's uid-only query. With the `ModelUtils.ts` fix
  stashed, all 7 tests fail and it shows the `u3`/`u4` cross-scope leak.
- Unit tests were added in `ModelUtils.test.ts`, `TypeOrmSupport.unit.test.ts` and `PersistenceDecorators.test.ts`.
- Four existing regex tests now match `:rrst_regex_\d+` instead of `:pattern`.

Not done, noted for whoever picks it up:
- `RepoUtils.count()`'s `clientRequestsDeleted` detection only recognizes a plain `deleted: true/"true"`, not
  `ModelUtils.literal(true)`. Only trusted code can build a literal, so this isn't externally reachable.
- `count({includeDeleted})` on Mongo only strips a top-level `$match.deleted`, not the copy inside each zipped
  `$or` branch (pre-existing; SQL loops over every branch).
- SQL `ne(x)` excludes NULL rows, while Mongo `$ne` includes null/missing ones (pre-existing parity gap, untouched).

Verification:
- `tsc --noEmit` is clean.
- `yarn lint` is clean (the `RepoUtils.ts:986` jsdoc error seen mid-session was fixed by the write-path work below).
- Full `yarn vitest run` first showed 262 failures across 17 HTTP integration files (`Server*`, `routes/*`,
  `security/ACLRoute*`: 404s on `/items`, a WebSocket connect timeout, an OPTIONS 204). **Correction:** these were not
  pre-existing code failures. A `rapidmx/server` dev worker was listening on `0.0.0.0:3000`, the test server's default
  port, so test requests hit that process instead. With `PORT=3777 yarn vitest run` the full suite, including this
  work, passes and meets the coverage gate (see the write-path entry below). The 2026-09-08 "~16 red files" note was
  very likely the same port conflict.
- Targeted coverage for the changed files: `ModelUtils.ts` is at 99% statements and 94.8% branches, with every new
  line and branch covered. `PersistenceDecorators.ts` is at 100%.

### 2026-09-14 — Write-path fixes from the `@rapidmx/restapi` adversarial review (agent A)

Ran alongside agent B (entry above). Touched `RepoUtils.ts`, `MongoRepository.ts`, `ACLUtils.ts` only; no
`ModelRoute`/`CRUDRoute` change was needed (every route write goes through `RepoUtils.create()/update()`), so the
"separate collaborators for a ModelRoute and a RepoUtils change" split didn't apply. Each item was verified against HEAD
`7a62419` first; all six still reproduced (`test/RepoUtils.WriteSafety.test.ts` fails 12/15 against HEAD's
`RepoUtils.ts`/`ACLUtils.ts`).

1. **[CRITICAL] Client `_id` on create replaced another document (Mongo).** `create()` now deletes `_id` from the
   object and always saves with the new opt-in `MongoRepository.save(..., { insertOnly: true })` (insertOne even when
   `_id` is set; `save()`'s default is unchanged, per the standing decision). New `RepoCreateOptions.preserveId` (trusted
   code only) keeps the `_id`, still insert-only. A duplicate key on the insert is now `IDENTIFIER_EXISTS` 400 instead of
   a raw driver error. `version`/`dateCreated`/`dateModified` were already overwritten on create (verified, now tested).
   No internal caller passed an `_id` into `create()`; trackChanges saves in `update()` and ACL restores use
   `repo.save()`/`saveACL()` directly and are unaffected. `update()` now always takes `_id` from `existing` (or drops the
   input's when `existing` has none) instead of only for `BaseMongoEntity` instances.
2. **[HIGH] ACL adoption on create.** History: `b32dfe5` added a guard (`count === 0 && existing ACL` -> 400) plus a
   cross-model `runExclusiveForUid` re-check; `e9453ac` (transactions rewrite) dropped both, so `create()` silently
   adopted any ACL at the uid and appended a full-rights record for the creator. New `claimRecordACL()` runs *before*
   the record is written. An existing ACL is reused, **unchanged** (the creator is never appended to it), only when:
   `count > 0` (trackChanges new version; UPDATE already verified), the caller is trusted, trusted code passed the new
   `RepoCreateOptions.allowExistingACL`, or the caller already passes `hasPermission` for all 8 creator actions on that
   ACL (so reuse grants nothing). Otherwise `IDENTIFIER_EXISTS` 400 (same code/status as a record collision; kept 400
   rather than 409 to match the existing collision error and its tests). Orphan detection isn't possible (any model could
   own the uid), so no replace-orphan path. A fresh ACL is claimed with the new `saveACL(acl, { createOnly: true })`
   (insert-only at version 0; refuses if one exists; Mongo 11000 on the `(uid, version)` unique index / SQL PK conflict
   -> `IDENTIFIER_EXISTS`), which closes the cross-model race without a lock, and the loser never writes its row. If the
   record write fails after a fresh claim, `create()` removes the ACL itself (no rollback hook exists without
   transactions); the rollback hook is still registered after a successful write. Behaviour change: a trackChanges new
   version by someone with UPDATE via a role no longer gets a personal full-rights record.
3. **[HIGH] `$set: {...obj}` path keys.** `update()` rejects any top-level key containing `.` or starting with `$`
   (400 `INVALID_REQUEST`) on both backends, before any write. On SQL these were TypeORM `EntityPropertyNotFoundError`
   500s. Covers `PUT /:id`, bulk `PUT /` and `PUT /:id/:property` (all reach `update()`). No framework-internal update
   uses dotted keys (`delete()`'s soft-delete calls `updateMany` directly), so no opt-out was added.
4. **[HIGH] Optimistic lock skipped for plain `existing`.** `update()` now treats `existing` as versioned when it is a
   `BaseEntity` instance or (for a `BaseEntity` model) carries a numeric `version`; that drives the lock check,
   `dateCreated` protection, the version/`dateModified` bump and branch selection on both backends. Chose this over
   making `MongoRepository.find()` return model instances: that would change every raw-repo caller, and instantiation
   drops fields a model constructor doesn't copy (e.g. the fixture `User.uType`), which would then be written back as
   defaults via the `@ReadOnly` reset.
5. **[MEDIUM] Mongo read-back race.** Non-trackChanges Mongo updates now use the new
   `MongoRepository.findOneAndUpdate()` (`returnDocument: "after"`); no match -> 409 (versioned) or 404 (unversioned,
   record gone). No separate read-back. SQL keeps update + read-back: inside its transaction the row lock blocks a
   concurrent writer, so the race doesn't exist there.
6. **[MEDIUM] Date fields stored as strings.** `create()`/`update()` convert string/number values of Date-typed
   `@Column`s to `Date` (400 on an invalid or blank string), via `getColumnMetadata()`: explicit date-like
   `@Column({ type })` first, else `design:type === Date`. Limitation: `Date | null` reflects as `Object`, so those
   fields are only converted when `@Column` sets `type`. Nested/array dates are not handled.
   **Correction (F1, same day):** the claim "SQLite already stored ISO strings correctly; the SQL gain is the 400" was
   wrong for date-only columns. `DATE_COLUMN_TYPES` included `"date"`, so `"2026-09-14"` became UTC midnight, and TypeORM
   writes a `Date` into a `date` column with the server's *local* calendar date (`DateUtils.mixedDateToDateString`), i.e.
   the 13th on any server west of UTC. SQL date-only columns are now validated as `YYYY-MM-DD` and kept as strings; see
   the F1 entry below for the full input rules.

Not done / noted: `update()`'s SQL trackChanges `repo.insert()` still turns a concurrent `(uid, version + 1)` PK
conflict into a raw 500 (Mongo maps it to 409); SQL `create()` still uses TypeORM `save()`, which can become an UPDATE
if a concurrent insert lands between the count check and the save.

**Test environment finding (affects agent B's entry above):** the ~17 red HTTP integration files were not
pre-existing flakiness this time. A `rapidmx/server` dev worker (`tsx src/worker.ts`) was listening on `0.0.0.0:3000`,
the test `Server`'s default port, so test requests hit that process and got 404s. `PORT=3777 yarn vitest run` (nconf
env override) is fully green. Check `netstat -ano | grep :3000` before blaming flakiness.

Tests: new `test/RepoUtils.WriteSafety.test.ts` (real Mongo on 9999 + in-memory SQLite: `_id` overwrite, cross-model /
well-known-uid ACL hijack, concurrent cross-model claim with no orphan row, dotted/`$` keys, plain-document locking,
read-back race, dates); new cases in `RepoUtils.unit.test.ts`, `security/ACLUtils.unit.test.ts` (`createOnly`) and
`routes/SecurityFixes.test.ts` (HTTP `_id` single/bulk create, dotted body/`:property`). Updated three unit tests for the
`findOneAndUpdate` switch and replaced "logs instead of reverting when saveACL() modified an existing ACL" (that path no
longer exists). Full run with `PORT=3777`: 68 files / 1356 tests passed, coverage 97.93 / 93.3 / 99.45 / 97.88
(includes agent B's in-progress changes). `yarn lint` and `tsc --noEmit` clean.

### 2026-09-14 — Auth, route registration and rate limiting fixes (fix agent F3)

Ran at the same time as F1 (RepoUtils/ACLUtils/MongoRepository/ModelUtils) and F2 (Server/NetUtils/http/…). Only
`RouteUtils.ts`, `auth/AuthMiddleware.ts`, `CRUDRoute.ts`, and doc comments in `RateLimiter.ts`/`RouteDecorators.ts` were
touched. Every finding was re-checked against HEAD `6878bf8` first, and all six reproduced.

1. **[CRITICAL] A `@Protect` route with a missing ACL registered with no permission check.** `registerRoute()` replaced
   the declared ACL with `saveDefaultACL()`'s return value. That returns `null` when the user-editable `<uid>` record is
   gone but `default_<uid>` exists, and then the `aclUid` guard skipped `checkRequiredPerms()`. Fixed in RouteUtils
   regardless of F1's `saveDefaultACL()` change:
   - The permission middleware is always keyed on the uid declared in `@Protect` metadata, never on the datastore result.
   - A `null` result logs an error. `ACLUtils.checkRequestPerms()` already denies when no ACL is found.
   - A save error at class or method level (e.g. a transient `acl` datastore failure) is logged and rethrown, so the
     route is never registered. Before, only the class-level save was wrapped.
   - `test/routes/RouteACLFailClosed.test.ts` runs this against real Mongo: register, `removeACL()`, re-register, then
     an anonymous request gets 403 and the handler never runs. It also covers a forced `null` and a startup error.
2. **[MEDIUM] `@RateLimit` keyed on the raw path.** The identifier is now `<method>|<path>` where the path comes from
   `RouteUtils.getRateLimitPath()`. It uses F2's new `req.routePattern` with each `:param` replaced by the decoded
   `req.params` value, re-encoded. A pattern containing `*`, or no pattern, falls back to `normalizeRateLimitPath()`,
   which decodes and re-encodes each segment and drops empty ones. `%2F` inside a segment stays distinct from `/`.
3. **[LOW] Anonymous callers shared one `perUser` bucket.** With `perUser`, which `@RateLimit()` enables by default, an
   anonymous caller is keyed `ip:<client ip>|<method>|<path>` via `NetUtils.getClientIP(req, trusted_proxies)` (F2's
   API; RouteUtils now reads `trusted_proxies` too). If no IP is available it falls back to the shared route key.
   `@RateLimit({ ... })` without `perUser` is still global per route.
   - Consumer impact in `@rapidrest/auth`: `discovery()`/`jwks()` are now per client IP instead of one global bucket.
     Behind a proxy that isn't in `trusted_proxies`, that is still effectively global.
   - `impersonate()` was already per user for authenticated callers (`uid|…`), so the 2026-09-08 note calling it
     "deliberately global" was already inaccurate. It is unchanged.
4. **[LOW] WS auth ignored the route's `@Auth` strategies.**
   - `authWebSocket(required, strategies = ["jwt"])` now runs a `LOGIN` token through `authenticate(strategies, …)`
     instead of `JWTUtils.decodeTokenSync(authConfig, …)`. The token goes to the strategies on a copy of the upgrade
     request (`Object.create(req)`) with `Authorization: Bearer <token>` and empty `query`/`cookies`/`signedCookies`,
     so only the supplied token can authenticate.
   - It also first runs the strategies asynchronously against the upgrade request itself. That covers header
     credentials for async-only strategies. Listeners and the timer are attached before this, so an early `LOGIN`
     frame isn't missed.
   - Pre-upgrade `upgradeAuth` never rejects now. A throwing `authenticateSync()` can't be told apart from an
     async-only strategy (`OAuthBearerStrategy.authenticateSync` always throws), so it returns `{}`, and `authWebSocket`
     closes with 1002/AUTH_FAILED when auth is required.
   - Behaviour change: an invalid header token on a required-auth WS route is closed right after the upgrade
     (1002 + AUTH_FAILED) instead of getting HTTP 401 before it.
   - The optional-auth contract (2026-08-21) is kept. A malformed `LOGIN` token still closes with `api-003` when
     required, and proceeds silently when optional (`PushRoute.test.ts` checks the close reason). A token that verifies
     but has no uid still gets `LOGIN_RESPONSE success:false`.
   - `@Auth("name")` with a single string is now normalised to an array. Before, `authenticate()` iterated its characters.
5. **[LOW] Auth stopped at the first throwing strategy.** `authenticate()`/`authenticateSync()` try every strategy and
   rethrow the first error only when none succeeds, whether or not auth is required, so the HTTP `authMw` still 401s a
   required route and an optional route still goes anonymous. An unregistered strategy name still throws immediately.
6. **[LOW] Bulk create validation error.** `validateCreateBulk()` throws a `BulkError` (`BULK_CREATE_FAILURE`) with one
   entry per object: `null`, the validator's `ApiError`, or a generic `INVALID_REQUEST` `ApiError` for any non-`ApiError`
   (so driver internals don't leak and F2's BulkError sanitisation keeps them). A single, non-array POST rethrows its own
   (normalised) error instead of a bulk one. `validateUpdateBulk()` got the same per-object `BulkError` treatment.
7. **Not done:** F2's possible JWTStrategy session-field change for cookie-less bearer clients was left alone as
   instructed.

Tests: `test/routes/RouteACLFailClosed.test.ts` (new, real Mongo); new and updated cases in
`test/routes/RouteUtils.unit.test.ts`, `test/auth/AuthMiddleware.unit.test.ts` (LOGIN tests now register a real
`JWTStrategy` and await verification) and `test/routes/ModelRoute.unit.test.ts`; plus an HTTP bulk-create validation case in
`test/routes/ModelRoute.Mongo.test.ts`.

Verification, with F1/F2 still editing:
- The full `PORT=3777 yarn vitest run` had 9 failures, all outside this work: `CachedModelRoute.Mongo.test.ts` (6, F1's
  RepoUtils cache rework), `Server.unit.test.ts` (2, F2) and `RepoUtils.unit.test.ts` (1, F1). No coverage report is
  written when tests fail.
- With those 3 files excluded: 68 files / 1419 tests passed. The global gate was missed (96.36 / 91.33 / 97.5 / 96.59),
  driven by the in-progress `RepoUtils.ts`/`Server.ts`/`Router.ts`.
- This work's files: `RouteUtils.ts` 98.89 / 93.98 / 100 / 98.88 (the uncovered lines are pre-existing), `src/auth`
  100 / 93.22 / 100 / 100. `CRUDRoute.ts` is above every threshold.
- `tsc --noEmit` is clean. `yarn lint` is clean for these files; its only errors are in F1/F2's `NetUtils.test.ts` and
  `RepoUtils.CacheAndACL.test.ts`.
- A final full run is still needed once F1/F2 land.

### 2026-09-14 — Data layer and ACL fixes (fix agent F1)

Ran at the same time as F2 and F3 (entry above). Touched `RepoUtils.ts`, `ACLUtils.ts`, a new
`src/database/DatabaseErrors.ts`, and their tests (plus `test/routes/CachedModelRoute.Mongo.test.ts`, which asserted
the old cache key scheme). `MongoRepository.ts` and `ModelUtils.ts` needed no change. Every finding reproduced against
HEAD `6878bf8`: with HEAD's `RepoUtils.ts`/`ACLUtils.ts` swapped back in, 22 of the 23 tests in the new
`test/RepoUtils.CacheAndACL.test.ts` fail (the passing one is the `allowExistingACL` positive case).

1. **[CRITICAL] Record ACLs and class/route ACLs shared one uid namespace.** Kept one keyspace (a separate one would have
   changed every stored class/route ACL uid) and reserved uids instead:
   - `ACLUtils.isReservedUid(uid)`: any `default_*` uid, or a uid registered through `saveDefaultACL()` in this process
     (class, route and endpoint ACLs plus their `default_` twins, tracked in an in-memory set).
     `isProtectedACL(acl)` is also true when `acl.parentUid === "default_" + acl.uid`, which catches a default ACL
     registered by a route/model this process doesn't load.
   - `claimRecordACL()` refuses a reserved uid, or an existing protected ACL, with `IDENTIFIER_EXISTS`, even with
     `allowExistingACL` or a `count > 0` new version.
   - `delete()`/`truncate()` call `removeACL(uid, { unlessProtected: true })`/`removeACLs(uids, { unlessProtected: true })`.
     On Mongo the parent condition is part of the atomic `findOneAndDelete` filter. Purging one version of a trackChanges
     record (`version` given) leaves the ACL alone while other versions remain.
   - `saveDefaultACL()` contract (F3 relies on it): with RBAC enabled and an `acl` given it resolves to the user-editable
     ACL (uid `acl.uid`) or throws, never `null`. A missing user-editable ACL is recreated insert-only (`createOnly`),
     with no records, under `default_<uid>`. An existing one with a different parent only logs a warning (it may be a
     deliberate admin change). `null` only when RBAC is disabled or no ACL is given. Both lookups now skip the cache.
2. **[HIGH] Planted ACL reuse.** An existing ACL at a new record's uid is reused only for a trackChanges new version
   (`count > 0`) or with `allowExistingACL`. Removed both the trusted-role reuse and the "caller already holds every
   creator action" reuse. The latter was removed outright rather than narrowed: two models sharing one ACL means
   deleting either record removes the other's ACL.
3. **[HIGH] ACL route writes never reached ACLUtils.** `RepoUtils` recognises the ACL model (`AccessControlListMongo`/
   `SQL` or a subclass) and calls the new `ACLUtils.invalidateACLs(uids)` after create/update (so bulk and property
   updates too)/delete/truncate. `findACL()` only writes the cache after a database read, never on a hit, and ignores a
   cached entry whose `uid` isn't the one requested. Remaining gap: another instance's in-process copy lives until its
   local TTL (no cross-instance invalidation channel exists).
4. **[HIGH] `me` shared a cache key across users** and **15. [LOW] `$literal` forgery skipped on a warm cache.**
   `find()` now builds the search query before the cache lookup (so every 400/403 the builder raises also applies on a
   hit). The key is `q:` + md5 of `{ query: {...query, limit, page}, user }`, where `user` is the caller's uid whenever
   the serialized raw query contains a whole-word `me`. Not keyed on the built query: a `RegExp` serializes to `{}` and
   SQL `Raw()` parameter names change per build.
5. **[HIGH] Cache key collision between uid keys and query hash keys.** Separate namespaces: `rec:latest:<uid>`,
   `rec:v<version>:<uid>` and `q:<md5>`. A `findOne()` hit is used only if one of the model's id properties equals the
   requested id (and `version` matches); a list hit only if each record's uid/version match the stored reference.
6. **[MEDIUM] Cached objects mutated in place.** The cache gets a copy on create/update; `find()` strips shallow copies
   (same prototype); `findOne()` already stripped a new instance. For `update()` copying `@ReadOnly` fields from a
   stripped `existing`: a field that isn't an own property of `existing` is left out of the write (in-place update keeps
   the stored value); for trackChanges it is read from the stored record (`loadStoredRecord()`), since the new version
   is a whole document.
7. **[MEDIUM] Stale list cache.** A list is stored as `[uid, version|null]` references. Non-trackChanges records are
   referenced by `rec:latest:<uid>`, which `update()` refreshes and `delete()`/`truncate()` remove, so a cached list shows
   updates and drops deleted records. trackChanges records are referenced by immutable `rec:v<n>:<uid>`; `delete()`/
   `truncate()` first read every stored version (projection on uid/version, no aggregation) and remove those keys too. A
   new version doesn't appear in an already-cached trackChanges list until it expires (same as a newly created record
   in any cached list). A specific version of a non-trackChanges model is never cached (it's updated in place).
   `truncate()` previously didn't touch the cache at all.
8. **[MEDIUM] Push payloads carried the writer's scoped fields.** `publish()` sends a copy with *every*
   `@RequiresScope` property removed (`deleteScopedProps(copy, undefined, model)`), for create and update; delete and
   truncate payloads are unchanged (`{uid, version}`). Chosen over publishing only uid/version/action so existing
   consumers keep getting the unscoped fields; one that needs a scoped value must fetch the record.
9. **[HIGH] Unbounded record-ACL work in anonymous `DELETE /<model>` and `HEAD /<model>`.** This re-applies the accepted
   approach (c) from 2026-08-15/16 now that transactions exist: `count()` and `truncate()` on a `recordACL` model (when
   ACLs are checked, i.e. not `ignoreACL`) cap the uids at the built query's `take` (SQL: `findAllUids` sets `take`;
   Mongo: plain `distinct()` + `.slice()`). Mongo has no `take` on the built query, so the cap comes from
   `ModelUtils.resolvePagination(query).take`, the documented Mongo-side helper for the same rule (100 default, client
   `limit` up to 1000), rather than (c)'s hard-coded 100, so a client `limit` behaves the same on both backends.
   Behaviour change: such a count is at most one page, and such a truncate removes at most one page per request.
   **Superseded for count() (JP, same day):** a count must never be limited - its purpose is the true total of matching
   records - so only `truncate()` keeps the cap. `count()` on a recordACL model now uses `countPermittedUids()`: Mongo
   streams uids from a `find()` cursor projected to `uid` (no `distinct`, so no 16MB reply limit), SQL selects the uid
   column, and permissions are checked in batches of 100 as uids arrive, so memory stays bounded (trackChanges models
   keep a seen-uid set to skip duplicate versions). The ACL work is still proportional to the matching set; do not
   re-add a page cap to count().
10. **[MEDIUM] SQL `date` columns a day off** (see the correction in agent A's item 6). SQL `@Column({ type: "date" })`
    values must be `YYYY-MM-DD` strings (valid calendar dates) and are kept as strings. On Mongo they still become UTC
    midnight. `timestamp`/`timestamptz`/`datetime` are unaffected: TypeORM round-trips a `Date` consistently there (UTC
    for SQLite; local-time for Postgres `timestamp without time zone`/MySQL, which reads back identically on the same
    server TZ).
11. **[LOW] Ambiguous date inputs.** Accepted: ISO 8601 date or date-time (`T` or space; zone `Z`/`±HH`/`±HHmm`/`±HH:mm`;
    no zone = UTC), with impossible calendar/clock values rejected; finite epoch-ms numbers in years 1–9999 with
    magnitude ≥ `1e11` (smaller is ambiguous with epoch seconds; use ISO for 1966–1973); `Date`/`null`/`undefined` as is.
    Everything else, including numeric strings and non-string/number values, is 400. Date columns are cached per class.
12. **[LOW] Duplicate keys.** `src/database/DatabaseErrors.ts`: `isDuplicateKeyError()` (Mongo 11000/11001, Postgres
    23505, MySQL `ER_DUP_ENTRY`/1062, SQLite `SQLITE_CONSTRAINT_UNIQUE`/`_PRIMARYKEY` or a generic `SQLITE_CONSTRAINT`
    "UNIQUE constraint failed", also via TypeORM's `driverError`), `duplicateKeyFields()`, `isIdentityDuplicate()`.
    create: 400 `IDENTIFIER_EXISTS`. update (every branch, both backends): 409 when the clash is on `_id`/`id`/`uid`/
    `version`/primary key, 400 `IDENTIFIER_EXISTS` for any other unique column; when the driver doesn't name the
    fields, 409 for a trackChanges version insert and 400 otherwise. Not exported from the package index (F2's file).
13. **[LOW] SQL `create()` used `save()`.** Now `repo.insert()`. Behaviour change for SQL consumers: TypeORM cascades on
    relations don't run on create (listeners still do).
14. **[LOW] count leaked soft-deleted rows.** Decided from the built query (`queryIncludesDeleted()`): excluded only when
    every OR branch pins `deleted` to exactly `false` (`false`, `Equal(false)`, an `And` containing it, `{$eq:false}`,
    or a Mongo `$or`/`$and` that does). Without DELETE+UPDATE on a non-recordACL model the query is rebuilt with a
    top-level `deleted: false`, which ANDs with any `$or` branch on both backends. On a recordACL model the restore bar
    is applied per matched record (conservative: can undercount live records for a caller without DELETE+UPDATE when
    the filter allows both).
16. **[LOW, perf]** `findACL()` gained `skipParents`; `claimRecordACL()` uses `{ skipCache, skipParents }`. Date columns
    are cached per class (above).

Also assessed: create/update don't enforce column types (`quantity: "abc"` is stored). Not fixed: coercing or
rejecting by `design:type` would change what every downstream consumer can currently store (numeric strings, union
types that reflect as `Object`), and it belongs with validation (`ObjectUtils.validate`/`@Validator`) rather than in
`RepoUtils`. Worth a separate, opt-in decision.

Downstream (restapi/rapidmx):
- `allowExistingACL` is now the *only* way to create a record at a uid that already has an ACL (besides a trackChanges
  new version), and it never works for a reserved/protected uid. A trusted role no longer suffices.
- Cache keys changed (`rec:`/`q:`), so existing Redis entries are simply never read again and expire.
- Push payloads for create/update no longer contain any `@RequiresScope` field, even when the writer could see it.
- `truncate()` on recordACL models is capped at one page per request. `count()` is never capped (see item 9).
- Dates: numeric strings, epoch seconds and SQL date-only values other than `YYYY-MM-DD` are now 400.

Tests: new `test/RepoUtils.CacheAndACL.test.ts` (real Mongo on 9999 + in-memory SQLite, 23 tests); new
`test/database/DatabaseErrors.unit.test.ts`; new sections in `test/RepoUtils.unit.test.ts` and
`test/security/ACLUtils.unit.test.ts`; updated `test/RepoUtils.WriteSafety.test.ts` (owner/trusted reuse now refused)
and `test/routes/CachedModelRoute.Mongo.test.ts` (key scheme). SQLite can't run two transactions on one connection, so
the SQL create race is reproduced by stubbing the existence check rather than with real concurrency.

Verification: one full `PORT=3777 yarn vitest run` (with F2/F3's changes in the tree): 73 files / 1601 tests passed,
coverage 98.29 / 94.44 / 99.64 / 98.4 (gate met). `RepoUtils.ts` 94.93 / 91.97 / 100 / 94.79, `ACLUtils.ts`
98.8 / 96.37 / 100 / 98.78. `yarn lint` and `npx tsc --noEmit` clean. Nothing committed.

### 2026-09-14 — Server, HTTP and infrastructure fixes (fix agent F2)

Ran at the same time as F1 and F3 (entries above). Touched `Server.ts`, `NetUtils.ts`, `src/http/**`,
`MongoSchemaSync.ts`, `ConnectionManager.ts`, `ObjectFactory.ts`, `EventListenerManager.ts`,
`BackgroundServiceManager.ts`, `BasePushRoute.ts` and their tests. All 15 findings were re-checked against HEAD `6878bf8`
and reproduced; none were skipped.

1. **[HIGH] Prometheus label cardinality.** Both routers set `req.routePattern` (the registered pattern, e.g.
   `/items/:id`) before any middleware runs. It is `undefined` for the routers' own not-found and `/*` CORS-preflight
   fallbacks. An app-defined literal `/*` route keeps `/*`. `request_path`, `request_status` and
   `request_time_milliseconds` use `req.routePattern ?? UNMATCHED_ROUTE_LABEL` (`"<unmatched>"`, exported from
   `Server.ts`). The error and metrics middleware moved into `Server.handleError()`/`recordRequestMetrics()` so they are
   unit-testable. Consumers with dashboards keyed on concrete paths will see pattern labels instead. F3's `@RateLimit`
   keying uses `req.routePattern` too.
2. **[HIGH] Redis `error` events crashed the process.** New `attachRedisErrorHandler(client, logger, name)` in
   `ConnectionManager.ts` adds `error`/`reconnecting`/`ready` listeners. The first error of an outage is logged as an
   error, repeats as debug, and it logs once the client is `ready` again. Calling it twice is a no-op, and a value without
   `on()` is ignored. node-redis' default reconnect strategy (backoff, retries forever, resubscribes) is kept. It is applied
   to ConnectionManager's clients, every `@Redis`/`@DataSource` `duplicate()` in ObjectFactory, EventListenerManager's
   duplicate, and BasePushRoute's publisher and per-socket clients. **Not covered (not F2's file):**
   `BaseAdminRoute.ts` creates three redis clients (lines ~122/124/137/197) with no error listener.
3. **[MEDIUM] Forwarding headers.** `X-Original-Forwarded-For` is no longer read at all. See the NetUtils contract below.
4. **[MEDIUM] `trusted_proxies` never matched uWS addresses.** Both sides are normalized, and entries can be CIDR ranges
   (`net.BlockList`, cached per list). The uWS router also normalizes `req.socket.remoteAddress`, so audit logs get
   `127.0.0.1` instead of `0000:…:ffff:7f00:0001`.
5. **[MEDIUM] MongoSchemaSync.** `synchronize()` merges into `collections.get(name) ?? info`. The first class that declares
   collection options (collation) wins.
6. **[LOW/MEDIUM] BulkError leaks.** `Server.serializeError()`: an `ApiError` keeps its fields; anything else becomes
   `{ code: INTERNAL_ERROR, status: 500, message }`. It is used for single errors and for every BulkError item (null
   stays null). Raw items are still logged server-side. Stacks are never sent.
   Side finding, not changed: `logger.debug(err)`/`error(err)` (winston) stamps `level` onto the logged error object,
   so a 4xx `ApiError` body already carried `"level": "debug"` before this change.
7. **[LOW] Sessions for bearer-token clients.** `createSessionMiddleware()`:
   - A valid cookie with a stored session behaves as before: `req.sessionIsNew = false`, saved on finish when non-empty.
   - Otherwise `req.session` is an empty object behind a Proxy and `req.sessionIsNew = true`. No cookie or store write
     happens until a handler writes to it (set, defineProperty, delete, or assigning `req.session`). The first write
     appends `Set-Cookie` with a freshly generated id, and the data is saved on finish.
   - A stale or tampered cookie is never reused (no fixation). A first write after the headers were sent isn't saved.
   - `HttpRequest.sessionIsNew` was added. **Required F3 change, still open:** `JWTStrategy.authenticate()` and
     `authenticateSync()` must skip their bookkeeping for new sessions: `if (req.session && !req.sessionIsNew)`
     (JWTStrategy.ts ~192 and ~228). Until then, each authenticated cookie-less request still creates a session through
     those writes. Also suggested there: `NetUtils.getClientIP(req, trusted_proxies)` for `session.ip`.
8. **[LOW] uWS `send()` result.** The callback gets an error only for status 2 (dropped). Status 0 (queued under
   backpressure) is not an error.
9. **[LOW] Binary WS use-after-free.** `Buffer.from(message.slice(0))`. The test detaches the ArrayBuffer with
   `structuredClone(…, { transfer })` to prove the copy.
10. **[LOW] Bun ignored WS options.**
    - `DEFAULT_WS_OPTIONS` in `http/types.ts` (exported) holds the uWS defaults: 16 KiB payload, 120 s idle and 64 KiB
      backpressure. uWS applies them explicitly under the route's options.
    - Bun has one server-wide WebSocket config. `maxPayloadLength` is also enforced per route in `message` (close
      1009). `idleTimeout` and `backpressureLimit` use the largest value any route registered, and `0` idle wins.
    - `RouteUtils` still passes no options, so both runtimes now get the uWS defaults. This is a behaviour change for
      Bun: 16 KiB instead of 16 MiB.
11. **[LOW] Query-string prototype.** `parseQueryString()` (shared by Bun) still returns a plain object, so spread and
    `hasOwnProperty` still work. It checks repeats with `Object.prototype.hasOwnProperty.call` and drops `__proto__`
    keys, which `parseCookies()` now drops too. `?constructor=x`/`?toString=…` are ordinary own values.
12. **[LOW] Invalid cron.**
    - The schedule is validated before `start()` with a probe `new schedule.Job(name).schedule(spec)` and `cancel()`.
    - A `null` job or any later failure cancels the job, calls `stop()` on a started service, and drops it from
      `services`.
    - Behaviour change: a one-time service whose `run()` throws now gets `stop()` called.
13. **[LOW] Graceful shutdown.**
    - `IHttpRouter.shutdown?(timeoutMs)` is optional. It stops accepting, waits for in-flight HTTP requests (counted
      per router, `inFlightRequests`), then force-closes the rest: `uwsApp.close()` on uWS, `stop(true)` on Bun, which
      is `stop(false)` first.
    - `Server.stop()` order: services, then `app.shutdown(shutdown:drain_timeout)` (default 10000 ms, or `close()` for a
      router without it), then `objectFactory.destroy(eventListenerManager)` (removed from the factory so `restart()`
      builds a new one), then `connectionManager.disconnect()`. It is still under the 30 s watchdog.
    - `EventListenerManager.destroy()` is idempotent and now closes its duplicate (`destroy()`, else `disconnect()`).
    - Open WebSockets are closed by `stop()` now.
14. **[MEDIUM] Push connect leak.**
    - `connect()` registers `close` before any await. Cleanup is one idempotent function, run under the per-user lock.
      A close during setup queues behind it and releases the redis client and the `activeSocks` slot.
    - A socket already closed when `connect()` runs creates no client. One that closed during setup with no close event
      is cleaned inline (`readyState >= 2`).
    - A redis `connect()` failure now closes the socket with 1011 instead of rejecting.
    - Unsubscribe/disconnect errors in cleanup are logged at debug.
    - Rejected over-limit sockets don't touch the user's state.
15. **[INFO] CORS** allow-methods now include `PATCH` (routers do register PATCH).

**NetUtils client-IP contract** (consumed by F3's rate limiting):
- `NetUtils.getClientIP(req, trustedProxies?)` returns the canonical client address.
  - If `req.socket.remoteAddress` isn't an IP, it is returned verbatim (or `undefined` if empty) and headers are ignored.
  - If the remote isn't a trusted proxy (or the list is empty), the normalized remote is returned.
  - Otherwise `X-Forwarded-For` (all header values joined) is walked right to left. Trusted hops are skipped and the
    first untrusted valid address is returned. An invalid entry stops the walk and returns the last trusted hop. If
    every hop is trusted, the left-most one is returned.
  - With no XFF, the last valid `X-Real-IP` entry is used, else the remote.
- `getIPAddress(req, …)` delegates to it, so all existing callers get the fix. Its string/URL overload is unchanged.
- `NetUtils.normalizeIP(value)`: strips a port, brackets and zone id; unmaps IPv4-mapped (either spelling); RFC 5952
  IPv6; `undefined` when invalid.
- `NetUtils.isTrustedProxy(addr, list)`: the list is an array or a comma-separated string of IPs/CIDRs; invalid entries
  are ignored.
- `TrustedProxies` type exported.
- Not done: IPv6 clients are keyed per /128. A per-/64 rate-limit key would be a separate decision.

Tests:
- New: `test/database/RedisErrorHandler.unit.test.ts` (a real node-redis client throws on an unhandled `error` and
  doesn't once attached) and `test/http/uWS/Router.shutdown.test.ts` (real uWS on port 37931: a drained in-flight
  request, a closed WebSocket, refused new connections).
- Extended: `NetUtils.test.ts`, `Server.unit.test.ts` (250 random unmatched paths give 1 series; BulkError with a
  QueryFailedError-like item; stop order), `Server.test.ts` (end-to-end labels), `uWS/Router.test.ts`,
  `bun/BunRouter.test.ts`, `uWS/Adapters.test.ts`, `uWS/WebSocket.test.ts`, `session/sessionMiddleware.test.ts`
  (rewritten for lazy sessions), `MongoSchemaSync.unit.test.ts`, `ObjectFactory.test.ts`,
  `EventListenerManager.test.ts`, `BackgroundServiceManager.test.ts` (mocks `node-schedule` with a pass-through;
  namespace spying fails for this CJS module) and `routes/BasePushRoute.unit.test.ts`.
- Tooling note: heredocs containing an apostrophe fail in this environment's Bash tool, so put scripted edits in a file.

Verification: final full `PORT=3777 yarn vitest run` (F1/F3 changes in the tree): 73 files / 1601 tests passed,
coverage 98.31 / 94.44 / 99.76 / 98.4 (gate met). `yarn lint` and `npx tsc --noEmit` clean. Nothing committed.

### 2026-09-15 — SQL connections reused a cached DataSource built for other entities

Found in `rapidmx/server`: its plugin host connected the `sql` datastore name with only its Plugin model before the
server's own connect, and `TypeOrmSupport.connect()` then handed the server that same DataSource (the module-level
`dataSources` map is keyed by name only). Every other model failed with "No metadata", and `synchronize` created only
the plugin table, on SQLite and Postgres alike. `ConnectionManager.disconnect()` destroyed DataSources without removing
them from the map, so connecting again later re-initialized the stale one with its old entities too.

- `connect()` reuses a cached DataSource only while it's initialized and its `options.url` and entity classes (as a
  set) match the call; otherwise it creates a new one and replaces the map entry. The earlier DataSource isn't
  destroyed there, since another ConnectionManager may still own it.
- New `release(name, dataSource)` deletes the entry only if it's that DataSource; `disconnect()` calls it after
  destroying each SQL connection.
- Still true: two ConnectionManagers connecting the same name with the same entities share one DataSource, and either
  one's `disconnect()` destroys it for both. Not changed.
- Tests: `test/database/TypeOrmSupport.connect.test.ts` (real better-sqlite3 files). 5 of its 6 tests fail on the old
  code with a no-op `release` stub.
