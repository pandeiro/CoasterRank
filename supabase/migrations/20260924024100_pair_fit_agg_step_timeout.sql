-- Fit-stage statement budgets + slowness early warning (incident 2026-09-24).
--
-- pair_fit_agg rebuilds the whole fit scratch in ONE statement (TRUNCATE +
-- ~2x pair_totals inserts into pair_fit_opp + grouped aggregates). At ~173k
-- totals it needs 5-10s with run-to-run variance, but the PostgREST path
-- enforces ~8s per statement (Postgres 57014): identical data failed twice at
-- ~9.5s then passed at 5.8s on 2026-09-24, paging twice before a run got
-- lucky. pair_fit_step has the same shape per call (a full opp-table scan per
-- MM iteration, ~7.6s/call measured) and its adaptive p_max halving bottoms
-- out at 1 iteration/call — one expensive iteration past the budget fails the
-- run exactly like agg.
--
-- Same treatment as pair_maintain_step (migration 20260922191500):
-- function-scoped statement_timeout overrides the session/role default for
-- these functions' transactions only (pooler-safe; every other caller keeps
-- the platform default). 60s is ~6-10x the measured 5-10s need; the Edge
-- Function's fit-loop wall-clock budget (FIT_MS_BUDGET) is the backstop so a
-- pathological halving ladder against 60s statements degrades to one clean
-- throw + Telegram instead of eating the invocation.
--
-- MAINTENANCE NOTE: any future migration that rewrites pair_fit_agg or
-- pair_fit_step with CREATE OR REPLACE must re-specify the SET clause (or
-- re-run the ALTERs below) — otherwise the ~8s platform default applies
-- again and full-board rebuilds fail exactly as in the 2026-09-24 incident.
-- Verify after deploy:
--   select proname, proconfig from pg_proc
--   where proname in ('pair_fit_agg', 'pair_fit_step')
--     and pronamespace = 'public'::regnamespace;
-- (both rows must contain statement_timeout=60s).
alter function public.pair_fit_agg() set statement_timeout = '60s';

alter function public.pair_fit_step(integer) set statement_timeout = '60s';

-- ── Fit-slowness early warning ──────────────────────────────────────────
-- The 2026-09-24 page was preceded by two days of silent creep (agg_ms 4.6s
-- → 5.8s) with no alert — the failure alerts only fire after a run dies.
-- This extends the existing hourly watchdog with a lead-time check: when a
-- recent successful fit used over a third of the 60s function-level budget,
-- the board is still fresh (so this is a warning, ⚠️, not a page) but the
-- next boundary-variance event will take down 5-minute slots until one gets
-- lucky. Normal runs sit ~5s, so 20s is far above noise and far below the
-- kill threshold. If the function-level SET above ever changes, update the
-- threshold to match (a third of the new budget).
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
  v_agg_max bigint;
  v_step_call_max double precision;
  v_bot_token text;
  v_user_id text;
begin
  -- Dirty-queue watchdog (PROMOTION §5.3, runs before the staleness early
  -- return — on an idle community every run logs 'skipped' and returns
  -- early, exactly the situation where a stuck queue would otherwise be
  -- invisible). Thresholds: depth > 1000 outgrows one run's maintain budget
  -- (40 calls × 25 users); oldest > 2h means neither the 5-minute cron nor
  -- the hourly sweep drained it — the "unrecognized data" scenario the
  -- reconciliation sweep exists to heal.
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

  -- Fit-slowness early warning (incident 2026-09-24): the slowest successful
  -- fit in the last 24h vs a third of the 60s function-level statement
  -- budget. Skipped slots carry no fit block and pre-pipeline rows lack the
  -- keys, so both are excluded by construction. No success rows in window
  -- means nothing to trend — the staleness check below owns a dead pipeline.
  select max((rpc_stats->'fit'->>'agg_ms')::bigint),
         max(((rpc_stats->'fit'->>'step_ms')::double precision
              / nullif((rpc_stats->'fit'->>'step_calls')::integer, 0)))
  into v_agg_max, v_step_call_max
  from public.cron_execution_logs
  where status = 'success'
    and created_at > now() - interval '24 hours'
    and (rpc_stats->'fit'->>'agg_ms') is not null;

  if coalesce(v_agg_max, 0) > 20000 or coalesce(v_step_call_max, 0) > 20000 then
    select decrypted_secret into v_bot_token
    from vault.decrypted_secrets
    where name = 'alerts_bot_token'
    limit 1;

    select decrypted_secret into v_user_id
    from vault.decrypted_secrets
    where name = 'telegram_user_id'
    limit 1;

    if v_bot_token is null or v_user_id is null then
      raise warning 'check_stale_recompute: Telegram vault secrets not set; skipping slowness alert';
    else
      perform net.http_post(
        url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object(
          'chat_id', v_user_id,
          'text', '⚠️ BT fit slowing — slowest successful fit in the last 24h used agg '
            || coalesce(v_agg_max, 0) || 'ms / step-call '
            || coalesce(round(v_step_call_max)::bigint, 0)
            || 'ms (statement budget 60s). Board still fresh; investigate before it pages.'
        ),
        timeout_milliseconds := 10000
      );
    end if;
  end if;

  -- When did the last successful (or idle-skipped) recompute finish?
  -- Skips mean "no user_rides change, board already fresh" — healthy.
  select created_at into v_last_success
  from public.cron_execution_logs
  where status in ('success', 'skipped')
  order by created_at desc
  limit 1;

  -- If it ran within the last 30 minutes, we're fine (6 dead 5-min slots).
  if v_last_success is not null and v_last_success > now() - interval '30 minutes' then
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
      'text', '⚠️ BT Recompute STALE — no successful run in the last 30 minutes'
    ),
    timeout_milliseconds := 10000
  );
end;
$$;
