-- Pair maintenance + in-DB Bradley-Terry fit (promotion spec:
-- docs/spikes/2026-09-pairwise-bench/PROMOTION.md §3-§4). The SQL is a port
-- of the MEASURED bench shapes (scripts/src/bench/sql/: a-dirty for
-- maintenance, b-plpgsql for the fit, ab-combined for the union), with the
-- spec's two production corrections: batches claimed via processing_until
-- instead of trigger-maintained state, and delta-maintained global totals
-- (pair_totals) so no O(R) scan re-runs per slot.
--
-- Called only by the recompute-rankings Edge Function (service_role) and the
-- hourly sweep cron. All functions are security definer (tables are
-- deny-all under RLS) with pinned search_path.
--
-- Concurrency model (PROMOTION §3): there is exactly ONE logical writer to
-- the pair tables — maintenance batches, claimed FOR UPDATE SKIP LOCKED so
-- two concurrent runs (cron slot + manual trigger) process disjoint user
-- sets; delta upserts are ordered by (winner, loser). The fit's scratch
-- tables are rebuilt per run — interleaved runs at worst refit slightly
-- stale totals (benign; board upserts are idempotent, last writer wins).

-- ── 1. Maintenance: process a bounded batch of dirty users ─────────────
-- One call = one transaction = atomic: claim → deltas → slice swap → flag
-- clear. A crash anywhere re-queues the claimed users (idempotent).
-- Bounded so no statement nears the platform's ~8s timeout (the measured
-- dirty-axis wall: ~200 dirty users in one call breaks — RESULTS.md);
-- the Edge Function loops this adaptively until the queue is empty.
create or replace function public.pair_maintain_step(p_batch integer default 25)
returns table (processed integer, remaining bigint, oldest_marked_at timestamptz)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_claimed integer := 0;
begin
  -- Batch temp tables stay in RAM (free-tier disks are where temp spills
  -- hurt); session-local, reverted at transaction end (PROMOTION §3 [review]).
  set local temp_buffers = '16MB';

  create temp table _claimed on commit drop as
    select user_id
    from public.pair_dirty_users
    where processing_until is null or processing_until < now()
    order by marked_at
    limit coalesce(greatest(p_batch, 1), 25)
    for update skip locked;

  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return query select 0::integer,
                        (select count(*) from public.pair_dirty_users),
                        (select min(marked_at) from public.pair_dirty_users);
    return;
  end if;

  update public.pair_dirty_users
  set processing_until = now() + interval '4 minutes'
  where user_id in (select user_id from _claimed);

  -- NEW contribution: the exact production weight rule (γ = 0.5, c = 28 —
  -- matches pairwise_wins()) over the claimed users' current ranked rides.
  -- Eligibility is re-checked so a user who aged out of the eligible set
  -- (admin flip, synthetic marker) drops out of the totals on this pass.
  create temp table _new_pairs on commit drop as
    with rides as (
      select ur.user_id, ur.coaster_id, ur.rank,
             count(*) over (partition by ur.user_id) as n
      from public.user_rides ur
      join _claimed c on c.user_id = ur.user_id
      join public.bt_eligible_users() e on e.id = ur.user_id
      where ur.rank is not null
    )
    select a.user_id,
           a.coaster_id as winner,
           b.coaster_id as loser,
           power(
             (a.n::double precision * (a.n - 1) / 2) + 28::double precision,
             -0.5
           ) as weight
    from rides a
    join rides b
      on a.user_id = b.user_id
     and a.coaster_id <> b.coaster_id
     and a.rank < b.rank;

  -- OLD contribution: what these users currently feed the totals.
  create temp table _old_pairs on commit drop as
    select user_id, winner, loser, weight
    from public.user_pairs
    where user_id in (select user_id from _claimed);

  -- Signed deltas over the union of old/new pairs, written in deterministic
  -- (winner, loser) order.
  create temp table _deltas on commit drop as
    select winner, loser, sum(dw) as dw, sum(dk) as dk
    from (
      select winner, loser, -weight as dw, -1::bigint as dk from _old_pairs
      union all
      select winner, loser, weight, 1::bigint as dk from _new_pairs
    ) x
    group by winner, loser
    order by winner, loser;

  insert into public.pair_totals (winner, loser, weight_sum, wins)
    select winner, loser, dw, dk from _deltas
  on conflict (winner, loser) do update
    set weight_sum = public.pair_totals.weight_sum + excluded.weight_sum,
        wins = public.pair_totals.wins + excluded.wins;

  -- Pairs whose contributors all went away (wins is exact integer arithmetic;
  -- any float residue in weight_sum dies with the row).
  delete from public.pair_totals where wins <= 0;

  -- Swap the users' slices.
  delete from public.user_pairs where user_id in (select user_id from _claimed);
  insert into public.user_pairs (user_id, winner, loser, weight)
    select user_id, winner, loser, weight from _new_pairs
    order by user_id, winner, loser;

  -- Sweep bookkeeping: stamp maintenance BEFORE clearing the flag, so a
  -- crash between them leaves a re-markable state (never a silent skip).
  -- The eligibility signature lets the sweep heal admin/synthetic flips.
  insert into public.pair_user_state (user_id, last_maintained_at, eligible)
    select c.user_id, now(),
           exists (select 1 from public.bt_eligible_users() e where e.id = c.user_id)
    from _claimed c
  on conflict (user_id) do update
    set last_maintained_at = excluded.last_maintained_at,
        eligible = excluded.eligible;

  delete from public.pair_dirty_users where user_id in (select user_id from _claimed);

  return query select v_claimed,
                      (select count(*) from public.pair_dirty_users),
                      (select min(marked_at) from public.pair_dirty_users);
end;
$$;

-- ── 2. Fit aggregation: pair_totals → sparse structures, warm start ────
-- The maintained totals ARE the fit's pair table (no O(R) re-aggregation —
-- that was the measured total-axis wall at R ≈ 475k). Only the O(P) opp
-- structure + per-coaster aggregates rebuild, warm-started from the
-- previous board so the steady state converges in 1-3 iterations.
create or replace function public.pair_fit_agg()
returns table (pairs bigint, contributors bigint)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  set local temp_buffers = '16MB';

  truncate public.pair_fit_opp;
  truncate public.pair_fit_scores;

  -- Sparse opponent structure: both directions carry the pair's weight —
  -- matches computeRankings()'s opponents map (packages/bt/src/mm.ts).
  insert into public.pair_fit_opp (a, b, n, wins)
    select winner, loser, weight_sum, wins from public.pair_totals
    union all
    select loser, winner, weight_sum, wins from public.pair_totals;

  -- Per-coaster aggregates; score warm-starts from the previous board
  -- (1.0 = average for coasters new to the board).
  insert into public.pair_fit_scores (coaster_id, score, w, comparisons, wins, new_score)
    select
      o.coaster_id,
      coalesce(prev.score, 1.0)::double precision,
      coalesce(w.w, 0)::double precision,
      o.raw,
      coalesce(w.raw_wins, 0)::bigint,
      null::double precision
    from (
      select a as coaster_id, sum(wins)::bigint as raw
      from public.pair_fit_opp
      group by a
    ) o
    left join (
      -- Winner-side only: w is this coaster's total weighted WINS (the MM
      -- numerator), not its comparisons.
      select winner, sum(weight_sum)::double precision as w, sum(wins)::bigint as raw_wins
      from public.pair_totals
      group by winner
    ) w on w.winner = o.coaster_id
    left join public.coaster_ratings prev on prev.coaster_id = o.coaster_id;

  update public.pair_fit_state set iterations = 0, converged = false, ready = true where id = 1;

  return query
    select (select count(*) from public.pair_totals),
           (select count(distinct user_id) from public.user_pairs);
end;
$$;

-- ── 3. MM iteration: up to p_max Hunter (2004) steps per call ───────────
-- Faithful port of packages/bt/src/mm.ts (a = 1 anchor, λ = 0.5 L2,
-- ε = 1e-8 max |Δ log score|, cap 500 iterations, 1e-12 floor) — the same
-- fixed point, measured at max |Δ log score| = 5.6e-9 against the TS
-- reference (`bench parity`). Resumable: each statement stays far under the
-- ~8s per-statement timeout; the Edge Function calls this repeatedly until
-- done, halving p_max on statement timeouts.
create or replace function public.pair_fit_step(p_max integer default 25)
returns table (done boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_delta double precision;
  v_done boolean := false;
  v_iter_in_call integer := 0;
begin
  if not exists (select 1 from public.pair_fit_scores) then
    update public.pair_fit_state set converged = true, ready = true where id = 1;
    return query select true;
  end if;

  loop
    -- Simultaneous (Jacobi) update: one new_score per coaster per iteration,
    -- computed from the previous iteration's scores.
    update public.pair_fit_scores s
    set new_score = t.new_score
    from (
      select
        s0.coaster_id,
        greatest(
          (s0.w + 0.5 + 0.5) /
            (0.5 + 1.0 / (s0.score + 1.0) + coalesce(o.opp, 0)),
          1e-12
        ) as new_score
      from public.pair_fit_scores s0
      left join (
        select b.a, sum(b.n / (o1.score + o2.score)) as opp
        from public.pair_fit_opp b
        join public.pair_fit_scores o1 on o1.coaster_id = b.a
        join public.pair_fit_scores o2 on o2.coaster_id = b.b
        group by b.a
      ) o on o.a = s0.coaster_id
    ) t
    where s.coaster_id = t.coaster_id;

    select max(abs(ln(s.new_score / s.score))) into v_delta from public.pair_fit_scores s;
    update public.pair_fit_scores set score = new_score, new_score = null where true;

    update public.pair_fit_state
    set iterations = iterations + 1,
        converged = (v_delta is null or v_delta < 1e-8)
    where id = 1;

    v_iter_in_call := v_iter_in_call + 1;
    select (converged or iterations >= 500) into v_done from public.pair_fit_state where id = 1;
    exit when v_done or v_iter_in_call >= coalesce(greatest(p_max, 1), 25);
  end loop;

  return query select v_done;
end;
$$;

-- ── 4. Fitted rows (board-size payload) ─────────────────────────────────
create or replace function public.pair_fit_rows()
returns table (
  coaster_id uuid,
  score double precision,
  comparisons bigint,
  wins bigint,
  iterations integer,
  converged boolean
)
language sql
volatile
security definer
set search_path = public
as $$
  select s.coaster_id, s.score, s.comparisons, s.wins, st.iterations, st.converged
  from public.pair_fit_scores s
  cross join public.pair_fit_state st
  where st.id = 1 and st.ready
  order by s.score desc;
$$;

-- ── 5. Reconciliation sweep (the self-healing backstop, PROMOTION §1) ───
-- Re-derives dirtiness from data the app cannot lie about. Three re-mark
-- cases: (a) never-maintained users, (b) maintained users whose ranked
-- rides changed after their last maintenance, (c) users whose eligibility
-- signature changed (admin / synthetic-marker flips must re-balance the
-- totals — ride timestamps alone would miss it). A missed flag self-heals
-- within the hour; a stuck queue is observable (pair_dirty_users count).
create or replace function public.pair_reconcile_sweep()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- (a)+(b)+(c-eligible): currently-eligible users with ranked rides.
  insert into public.pair_dirty_users (user_id)
  select r.user_id
  from (
    select ur.user_id,
           max(greatest(
             coalesce(ur.updated_at, '-infinity'::timestamptz),
             coalesce(ur.created_at, '-infinity'::timestamptz)
           )) as last_touch
    from public.user_rides ur
    join public.bt_eligible_users() e on e.id = ur.user_id
    where ur.rank is not null
    group by ur.user_id
  ) r
  left join public.pair_user_state s on s.user_id = r.user_id
  where s.user_id is null
     or coalesce(s.last_maintained_at, '-infinity'::timestamptz) < r.last_touch
     or coalesce(s.eligible, false) is distinct from true
  on conflict (user_id) do nothing;

  -- (c-ineligible): previously-maintained users who aged out of eligibility
  -- — re-mark so maintenance drops their contribution (their rides may even
  -- be gone entirely, so the rides-driven pass above cannot see them).
  insert into public.pair_dirty_users (user_id)
  select s.user_id
  from public.pair_user_state s
  where s.eligible
    and not exists (select 1 from public.bt_eligible_users() e where e.id = s.user_id)
  on conflict (user_id) do nothing;
end;
$$;

-- ── Grants (service_role pipeline + cron only) ──────────────────────────
revoke execute on function public.pair_maintain_step(integer) from public, anon, authenticated;
revoke execute on function public.pair_fit_agg() from public, anon, authenticated;
revoke execute on function public.pair_fit_step(integer) from public, anon, authenticated;
revoke execute on function public.pair_fit_rows() from public, anon, authenticated;
revoke execute on function public.pair_reconcile_sweep() from public, anon, authenticated;
grant execute on function public.pair_maintain_step(integer) to service_role;
grant execute on function public.pair_fit_agg() to service_role;
grant execute on function public.pair_fit_step(integer) to service_role;
grant execute on function public.pair_fit_rows() to service_role;
grant execute on function public.pair_reconcile_sweep() to service_role;

-- ── Schedules ───────────────────────────────────────────────────────────
-- Hourly sweep at :10 — clear of check-stale-recompute (:00) and the
-- recompute slot (*/15). Idempotent: rescheduling replaces any earlier job
-- of the same name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'pair-reconcile-sweep') then
    perform cron.unschedule('pair-reconcile-sweep');
  end if;
  perform cron.schedule(
    'pair-reconcile-sweep',
    '10 * * * *',
    $cron$ select public.pair_reconcile_sweep(); $cron$
  );
end;
$$;

-- ── 6. Dirty-queue watchdog ─────────────────────────────────────────────
-- Extend the hourly staleness check with queue health (PROMOTION §5.3's
-- "dirty-queue depth + oldest-entry age monitored"). Runs BEFORE the
-- staleness early-return: on an idle community every run logs 'skipped' and
-- returns early — exactly the situation where a stuck queue would otherwise
-- be invisible (a healthy board can still be silently ignoring ride edits).
-- Thresholds: depth > 1000 outgrows one run's maintain budget (40 calls ×
-- 25 users), so the queue is only shrinking across slots; oldest > 2h means
-- neither the 15-minute cron nor the hourly sweep drained it — the
-- "unrecognized data" scenario the reconciliation sweep exists to heal.
create or replace function public.check_stale_recompute()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row_count bigint;
  v_last_success timestamptz;
  v_queue_depth bigint;
  v_queue_oldest timestamptz;
  v_bot_token text;
  v_user_id text;
begin
  -- Dirty-queue watchdog.
  select count(*), min(marked_at)
  into v_queue_depth, v_queue_oldest
  from public.pair_dirty_users;

  if v_queue_depth > 1000
     or (v_queue_oldest is not null and v_queue_oldest < now() - interval '2 hours')
  then
    select decrypted_secret into v_bot_token
    from vault.decrypted_secrets
    where name = 'alerts_bot_token'
    limit 1;

    select decrypted_secret into v_user_id
    from vault.decrypted_secrets
    where name = 'telegram_user_id'
    limit 1;

    if v_bot_token is null or v_user_id is null then
      raise warning 'check_stale_recompute: Telegram vault secrets not set; skipping queue alert';
    else
      perform net.http_post(
        url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
          'chat_id', v_user_id,
          'text', '⚠️ Pair dirty queue STUCK — ' || v_queue_depth
            || ' user(s) waiting, oldest marked '
            || coalesce(to_char(v_queue_oldest, 'YYYY-MM-DD HH24:MI'), 'never')
            || ' UTC. Ride changes are not reaching the board; check recompute logs.'
        ),
        timeout_milliseconds := 10000
      );
    end if;
  end if;

  -- Bootstrap guard: if the table is empty, the system hasn't run yet.
  -- Don't fire a stale alert on first-ever startup.
  select count(*) into v_row_count from public.cron_execution_logs;
  if v_row_count = 0 then
    return;
  end if;

  -- When did the last successful (or idle-skipped) recompute finish?
  -- Skips mean "no user_rides change, board already fresh" — healthy.
  select created_at into v_last_success
  from public.cron_execution_logs
  where status in ('success', 'skipped')
  order by created_at desc
  limit 1;

  -- If it ran within the last hour, we're fine.
  if v_last_success is not null and v_last_success > now() - interval '1 hour' then
    return;
  end if;

  -- Stale — send Telegram alert.
  select decrypted_secret into v_bot_token
  from vault.decrypted_secrets
  where name = 'alerts_bot_token'
  limit 1;

  select decrypted_secret into v_user_id
  from vault.decrypted_secrets
  where name = 'telegram_user_id'
  limit 1;

  if v_bot_token is null or v_user_id is null then
    raise warning 'check_stale_recompute: Telegram vault secrets not set; skipping alert';
    return;
  end if;

  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'chat_id', v_user_id,
      'text', '⚠️ BT Recompute STALE — no successful run in the last hour'
    ),
    timeout_milliseconds := 10000
  );
end;
$$;
