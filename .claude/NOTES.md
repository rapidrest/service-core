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

## Open / in-progress design threads

- **Transaction support (planned, not yet started as of 2026-08-16).** The project owner is
  going to implement DB transaction support throughout the library as the real fix for the
  concurrency issues below, instead of the in-process lock + rollback approach used in the
  2026-08-15/16 session. Anything touching `RepoUtils.create()`'s ACL-claim race or
  `count()`/`truncate()`'s per-record ACL enumeration should account for this direction — don't
  re-introduce the lock/rollback/manual-cap approach without checking whether transactions have
  superseded it.

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
