-- Stale-detection: alert if no successful recompute in the last hour.
-- Covers Edge Function unreachable, pg_cron failure, or repeated crashes.
-- Runs hourly; sends Telegram alert via pg_net if stale.
--
-- Also:
-- - Cleans up the timeout on recompute_rankings_cron (see below).
-- - Adds a daily TTL cleanup of cron_execution_logs (7-day retention).

-- recompute_rankings_cron: remove timeout_milliseconds. --------------------
-- Original migration (20260817:104-108) set timeout_milliseconds := 60000 to
-- avoid noisy errors in cron.run_details on slow runs. Removed here because
-- `perform` discards the HTTP response entirely, so pg_net's response timeout
-- is cosmetic — it only controls whether pg_net logs a warning in its internal
-- tables. The Edge Function's own cron_execution_logs is the source of truth
-- for execution status. pg_net's default 5s timeout is fine.
create or replace function public.recompute_rankings_cron()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'recompute_auth_secret'
  limit 1;

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'recompute_function_url'
  limit 1;

  if v_url is null or v_secret is null then
    raise warning 'recompute_rankings_cron: vault secrets recompute_function_url / recompute_auth_secret not set; skipping';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
end;
$$;

-- check_stale_recompute: hourly staleness check. --------------------------
-- If cron_execution_logs is empty (system just bootstrapped, no runs yet),
-- skip the alert — there's nothing to be stale *from*. Only alert when the
-- table has rows but none are recent successes.
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

  -- When did the last successful recompute finish?
  select created_at into v_last_success
  from public.cron_execution_logs
  where status = 'success'
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

revoke execute on function public.check_stale_recompute() from public, anon, authenticated;

-- cleanup_execution_logs: daily TTL sweep. ---------------------------------
-- Removes execution logs older than 7 days. Runs once daily at 03:00 UTC.
create or replace function public.cleanup_execution_logs()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.cron_execution_logs
  where created_at < now() - interval '7 days';
end;
$$;

revoke execute on function public.cleanup_execution_logs() from public, anon, authenticated;

-- Schedules ----------------------------------------------------------------
do $$
begin
  -- Hourly stale check
  if exists (select 1 from cron.job where jobname = 'check-stale-recompute') then
    perform cron.unschedule('check-stale-recompute');
  end if;
  perform cron.schedule(
    'check-stale-recompute',
    '0 * * * *',
    $cron$ select public.check_stale_recompute(); $cron$
  );

  -- Daily cleanup at 03:00 UTC
  if exists (select 1 from cron.job where jobname = 'cleanup-execution-logs') then
    perform cron.unschedule('cleanup-execution-logs');
  end if;
  perform cron.schedule(
    'cleanup-execution-logs',
    '0 3 * * *',
    $cron$ select public.cleanup_execution_logs(); $cron$
  );
end;
$$;
