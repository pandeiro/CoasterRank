# Spike: Postgres space runway on the free tier (500 MB)

**Date:** 2026-09-26
**Status:** measurement + proposal (no code changes)
**Question:** when do we run out of Postgres disk on the Supabase free tier,
and what is the cheapest space we can reclaim without losing the scalability
the incremental ranking pipeline bought us?

Companion docs: the pipeline design
(`docs/architecture/decisions/2026-09-incremental-ranking.md`) and the live
pipeline reference (`docs/architecture/RANKINGS.md`). This spike is the
storage counterpart to the time/memory benchmark in
`docs/research/benchmarks/2026-09-pairwise/`.

## Method

All numbers are read-only `psql` against prod (`SUPABASE_DB_URL`), 2026-09-26.
Re-run queries are in the appendix. Free-tier limit is taken as
500 MiB = 524,288,000 bytes against `pg_database_size()` (tables + indexes +
toast + system schemas).

## Observations

### 1. Current size: 154 MB used, 346 MB free

```
used_bytes | free_bytes | free
------------+------------+--------
 161541267 |  362746733 | 346 MB
```

Runway formula used throughout: `runway = 362.7M bytes / growth_bytes_per_day`.

### 2. Breakdown: the pair layer is 87% of the database

| table | total | rows | behavior |
|---|---|---|---|
| `user_pairs` | 71 MB (38 heap + 33 index) | 271,809 | grows per user, O(N²) in list length |
| `pair_totals` | 33 MB (19 heap + 14 index) | 179,104 | grows per novel global pair, saturating |
| `pair_fit_opp` | 26 MB | 358,208 | **rewritten every recompute** (2× mirror of `pair_totals`) |
| `pair_fit_scores` | 3.5 MB | 765 | one row per ranked coaster (the warm start) |
| `user_rides` | 1.6 MB | 3,749 | grows per user, O(N) |
| `cron_execution_logs` | 1.2 MB | ~300 rows/day | should be TTL-swept (see §6) |
| `coasters` (1,287 rows) + `parks` + `coaster_ratings` | ~1.7 MB | — | bounded catalog, negligible |

`user_pairs + pair_totals + pair_fit_opp + pair_fit_scores` = **134 MB of
154 MB**. The catalog, auth, and app tables are noise by comparison.

Bytes per row (heap + indexes, for the cost model):

| table | bytes/row |
|---|---|
| `user_pairs` | 273.1 |
| `pair_totals` | 194.8 |
| `pair_fit_opp` | 76.7 |
| `user_rides` | 443.6 |

### 3. Cost model: pairs dominate, and cost is quadratic per user

A user ranking N coasters contributes `P = N(N-1)/2` rows to `user_pairs`
plus N rows to `user_rides`. Globals (`pair_totals` + its `pair_fit_opp`
mirror) gain between 0 and P rows depending on how many of the user's pair
combos already exist. So one fully-ranked import costs:

- best case (total overlap): `P × 273.1 + N × 443.6`
- worst case (all novel): above + `P × (194.8 + 2 × 76.7)`

Measured distribution is extremely skewed: the mean is ~4,400 pairs/user
(~1.2 MB), the median new account is ~20–30 rides (~200–450 pairs,
~0.05–0.12 MB), and the largest single account (516 rides → 132,870 pairs)
occupies **~36 MB — ~10% of all remaining free space by itself**.

### 4. Runway under different growth patterns

| pattern | cost | time to fill 346 MB |
|---|---|---|
| Trickle, median-size accounts (~0.1 MB each) | ~0.1 MB/user | thousands of users; not the risk |
| Steady mixed growth (~1.2 MB/user mean) at 2 users/day | ~2.4 MB/day | **~150 days** |
| Spike: 4 accounts × 200 rides each | 21–48 MB per spike (6–14% of free) | ~7–16 such spikes |
| 200-ride power users, sustained | ~5.3 MB (overlap) – ~11.9 MB (novel) each | **~29–65 users** |
| 500-ride whales (~35–70 MB each) | ~10%+ of free per whale | **~5–10 whales** |
| Full pair-space saturation (1,287 coasters → ~1.65M ordered pairs) | ~322 MB totals + ~253 MB mirror ≈ 575 MB | **does not fit** — the wall hits at ~30–40% saturation |

Two conclusions: at current trickle we have months; the actual risk is
bulk-import behavior (many rides per user), because cost grows with the
square of list length. A single posting that brings 30+ power users with
200+ rides each — or a handful of 500-ride whales — is what ends the runway,
not the day-to-day signup count.

### 5. The trade we made

The incremental pipeline (`user_pairs` → `pair_totals` deltas, in-DB
warm-started MM fit, board-size payload) traded **space for time**: the
previous per-slot O(R) re-aggregation + O(P) pair payload over the gateway
used ~0 persistent pair bytes but OOM'd at ~2× prod load; the maintained
pair layer holds the steady-state recompute to seconds at 10–13× prod load
for ~134 MB of disk. Any space optimization must keep the two properties
that bought that headroom: **dirty-batched incremental maintenance** and
**the in-DB warm fit with board-size payload**. Reverting to full
re-aggregation or per-pair write triggers is out of scope for exactly the
reasons the promotion spec gives.

## Recommendation 1: make the fit scratch table UNLOGGED (easy, saves churn — not footprint)

`pair_fit_opp` is `TRUNCATE`d and rebuilt as a 2× mirror of `pair_totals` on
every recompute (`pair_fit_agg()` in
`supabase/migrations/20260913130000_pair_fit_functions.sql`). It is pure
working memory persisted to disk: 26 MB of the 134 MB pair footprint, plus
WAL and bloat churn from the every-5-minute truncate/insert cycle.

An earlier draft of this spike proposed a session-temp table
(`ON COMMIT DROP`). That is **incorrect, not merely risky** — verified
against the call path in `supabase/functions/recompute-rankings/index.ts`:
`pair_fit_agg()` runs as one `supabase.rpc()` call and each `pair_fit_step()`
iteration batch as further, separate `supabase.rpc()` calls (maintain loop,
agg, step loop, rows fetch are all distinct PostgREST requests). Each RPC is
its own transaction at minimum, so an `ON COMMIT DROP` temp created by the
agg call is gone before the first step call runs. Worse, the failure would
be silent rather than loud: the agg call truncates the persistent table
first, so after the temp vanishes the steps would read back the persistent
table — now empty (or stale) — and fit on it. Empty scores take the
`boardRows.length === 0` path, which deletes all `coaster_ratings` and logs
`success`; non-empty-but-wrong opponent data converges to a corrupt board,
also logged as success. The persistent truncated table exists precisely
because fit state must survive across RPC calls; only the temp tables
*inside* `pair_maintain_step()`/`pair_fit_agg()` are safe, because each is
created and consumed within a single call.

Corrected change: `ALTER TABLE public.pair_fit_opp SET UNLOGGED` (same for
`pair_fit_scores` if desired — it is 3.5 MB and carries the warm-start
scores, which are the reason the steady state converges in 1–3 iterations,
so it must stay persistent). UNLOGGED removes the WAL traffic from the
every-5-minute rebuild and the associated bloat pressure, at the cost of the
table not surviving a crash — acceptable for scratch that is rebuilt
unconditionally before every fit.

- Saves WAL/bloat churn, **not** the 26 MB footprint (UNLOGGED tables still
  count toward `pg_database_size()`).
- Correctness risk low but nonzero: crash between agg and steps now loses
  the scratch (next slot rebuilds it; the run itself would fail loudly on
  missing rows, not silently — unlike the temp variant).
- Verify with the existing `db-tests` pgTAP suite (migration preflight +
  pair suites in `supabase/tests/`) plus a manual before/after board
  comparison on a staging project, including a mid-fit restart if feasible.

## Recommendation 2: store one weight scalar per user, not one per pair (easy, ~3% of `user_pairs`)

The `weight` on every `user_pairs` row is a function of list length only
(`power((N(N-1)/2)+28, -0.5)` in `pair_maintain_step()`). Verified on prod:
every account, including the largest, has exactly **1 distinct weight** —
the same 8-byte float is stored 132,870 times for the biggest account.

Measured basis for the saving (prod, 271,809 rows): heap 39,698,432 bytes
(~146 B/row), PK index 34,480,128 bytes (~127 B/row), `pg_column_size`
confirms the float is exactly 8 bytes in an 80-byte tuple. Dropping the
column saves 8 heap bytes per row and nothing in the index (the PK is
`(user_id, winner, loser)`, weight is not in it): ~2.1 MB, i.e. **~3% of
the table's 71 MB total (~5.5% of heap)**. An earlier draft of this spike
said 5–10% of the table — that was heap-only math applied to the wrong
basis. Small in absolute terms; the argument for doing it is that the
column is pure redundancy and the win compounds as the table grows.

Change: store the scalar once per user (e.g. on `pair_user_state`) and join
it in during maintenance and fit aggregation; drop the column from
`user_pairs`. Narrower heap rows, unchanged PK, for identical fitted
scores — the values joined back are bit-for-bit the same inputs.

Two things checked before calling this safe:

1. **Savings basis** — corrected above: ~3% total, not 5–10%. Not a
   runway-mover on its own; do it as hygiene alongside other work, not as
   the headline fix.
2. **Delta-application complexity vs the statement budgets** — the concern
   is real enough to price. `pair_maintain_step()` runs under a 60s
   function-level `statement_timeout` (migration `20260922191500`; a single
   516-ride account needs ~21s for first-time ingestion of ~133k pairs,
   measured 2026-09-22), and the Edge Function loop adds a 60s
   `MAINTAIN_MS_BUDGET` across calls. With the scalar, `_old_pairs` needs a
   join to the per-user scalar store and `_new_pairs` needs the scalar
   joined in before the signed-delta `GROUP BY (winner, loser)` — but the
   join is against a ≤25-row per-batch scalar set (one row per claimed
   user), while the statement's cost is dominated by the O(N²) rides
   self-join and the `pair_totals` delta upsert, both unchanged, as is the
   `(winner, loser)` ordering that avoids deadlocks. Expected overhead:
   negligible. Still, "expected" is doing work in that sentence given the
   recent timeout history (fit side needed the same 60s treatment in
   migration `20260924024100` after the 2026-09-24 incident) — so this must
   be measured in the bench harness at the 500-ride shape before shipping,
   not assumed.

- Touches `pair_maintain_step()` (slice build + delta math) and
  `pair_fit_agg()` (winner-side aggregate); the MM iteration itself is
  untouched.
- Verify with the `db-tests` pgTAP suite plus the `pair_delta_deletion`
  characterization tests in `supabase/tests/pairs/`, which lock the
  delta-maintenance outcomes this refactor must preserve (per the
  postgres-testing decision, the refactor's design PR links the landed
  characterization tests it preserves).

## Out of scope for this spike (noted, not proposed)

- Compact O(N) per-user list storage instead of the O(N²) `user_pairs`
  expansion (biggest structural win; needs its own design PR).
- Unordered `pair_totals` (halves globals; touches the fit).
- Integer coaster keys for pair tables (invasive FK churn).
- Pair pruning / list-length caps (changes fitted scores; needs BT
  validation, not just storage equivalence).

## Appendix: re-run queries

```sql
-- total vs free
SELECT pg_size_pretty(pg_database_size(current_database())) AS used,
       pg_size_pretty(524288000 - pg_database_size(current_database())) AS free;

-- top tables
SELECT relname AS table_name,
       pg_size_pretty(pg_total_relation_size(schemaname||'.'||relname)) AS total,
       n_live_tup AS rows
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||relname) DESC
LIMIT 12;

-- bytes/row for the cost model
SELECT 'user_pairs' AS tbl,
  round(pg_total_relation_size('public.user_pairs')::numeric
    / NULLIF((SELECT count(*) FROM public.user_pairs),0),1) AS bytes_per_row
UNION ALL
SELECT 'pair_totals',
  round(pg_total_relation_size('public.pair_totals')::numeric
    / NULLIF((SELECT count(*) FROM public.pair_totals),0),1)
UNION ALL
SELECT 'pair_fit_opp',
  round(pg_total_relation_size('public.pair_fit_opp')::numeric
    / NULLIF((SELECT count(*) FROM public.pair_fit_opp),0),1);

-- weight uniformity check (expect 1 per user)
SELECT user_id, count(*) AS pairs, count(DISTINCT weight) AS distinct_weights
FROM public.user_pairs GROUP BY 1 ORDER BY pairs DESC LIMIT 5;

-- weekly trend input: snapshot these two counts weekly
SELECT (SELECT count(*) FROM public.user_pairs) AS user_pairs,
       (SELECT count(*) FROM public.pair_totals) AS pair_totals;
```
