-- Spreadsheet import (CSV / paste): provenance flag, telemetry, and the bulk
-- apply RPC. Never applied directly — go through PR → merge → CI.
--
-- Flow: the client parses a file/pasted text, matches each row against the
-- catalog (packages/match), shows a review screen, then calls
-- apply_imported_rides() with the FINAL ordered coaster-id list. The RPC
-- rewrites ranks atomically (gapless by construction), stamps the profile's
-- import provenance, and records an 'applied' telemetry event that fires the
-- Telegram import notification (kill-switched via app_settings.import_events).

-- ── 1. profiles: import provenance ─────────────────────────────────────────
alter table public.profiles
  add column imported_at timestamptz,
  add column import_source text;

alter table public.profiles
  add constraint profiles_import_source_check
  check (import_source in ('csv', 'xls', 'xlsx', 'paste', 'sheets'));

-- ── 2. import_events: matching-quality telemetry ───────────────────────────
-- One row per import lifecycle step:
--   parsed  — client finished parsing + matching (pre-review counts)
--   applied — RPC committed the import (authoritative; fires Telegram)
--   undo    — client restored the pre-import list after an apply
--   failed  — client-side parse/apply error (message in detail)
-- The aggregate columns power psql queries for auto-match rate, review
-- friction (parsed ≫ applied), and override rate (false-positive signal).
-- unmatched_names caps at 50 raw strings — the gold that feeds new
-- coaster_aliases rows, which in turn lift the alias tier.
create table public.import_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  kind             text not null check (kind in ('parsed', 'applied', 'undo', 'failed')),
  source           text not null check (source in ('csv', 'xls', 'xlsx', 'paste', 'sheets')),
  rows_total       integer not null default 0,
  auto_matched     integer,
  candidate_picked integer,
  not_found        integer,
  overrides        integer,
  mode             text check (mode in ('append', 'replace')),
  duration_ms      integer,
  file_bytes       bigint,
  unmatched_names  jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

create index import_events_user_created_idx on public.import_events (user_id, created_at desc);
create index import_events_kind_created_idx on public.import_events (kind, created_at desc);

alter table public.import_events enable row level security;

-- Users append their own telemetry; reads are admin-only (metrics queries run
-- with psql/service role anyway).
create policy "import_events insert own"
  on public.import_events for insert to authenticated
  with check (user_id = auth.uid());

create policy "import_events admin select"
  on public.import_events for select to authenticated
  using (public.is_admin());

grant insert, select on public.import_events to authenticated;

-- ── 3. stats extraction helpers (client-controlled p_stats must never be
--      able to abort an import with a bad cast) ─────────────────────────────
create or replace function public.import_stat_int(p_stats jsonb, p_key text)
returns integer
language plpgsql
stable
set search_path = public
as $$
begin
  if p_stats is null or not (p_stats ? p_key) then
    return null;
  end if;
  begin
    return (p_stats ->> p_key)::integer;
  exception when others then
    return null;
  end;
end;
$$;

revoke execute on function public.import_stat_int(jsonb, text) from public, anon;

create or replace function public.import_stat_names(p_stats jsonb)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
begin
  if p_stats is null or jsonb_typeof(p_stats -> 'unmatched_names') is distinct from 'array' then
    return '[]'::jsonb;
  end if;
  return (
    select coalesce(jsonb_agg(left(v, 200)), '[]'::jsonb)
    from (
      select v
      from jsonb_array_elements_text(p_stats -> 'unmatched_names') as v
      limit 50
    ) capped
  );
end;
$$;

revoke execute on function public.import_stat_names(jsonb) from public, anon;

-- ── 4. apply_imported_rides ────────────────────────────────────────────────
-- p_rides: ordered JSON array of coaster uuids = the user's COMPLETE final
-- ranked list (existing ranked rows included — the client owns merge order).
-- Ranks are rewritten 1..n from array position, so the ladder stays gapless.
--
-- p_replace: replace mode first clears every RANKED row (rows with rank =
-- null, the "added but not ranked" holding pen, are preserved); append mode
-- requires the payload to already cover every existing ranked row and refuses
-- otherwise, so a stale client can never silently drop part of a ladder.
create or replace function public.apply_imported_rides(
  p_rides jsonb,
  p_replace boolean default false,
  p_source text default 'csv',
  p_stats jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_count integer;
  v_input_count integer;
  v_missing integer;
  v_stale integer;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_source not in ('csv', 'xls', 'xlsx', 'paste', 'sheets') then
    raise exception 'Invalid import source';
  end if;

  if jsonb_typeof(p_rides) is distinct from 'array' then
    raise exception 'p_rides must be a JSON array of coaster ids';
  end if;
  if jsonb_array_length(p_rides) > 5000 then
    raise exception 'Import too large (max 5000 rows)';
  end if;
  if jsonb_array_length(p_rides) = 0 and not p_replace then
    raise exception 'Import contains no rows';
  end if;

  -- Duplicate ids keep their FIRST occurrence (earlier = better rank). The
  -- explicit ::uuid cast below also runs inside this transaction, so a
  -- malformed id aborts before any write.
  create temp table tmp_import_rides on commit drop as
    select distinct on (coaster_id)
           ord::integer as rank,
           (elem #>> '{}')::uuid as coaster_id
    from jsonb_array_elements(p_rides) with ordinality as t(elem, ord)
    order by coaster_id, ord;

  select count(*) into v_input_count from tmp_import_rides;

  select count(*) into v_missing
  from tmp_import_rides t
  where not exists (select 1 from coasters c where c.id = t.coaster_id);
  if v_missing > 0 then
    raise exception 'Import references % unknown coaster(s) — refresh and retry', v_missing;
  end if;

  if p_replace then
    delete from user_rides where user_id = v_user and rank is not null;
  else
    select count(*) into v_stale
    from user_rides ur
    where ur.user_id = v_user
      and ur.rank is not null
      and not exists (select 1 from tmp_import_rides t where t.coaster_id = ur.coaster_id);
    if v_stale > 0 then
      raise exception 'Your list changed — reload the page and retry the import';
    end if;
  end if;

  insert into user_rides (user_id, coaster_id, rank, ridden)
  select v_user, t.coaster_id, t.rank, true
  from tmp_import_rides t
  on conflict (user_id, coaster_id) do update
    set rank = excluded.rank,
        ridden = true;

  get diagnostics v_count = row_count;

  update profiles
  set imported_at = now(),
      import_source = p_source
  where id = v_user;

  insert into import_events (
    user_id, kind, source, rows_total, auto_matched, candidate_picked,
    not_found, overrides, mode, duration_ms, file_bytes, unmatched_names
  )
  values (
    v_user,
    'applied',
    p_source,
    jsonb_array_length(p_rides),
    import_stat_int(p_stats, 'auto_matched'),
    import_stat_int(p_stats, 'candidate_picked'),
    import_stat_int(p_stats, 'not_found'),
    import_stat_int(p_stats, 'overrides'),
    case when p_replace then 'replace' else 'append' end,
    import_stat_int(p_stats, 'duration_ms'),
    import_stat_int(p_stats, 'file_bytes'),
    import_stat_names(p_stats)
  );

  return v_count;
end;
$$;

revoke execute on function public.apply_imported_rides(jsonb, boolean, text, jsonb) from public, anon;
grant execute on function public.apply_imported_rides(jsonb, boolean, text, jsonb) to authenticated;

-- ── 5. Telegram notification (per-applied-import, kill-switched) ───────────
insert into public.app_settings (key, enabled, label) values
  ('import_events', true, 'Import events')
on conflict (key) do update set label = excluded.label;

create or replace function public.trigger_notify_on_import()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_username text;
begin
  -- Only committed imports notify; parsed/undo/failed stay in the table for
  -- psql analysis without ringing the channel.
  if new.kind <> 'applied' then
    return new;
  end if;

  select email into v_email
  from auth.users
  where id = new.user_id;

  -- Filter synthetic test users (same convention as signup/submission/share).
  if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
    return new;
  end if;

  select username into v_username
  from public.profiles
  where id = new.user_id;

  v_username := coalesce(v_username, split_part(v_email, '@', 1), 'new user');

  perform public.send_telegram_event(
    'import_events',
    telegram_safe_text(
      '📥 @' || v_username ||
      ' imported ' || new.rows_total || ' coasters (' || new.source ||
      ', ' || coalesce(new.mode, 'append') || ')' ||
      ' — auto ' || coalesce(new.auto_matched, 0) ||
      ' / picked ' || coalesce(new.candidate_picked, 0) ||
      ' / missing ' || coalesce(new.not_found, 0),
      200
    )
  );

  return new;
end;
$$;

create trigger on_import_event_applied_notify_telegram
  after insert on public.import_events
  for each row execute function public.trigger_notify_on_import();
