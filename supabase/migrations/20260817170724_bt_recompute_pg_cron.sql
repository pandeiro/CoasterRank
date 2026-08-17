-- Phase 6: Bradley-Terry recompute plumbing (PLAN §5.4).
--
-- 1. pairwise_wins() / ranked_participants(): aggregate ranked user_rides for
--    the Edge Function via PostgREST RPC. Per-user normalization (PLAN §5.1):
--    a user with n ranked coasters contributes n*(n-1)/2 pairs at weight
--    1/(n*(n-1)/2) each, so every user carries ~1 unit of influence.
-- 2. recompute_rankings_cron(): POSTs to the recompute-rankings Edge Function
--    via pg_net, reading the function URL + shared secret from Supabase Vault
--    (no environment values hardcoded here; see the AGENTS.md runbook for the
--    one-time vault bootstrap).
-- 3. A pg_cron schedule firing it every 15 minutes.
--
-- SECURITY: all three functions are security definer (they read user_rides /
-- vault, which api roles must not reach directly) and EXECUTE is revoked from
-- public/anon/authenticated so they are NOT exposed as public PostgREST RPCs;
-- the Edge Function calls the two aggregates with the service_role key, and
-- the cron function runs only from inside the database.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

-- Aggregated, per-user-normalized pairwise wins ---------------------------
create or replace function public.pairwise_wins()
returns table (winner uuid, loser uuid, weight double precision, wins bigint)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select user_id, coaster_id, rank,
           count(*) over (partition by user_id) as n
    from public.user_rides
    where rank is not null
  ),
  pairs as (
    select a.coaster_id as winner,
           b.coaster_id as loser,
           1.0 / (a.n * (a.n - 1) / 2) as pair_weight
    from ranked a
    join ranked b
      on a.user_id = b.user_id
     and a.coaster_id <> b.coaster_id
     and a.rank < b.rank
  )
  select winner, loser, sum(pair_weight)::double precision, count(*)
  from pairs
  group by winner, loser;
$$;

revoke execute on function public.pairwise_wins() from public, anon, authenticated;

-- Distinct users ranking each coaster (participants column) ---------------
create or replace function public.ranked_participants()
returns table (coaster_id uuid, participants bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coaster_id, count(distinct user_id)
  from public.user_rides
  where rank is not null
  group by coaster_id;
$$;

revoke execute on function public.ranked_participants() from public, anon, authenticated;

-- Cron entrypoint: vault-configured POST to the Edge Function -------------
-- Vault secret names (set once, see AGENTS.md):
--   'recompute_function_url'    e.g. 'https://<ref>.supabase.co/functions/v1/recompute-rankings'
--   'recompute_auth_secret'     the RECOMPUTE_AUTH_SECRET shared secret
-- Missing secrets => null => skip silently (job no-ops until bootstrapped).
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

revoke execute on function public.recompute_rankings_cron() from public, anon, authenticated;

-- Schedule -----------------------------------------------------------------
-- Idempotent: rescheduling replaces any earlier job of the same name.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'recompute-rankings') then
    perform cron.unschedule('recompute-rankings');
  end if;
  perform cron.schedule(
    'recompute-rankings',
    '*/15 * * * *',
    $cron$ select public.recompute_rankings_cron(); $cron$
  );
end;
$$;
