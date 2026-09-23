# Spike: `pairwise_wins()` scale benchmark (2026-09)

Disposable-environment benchmark of the recompute pipeline to find where it
buckles under community growth, and (next) to measure what incremental pair
maintenance / dirty tracking buys. Companion to [`docs/architecture/SCALE.md`](../../../architecture/SCALE.md)
(analysis) — this is the measurement. Results live in
[`RESULTS.md`](RESULTS.md).

## Environment

A throwaway Supabase project (`jsvgzvkrgodaxdutqcok`, "TestRide", Oregon —
same region as prod), stood up 2026-09-12:

1. **Restore**: newest nightly dump (`coasterrank-2026-09-12.sql.gz` from the
   CoasterRankBackups repo) applied in tolerant mode (`psql ON_ERROR_STOP=0`),
   errors triaged against the drill table in [`docs/operations/RUNBOOKS.md`](../../../operations/RUNBOOKS.md).
2. **Migrations**: `supabase db push` converged the 2 post-dump migrations.
3. **Function**: `recompute-rankings` deployed; `APP_ENV=bench` secret set;
   **no Telegram tokens** (alerts/events no-op).
4. **No cron**: restored `cron.job` rows did not survive the restore (denied
   by the platform) — every recompute is manual, like the admin button.
5. **PostgREST max-rows = 1,000,000** (management API
   `PATCH /v1/projects/{ref}/postgrest`) — prod runs at 10,000, which is its
   own story: **prod's pair RPC is silently truncated to 10k rows today**
   (true P = 50,345 on 2026-09-13). See RESULTS.md.

Local config: `.env.bench` (gitignored) — `BENCH_*` vars only; the harness
(`scripts/src/bench/`) refuses to run against the prod ref.

## Method

`scripts/src/bench/` (npm run `bench -- …` from `scripts/`):

- **Seeding**: bench-eligible synthetic users (`bench_<point>_<n>@bench.coasterrank.dev`,
  meta `bench:true` — deliberately NOT testride's `synthetic` marker, which
  `pairwise_wins()` excludes). Exact list lengths per point. Ranking order
  reuses testride's shared-popularity model (latent quality + rider noise),
  so pair concentration matches prod's shape (P/R ≈ 0.62).
- **Points**: R-sweep (R = Σ n(n−1)/2): 50×50, 60×60, 80×80, 100×100,
  150×150, 200×200, 200×250 — the brief's corners (50×50, 100×100, 200×250)
  plus interpolation. R measured from the DB, not nominal.
- **Measurement**: K manual recomputes per point (5 small / 3 large, cold run
  discarded by p95), harvesting `cron_execution_logs` (duration, pairs,
  iterations, per-RPC ms/bytes) + `EXPLAIN (ANALYZE, BUFFERS)` of the
  production function per point (SQL-side decomposition).
- **Burst variant**: same seed inserted in one transaction, recompute fired
  immediately (no ANALYZE) — the mass-import case.
- **Stop rule**: 3 consecutive failed invokes ends a point.

## Findings (2026-09-13)

See [RESULTS.md](RESULTS.md) for numbers. Short version:

- Reliable through R ≈ 61k (7MB payload); failures begin R ≈ 106k (11.6MB);
  total cliff at R ≈ 253k.
- The wall is **edge-function memory** (HTTP 546 `WORKER_RESOURCE_LIMIT`), not
  the ~7s gateway timeout — the function loads the whole pair payload as JSON.
  At R ≥ ~1.7M the platform statement timeout kills the SQL instead.
- Bulk-import bursts add nothing at survivable scales (cold stats don't bite
  at 50×50).
- Prod TODAY (R ≈ 50k, 10 users) runs `pairwise_wins` at 4.5–12s with two
  gateway-504 errors on 2026-09-12, and its board is fitted on a 10k-row
  truncated prefix of its 50k pairs (max-rows cap). This spike's fixes target
  exactly that wall.

## Next step

~~Re-run the identical grid against the incremental pair maintenance / dirty
tracking prototype~~ **Done 2026-09-13** — both variants + the combined
shape measured (see RESULTS.md), plus a growth simulation (`bench churn`)
covering accumulation + dirty-set churn to 1,000 users. The epic-ready
implementation design (app-set dirty flags + reconciliation sweep, two-level
delta-maintained pair totals, batch temp tables, temp_buffers, vacuum
strategy) is spec'd in **[2026-09-incremental-ranking.md](../../../architecture/decisions/2026-09-incremental-ranking.md)** — that doc is the
direct input for the prod-implementation epic.

## Teardown

See the "Disposable benchmark projects" section in [`docs/operations/RUNBOOKS.md`](../../../operations/RUNBOOKS.md)
— delete or pause the project; keep the repo artifacts.
