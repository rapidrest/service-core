# service-core — Design Decisions & Session Notes

This file exists so that Claude sessions working in this repo don't re-litigate settled
decisions or re-discover the same issues from scratch. It is local to this repo (not tied to
any one machine's global Claude memory), so it travels with the code.

**Maintenance rule:** when a standing decision changes, update the section below in place
(don't just append a contradiction lower down). When a new investigation/session produces a
decision, finding, or reverted approach worth remembering, add a dated entry under Session Log.
Keep entries terse — this is a reference, not a transcript.

## Standing design decisions & constraints

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

- **Commit discipline.** Don't `git commit` unless explicitly asked, even after a full
  review-and-fix cycle with passing tests. Leave changes staged/unstaged and say so.

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
   argument injection. Not discovered until running the *full* test suite, not just the files
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
decoupled from the caller's. Consequence: an ACL write now commits independently and *can't* be
rolled back by the entity-side transaction aborting. Compensated via a new mechanism in
`DatabaseDecorators.ts`:
- `registerRollbackHook(fn)` — call from inside a `@Transactional`-wrapped method to register a
  best-effort compensating action.
- `TransactionContext.onRollback` — a fresh hook array per *real* transaction boundary (shared
  across merged/nested `@Transactional` calls via `TransactionalMode.MERGE`), run via
  `Promise.allSettled` in that boundary's `catch` before rethrowing.
- `RepoUtils.create()/delete()/truncate()` register compensating actions (delete a freshly-created
  ACL on rollback, or restore a removed one) using the ACL snapshot returned by `saveACL()`/
  `removeACL()`.

Other ACLUtils changes from the same effort:
- `removeACL()` does an atomic find-and-delete (new `MongoRepository.findOneAndDelete()`) instead
  of separate find+delete, so the returned document is a race-free snapshot to restore from.
- `saveACL()` gained `preserveVersion?: boolean` — a restore-from-snapshot write needs to write the
  snapshot's *own* version back, not recompute one (right after a delete there's nothing to diff
  against, so recomputing always forced version 0, silently discarding the real prior version).
  Also refuses rather than clobbers if something already exists at that uid by restore time.
- `saveACL()`/`findACL()` gained `skipCache?: boolean`, mirroring `RepoUtils`'s existing flag.
- `removeACL()`'s error handling narrowed to only swallow `"ns not found"`, not all errors.
- `removeACLs()`/`saveACLs()` batch methods run sequentially, not via concurrent `Promise.all` —
  each inner call merges onto the *same* transactional session/entityManager the batch method
  opened, and concurrent writes against one session are unsupported by the Mongo/SQL drivers.
  `filterPermittedUids()`'s existing concurrent-batch pattern is safe only because it does
  non-transactional *reads* — don't assume that pattern generalizes to writes on a shared session.
- `ACLUtilsOptions` interface removed entirely (was superseded by the above).

**`MongoRepository.save()` gained an opt-in `mergeByUid?: boolean`** (default `false`, behavior
otherwise unchanged) so `saveACL()` can match/replace by `uid` — the framework's true logical
primary key — instead of requiring `_id`, which may not have been preserved on a freshly
spread-constructed object. Implemented via `findOneAndReplace()` (not `replaceOne()`) so the
real `_id` is captured on both the insert and the update path in one round trip. **Do not** change
`save()`'s *default* matching behavior — a first attempt at this did, and broke real MongoDB
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
   outer transaction on a *different* connection (exactly the `acl`-is-a-separate-connection
   shape this whole redesign was for), the fallback silently ran the method body inside the
   *outer* connection's ambient session. Fixed: the fallback now checks whether the ambient
   context's datasource differs from the current call's own and, if so, re-scopes to a
   session-less context instead of leaking the foreign one through.
2. **[Correctness]** ACL rollback-restore silently reset the ACL's version to 0 — see
   `preserveVersion` above.
3. **[Medium]** Soft-deleted-record visibility (`?deleted=true`) required only ordinary
   READ/LIST/EXISTS/COUNT permission, not the DELETE+UPDATE actually needed to restore a record.
   Fixed across `findOne`/`exists`/`find`/`count` in `RepoUtils` via a new `canViewDeleted()`
   helper.
4. **[Real, cheaply client-triggerable]** Unbounded ACL-check amplification via WS `SUBSCRIBE` —
   `BasePushRoute`'s per-channel loop only stopped early once the subscription *budget* was
   exhausted by grants; a denial never consumed budget, so an authenticated client naming
   thousands of denied channel names in one frame forced that many sequential ACL/DB lookups.
   Fixed by bounding the channels *checked* (not just granted) to the remaining budget upfront
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
   can retry its *entire* callback on a transient conflict, so `RepoUtils.create()/delete()/
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
default-behavior break) were only caught by running the *full* suite including real Mongo/SQL
integration tests — a change that looks contained to one file (`ACLUtils.ts`, `RepoUtils.ts`) can
still need a full-suite run when it touches a shared decorator or a shared repository method.
