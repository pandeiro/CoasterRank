-- BENCH-ONLY (staging project) — MEASURED PROTOTYPE.
-- NOTE: DB triggers maintaining pair permutations are deliberately SUPERSEDED for
-- production by app-set dirty flags + a reconciliation sweep (write amplification,
-- bloat, lock contention) — see docs/spikes/2026-09-pairwise-bench/PROMOTION.md §1.
-- This file exists to reproduce the measured variant, not as a promotion artifact. — combined variant: dirty-tracking pair
-- maintenance (a) + in-database MM fit (b). Applied ON TOP of
-- b-plpgsql-install.sql by the bench harness (variants.ts order):
--   1. b-plpgsql-install.sql  (fit tables, fit_step, fit_rows, no-op maintain)
--   2. a-dirty-install.sql    (bench.user_pairs + dirty triggers + maintain_pairs)
--   3. this file              (overrides: maintain hook runs maintain_pairs;
--                              agg reads bench.user_pairs — no rides self-join)
--
-- Steady-state recompute cost = O(dirty users × n²) maintenance
-- + O(R) scan/group of the materialized pair rows (no join, no window fns)
-- + warm-start MM (1–3 iterations × O(P) in-DB joins)
-- + board-size payload over the gateway. Nothing quadratic re-runs per slot.

-- Override 1: dirty maintenance IS the maintain hook now.
create or replace function public.bench_fit_maintain() returns void
language plpgsql
volatile
security definer
set search_path = public, bench
as $$
begin
  perform bench.maintain_pairs();
end;
$$;

-- Override 2: aggregate the MAINTAINED pair rows instead of re-joining
-- user_rides. Same outputs as the b variant's agg (fit_pairs / fit_opp /
-- fit_scores), sourced from bench.user_pairs.
create or replace function public.bench_fit_agg() returns void
language plpgsql
volatile
security definer
set search_path = public, bench
as $$
begin
  truncate bench.fit_pairs;
  truncate bench.fit_opp;
  truncate bench.fit_scores;

  insert into bench.fit_pairs (winner, loser, weight, wins)
    select up.winner, up.loser, sum(up.weight)::double precision, count(*)::bigint
    from bench.user_pairs up
    group by up.winner, up.loser;

  insert into bench.fit_opp (a, b, n, wins)
    select winner, loser, weight, wins from bench.fit_pairs
    union all
    select loser, winner, weight, wins from bench.fit_pairs;

  -- Warm start: previous board score where present, else 1.0.
  insert into bench.fit_scores (coaster_id, score, w, comparisons, wins, new_score)
    select
      o.coaster_id,
      coalesce(prev.score, 1.0)::double precision,
      coalesce(w.w, 0)::double precision,
      o.raw,
      coalesce(w.raw_wins, 0)::bigint,
      null::double precision
    from (
      select a as coaster_id, sum(wins)::bigint as raw
      from bench.fit_opp
      group by a
    ) o
    left join (
      select winner, sum(weight)::double precision as w, sum(wins)::bigint as raw_wins
      from bench.fit_pairs
      group by winner
    ) w on w.winner = o.coaster_id
    left join public.coaster_ratings prev on prev.coaster_id = o.coaster_id;

  update bench.fit_state set iterations = 0, converged = false, ready = true where id = 1;
end;
$$;
