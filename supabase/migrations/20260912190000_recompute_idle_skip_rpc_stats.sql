-- Recompute optimizations: idle-skip status + per-RPC instrumentation.
--
-- 1. cron_execution_logs.status gains 'skipped': pg_cron runs that no-op
--    because no user_rides change happened since the last success log as
--    'skipped' (not success) so public_board_meta().last_recomputed_at —
--    which keys rank-turnover detection — only moves on real recomputes.
-- 2. rpc_stats JSONB: per-RPC timing (ms) + payload size (bytes) + retries,
--    plus the idle-skip fingerprint (rides_max_ts, ranked_count). Coarse
--    instrumentation for SCALE §8 trend queries; flexible JSONB so future
--    fields need no further DDL.
-- 3. check_stale_recompute() treats 'skipped' as healthy: an idle community
--    produces only skips, which must not trip the no-success-in-1h alert.

alter table public.cron_execution_logs
  drop constraint cron_execution_logs_status_check;

alter table public.cron_execution_logs
  add constraint cron_execution_logs_status_check
  check (status in ('success', 'error', 'skipped'));

alter table public.cron_execution_logs
  add column rpc_stats jsonb;

-- Idle-skip fingerprint: one cheap aggregate roundtrip for the Edge Function.
-- Returns the newest change timestamp + ranked-ride count over exactly the
-- rows the recompute aggregates read (eligible users, ranked rides), so the
-- skip decision can never go stale in the wrong direction:
--   * inserts / re-ranks bump rides_max_ts (created_at default now();
--     updated_at fires on rank-change UPDATEs)
--   * deletes / un-ranks change ranked_count (DELETEs leave no timestamp)
-- Unranked-only touches (marking ridden) are excluded — they feed no RPC.
create or replace function public.recompute_idle_fingerprint()
returns table (rides_max_ts timestamptz, ranked_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  with eligible_users as (
    select u.id
    from auth.users u
    join public.profiles p on p.id = u.id
    where p.is_admin = false
      and coalesce(u.raw_user_meta_data->>'synthetic', 'false') <> 'true'
      and lower(coalesce(u.email, '')) not like '%@test.coasterrank.dev'
  )
  select
    max(
      greatest(
        coalesce(ur.updated_at, '-infinity'::timestamptz),
        coalesce(ur.created_at, '-infinity'::timestamptz)
      )
    ),
    count(*)
  from public.user_rides ur
  join eligible_users eu on eu.id = ur.user_id
  where ur.rank is not null;
$$;

revoke execute on function public.recompute_idle_fingerprint() from public, anon, authenticated;
grant execute on function public.recompute_idle_fingerprint() to service_role;

-- Stale watchdog: a recent skip proves the pipeline is alive and the board
-- is fresh, so it counts the same as a success for staleness purposes.
create or replace function public.check_stale_recompute()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row_count bigint;
  v_last_success timestamptz;
  v_bot_token text;
  v_user_id text;
begin
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
