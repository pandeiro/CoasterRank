-- Discover upcoming ranking compute runs from pg_cron schedule.
--
-- Exposes an unauthenticated, lightweight RPC for discovering when the
-- Bradley-Terry ranking recompute is next scheduled to fire. Used in two
-- places:
-- 1. Homepage live popunder (LiveStatusPopunder): shows a relative countdown
--    while open and transitions to 'now' when the scheduled slot occurs.
-- 2. Admin rankings view (RankingsPanel): displays the next scheduled run.
--
-- Security: SECURITY DEFINER with search_path restricted to public, extensions, cron.
-- Access is granted to anon and authenticated roles. Only returns schedule timing
-- metadata — no user or internal pipeline data.

create or replace function public.ranking_schedule()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, cron
as $$
declare
  v_schedule text;
  v_active boolean;
  v_step_min int;
  v_fixed_min int;
  v_cadence_ms int := 300000;
  v_now timestamptz := now();
  v_base timestamptz := date_trunc('hour', v_now);
  v_cur_min int := date_part('minute', v_now)::int;
  v_cur_sec double precision := date_part('second', v_now);
  v_first_run timestamptz;
  v_runs timestamptz[] := '{}';
  i int;
begin
  -- Look up the pg_cron schedule for the recompute job.
  select schedule, active
  into v_schedule, v_active
  from cron.job
  where jobname = 'recompute-rankings';

  -- Fallback if not configured in cron.job (e.g. fresh dev / test environment).
  v_schedule := coalesce(v_schedule, '*/5 * * * *');
  v_active := coalesce(v_active, true);

  -- Inactive job: no runs scheduled.
  if not v_active then
    return jsonb_build_object(
      'schedule', v_schedule,
      'active', false,
      'cadence_ms', null,
      'next_run', null,
      'next_runs', '[]'::jsonb
    );
  end if;

  -- Derive the next run timestamps from the cron schedule expression.
  if v_schedule ~ '^\*/([0-9]+)\s+\*\s+\*\s+\*\s+\*$' then
    v_step_min := (regexp_match(v_schedule, '^\*/([0-9]+)'))[1]::int;
    if v_step_min <= 0 or v_step_min > 60 then
      v_step_min := 5;
    end if;
    v_cadence_ms := v_step_min * 60000;
    if v_cur_sec > 0 then
      v_first_run := v_base + ((((v_cur_min / v_step_min) + 1) * v_step_min) || ' minutes')::interval;
    else
      v_first_run := v_base + ((((v_cur_min + v_step_min - 1) / v_step_min) * v_step_min) || ' minutes')::interval;
    end if;
    for i in 0..4 loop
      v_runs := array_append(v_runs, v_first_run + (i * v_step_min || ' minutes')::interval);
    end loop;
  elsif v_schedule = '* * * * *' then
    v_step_min := 1;
    v_cadence_ms := 60000;
    if v_cur_sec > 0 then
      v_first_run := date_trunc('minute', v_now) + interval '1 minute';
    else
      v_first_run := date_trunc('minute', v_now);
    end if;
    for i in 0..4 loop
      v_runs := array_append(v_runs, v_first_run + (i || ' minutes')::interval);
    end loop;
  elsif v_schedule ~ '^([0-9]+)\s+\*\s+\*\s+\*\s+\*$' then
    v_fixed_min := (regexp_match(v_schedule, '^([0-9]+)'))[1]::int;
    v_cadence_ms := 3600000;
    if v_cur_min < v_fixed_min or (v_cur_min = v_fixed_min and v_cur_sec = 0) then
      v_first_run := v_base + (v_fixed_min || ' minutes')::interval;
    else
      v_first_run := v_base + interval '1 hour' + (v_fixed_min || ' minutes')::interval;
    end if;
    for i in 0..4 loop
      v_runs := array_append(v_runs, v_first_run + (i || ' hours')::interval);
    end loop;
  else
    -- Safe default fallback for other cadences: 5 minutes.
    v_step_min := 5;
    v_cadence_ms := 300000;
    if v_cur_sec > 0 then
      v_first_run := v_base + ((((v_cur_min / v_step_min) + 1) * v_step_min) || ' minutes')::interval;
    else
      v_first_run := v_base + ((((v_cur_min + v_step_min - 1) / v_step_min) * v_step_min) || ' minutes')::interval;
    end if;
    for i in 0..4 loop
      v_runs := array_append(v_runs, v_first_run + (i * v_step_min || ' minutes')::interval);
    end loop;
  end if;

  return jsonb_build_object(
    'schedule', v_schedule,
    'active', true,
    'cadence_ms', v_cadence_ms,
    'next_run', to_jsonb(v_runs[1]),
    'next_runs', to_jsonb(v_runs)
  );
end;
$$;

revoke execute on function public.ranking_schedule() from public, anon, authenticated;
grant execute on function public.ranking_schedule() to anon, authenticated;
