# Promotion spec: incremental pair maintenance + in-DB fit

The epic-ready design for moving the recompute pipeline off the measured
memory wall (edge-function OOM at ~12MB pair payload, ~2× prod load) onto
dirty-tracking + in-database fitting. Evidence base:

- Measured results: [`RESULTS.md`](../../research/benchmarks/2026-09-pairwise/RESULTS.md) (variant grid + growth/churn
  simulation) and `docs/architecture/SCALE.md` §9.
- Prototype code: `scripts/src/bench/` (harness) + `scripts/src/bench/sql/`
  (bench-only variant installs) + `scripts/src/bench/edge-fork/` (staging
  fork of the Edge Function).
- External review verdicts (2026-09, "Assumption 2") folded in below — the
  review's two corrections are adopted and marked **[review]**.

## 0. Measured targets (what "works" means)

| metric               | baseline (today)                         | combined target                                 |
| -------------------- | ---------------------------------------- | ----------------------------------------------- |
| knee (p95 run > 5s)  | R ≈ 61k (~1.2× prod)                     | not reached through R ≈ 495k                    |
| hard failure         | R ≈ 106k (OOM, ~2× prod)                 | R ≈ 475k–660k (statement timeout, ~10–13× prod) |
| payload over gateway | 7.2MB @ 50 users, grows with P           | board-size (~0.1MB), flat                       |
| steady-state fit     | 80–90 iterations, cold, in JS            | 1–3 iterations, warm, in-DB                     |
| churn behavior       | full recompute of everything, every slot | O(dirty set) + O(P) warm fit                    |

## 1. Dirty flags are set by the APP — not DB triggers **[review]**

Triggers on `user_rides` maintaining pairwise permutations are a trap at
scale: O(n²) row-writes per list update, write amplification under bulk
imports, bloat, and row-lock contention. (The churn simulation measured the
shape of this pain directly: per-user delete+rewrite of pair rows degraded
later epochs — see RESULTS.md growth section — and the prototype's
trigger-based install is treated as a **measured lower bound**, superseded by
this design.)

**Design:** every application write path that inserts/updates/deletes
`user_rides` marks the user dirty **in the same transaction** as the ride
write:

```
BEGIN
  insert/update/delete user_rides …
  insert into pair_dirty_users(user_id) values (…) on conflict do nothing
COMMIT
```

Same-transaction = the two failure modes are symmetric:

- ride write fails → flag never set (nothing dirty, nothing owed) ✓
- ride write succeeds → flag is set atomically ✓

**The hazard the review flags — a failed/missed app write leaving new data
unrecognized — is real and is covered twice:**

1. The **reconciliation sweep** (below) re-derives dirtiness from data the
   app cannot lie about.
2. All ride writes already flow through a small number of paths (ranking UI,
   import apply, submission edits, admin edits) — the flag write lives in one
   shared helper (`lib`-side), not sprinkled per route. A new code path that
   forgets it is caught by the sweep within the hour.

### Reconciliation sweep (the self-healing backstop)

The pipeline already fingerprints eligible ranked activity
(`recompute_idle_fingerprint`: max `user_rides.updated_at` + ranked count).
The sweep piggybacks on it: an hourly cron (same cadence as
`check_stale_recompute`) compares, per user, `max(user_rides.updated_at)`
against `pair_dirty` bookkeeping (the user's last-maintained timestamp);
any user whose rides changed after their last maintenance is re-marked.
Result: missed flags self-heal within an hour, and a stuck flag queue is
_observable_ (queue depth is a table count).

## 2. Dirty state: a dedicated table, never locks on `user_rides` **[review]**

`pair_dirty_users(user_id uuid primary key, marked_at timestamptz)`.

- Insert/delete-only: no row-lock contention with ride writes; no table
  rewrite of hot rows during long batch maintenance.
- Durable across crashes/restarts (a half-processed queue re-processes —
  maintenance is idempotent, see §3).
- Batch processing: the recompute claims and processes dirty users in
  **bounded batches across separate RPC calls** (the measured
  statement-timeout wall: one call outgrew ~8s at ~200 dirty users —
  RESULTS.md, dirty axis). Same adaptive pattern the fit already uses
  (`fit_step`): repeat `maintain_step(batch)` until the queue is empty.
- Delete the flag only after the user's pair contribution is durably
  updated (below), so a crash mid-batch re-queues them.

## 3. Pair storage: two levels, maintained by delta, aggregated in batches

The naive shape — recompute the full `O(R)` CTE every slot — is what we are
leaving. The prototype validated the cost model; the promoted shape:

- **`user_pairs(user_id, winner, loser, weight)`** — one user's current
  pair contribution (per-user rows; the delta source). Rewritten per dirty
  user in **batch-aggregated statements** (set-based, not per-pair triggers):
  aggregate the user's ranked rides into a temp table, then swap their slice.
- **`pair_totals(winner, loser, weight_sum, wins)`** — the global aggregate
  the fit reads. Maintained **by delta**: for each processed dirty user,
  subtract their old contribution and add the new (a set-based upsert of
  deltas over the union of old/new pairs). The full `pair_totals` scan never
  happens for maintenance — only the fit's iterations touch it, in-DB.
- **Batch temp tables for the delta math** **[review]**: each recompute
  batches dirty users' old/new slices into temp tables and applies deltas in
  a few set-based statements — never row-by-row, never per-pair triggers.
- **`SET LOCAL temp_buffers = '16MB'`** **[review]** inside the
  maintenance/fit functions so the batch temp tables stay in RAM (free-tier
  disks are where temp-file spills hurt). Applied at function level, session-
  local, so no global setting changes.
- **Deadlocks**: with triggers gone there is exactly ONE writer to the pair
  tables (the recompute batch; cron + manual triggers already serialize
  through the function). Within a batch, delta upserts are ordered by
  `(winner, loser)`; the dirty queue is claim-marked (`processing_until`)
  rather than row-locked, so a long batch never blocks ride writes.
- **Vacuum/bloat is a first-class concern** (measured: later churn epochs
  degraded between vacuums). Pair tables are delete+rewrite-heavy:
  `fillfactor` tuned low, autovacuum per-table settings, and a periodic
  maintenance-window rewrite if bloat trends up (the health-check trends it).

## 4. The fit: in-DB, warm-started, resumable (validated)

- Aggregation + Hunter (2004) MM fit run inside Postgres
  (`bench_fit_*` shapes, measured): **payload over the gateway collapses to
  board-size (~0.1MB vs 7.2MB at 50 users)** — the memory wall disappears.
- **Warm-start** from the previous `coaster_ratings` scores: steady-state
  converges in 1–3 iterations (cold board rebuilds: 80–160 — budgeted via
  resumable `fit_step(max_iters)` calls, each statement inside the ~8s
  per-statement timeout; the fork in `scripts/src/bench/edge-fork/` shows the
  exact call pattern).
- **Parity gate**: the in-DB fit must equal the reference TS MM
  (`packages/bt/src/mm.ts`) before any prod promotion — `bench parity`
  measured max |Δ log score| = 5.6e-9; the epic keeps this as a CI-verifiable
  check on fixture data.
- Per-coaster-batch fit iterations (sharding) stay **out of scope** until
  observed R approaches ~1.2M (the measured iteration wall at ~8s); the
  resumable-step structure makes adding them incremental.

## 5. Rollout & verification

1. All DDL lands as normal migrations; the pair tables start EMPTY and
   backfill on the first recompute (the prototype's cold-fit path, measured).
2. **Shadow period**: run the in-DB fit alongside the JS fit (parity compare,
   log-only) before switching the read path. The `bench parity` pattern
   generalizes to a prod shadow-check.
3. Health-check guardrails (the "never again" set): aggregate responses
   drained page-by-page (shipped in #211); DB-truth pair count logged next to
   `pairs` and asserted by the health-check; dirty-queue depth + oldest-entry
   age monitored (the reconciliation sweep makes "unrecognized data"
   self-healing AND visible).
4. Staging first: the disposable-project runbook (RUNBOOKS) + this harness
   re-run the identical grid/churn against any candidate before prod.

## 6. Explicitly out of scope (for this epic)

- Pair sampling / list-length caps (SCALE §6.6) — revisit if R approaches
  the statement-timeout wall after the two-level totals land.
- pg_background / fully-in-DB cron fitting — the fit-step RPCs stay
  PostgREST-driven for now (observability for free via `cron_execution_logs`).
