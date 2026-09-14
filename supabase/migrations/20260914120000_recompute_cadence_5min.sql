-- Recompute cadence 15 → 5 minutes (2026-09-14).
--
-- Enabled by the pair-promotion pipeline (#213): the per-run floor is now
-- ~4s (maintain 172ms + agg 1.9s + warm fit 218ms on the flipped in-DB path,
-- measured 2026-09-14 02:35 UTC) against the platform's ~8s per-statement
-- timeout and the function's total budget — a 5-minute slot has ~75×
-- headroom. Ranking edits and spreadsheet imports reach the board in ≤5 min
-- instead of ≤15; failure/staleness detection tightens with it.
--
-- Overlap on a pathological run (bulk-import backfill outlasting 5 min) is
-- safe by construction: maintain batches claim disjoint user sets (FOR
-- UPDATE SKIP LOCKED + processing_until), fits are idempotent warm starts,
-- and board upserts converge — worst case two shadow-style runs waste work,
-- observable as success rows spaced < 5 min with overlapping wall time.

-- ── Reschedule the recompute job ────────────────────────────────────────
-- Idempotent: rescheduling replaces any earlier job of the same name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'recompute-rankings') then
    perform cron.unschedule('recompute-rankings');
  end if;
  perform cron.schedule(
    'recompute-rankings',
    '*/5 * * * *',
    $cron$ select public.recompute_rankings_cron(); $cron$
  );
end;
$$;

-- ── Tighten the stale watchdog to match the cadence ─────────────────────
-- With 5-minute slots, "no healthy run in 30 minutes" means six consecutive
-- dead slots — at that point the pipeline IS down (the 1-hour window would
-- page twice as late; failure runs still page immediately via the function's
-- own alert, this watchdog is for silent death: cron stopped, gateway
-- black-holing, worker OOM before logging). Skipped slots still count as
-- healthy, and the dirty-queue watchdog above runs regardless of cadence.
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
