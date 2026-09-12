-- ── Guest promotion (docs/GUEST_UX.md Part II §4.3, v2.1) ─────────────────
-- Guests rank locally in localStorage; on verified signup (or merge into an
-- existing account) the client calls materialize_guest_rides with the
-- COMPLETE ordered ladder. Guest promotion is deliberately NOT routed through
-- apply_imported_rides: its p_source enum doesn't fit, its append contract
-- differs, and promotions must not stamp profiles.import_* or fire the
-- Telegram import notification.

-- ── 1. guest_promotions: post-auth funnel telemetry ────────────────────────
-- Server-authoritative funnel rows (§5): kind distinguishes fresh
-- materialization, merge-append, fast-add (logged-in quick mark), and
-- discard. duration_ms is server-computed from the client's started_at
-- (first mark engagement), clamped against clock skew.
create table public.guest_promotions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  kind         text not null check (kind in ('materialize', 'merge_append', 'merge_discard', 'fast_add')),
  ride_count   integer not null default 0,
  duration_ms  integer,
  created_at   timestamptz not null default now()
);

create index guest_promotions_user_created_idx on public.guest_promotions (user_id, created_at desc);
create index guest_promotions_kind_created_idx on public.guest_promotions (kind, created_at desc);

alter table public.guest_promotions enable row level security;

-- Same shape as import_events: users append their own telemetry via the
-- invoker RPCs; reads are admin-only (funnel queries run with psql/service
-- role).
create policy "guest_promotions insert own"
  on public.guest_promotions for insert to authenticated
  with check (user_id = auth.uid());

create policy "guest_promotions admin select"
  on public.guest_promotions for select to authenticated
  using (public.is_admin());

grant insert, select on public.guest_promotions to authenticated;

-- ── 2. materialize_guest_rides ─────────────────────────────────────────────
-- SECURITY INVOKER on purpose: the target user is auth.uid(), and RLS on
-- user_rides already scopes writes to own rows. (The rejected auth.users
-- trigger design couldn't use this RPC at all — no JWT under
-- supabase_auth_admin.)
--
-- p_rides: ordered JSON array of coaster uuids = the COMPLETE final ranked
-- ladder. Ranks are rewritten 1..n gapless from array position (first
-- occurrence wins on duplicates); holding-pen rows (rank = null) not in the
-- payload stay unranked. Idempotent by construction.
--
-- p_kind: which funnel event this call represents.
--
-- p_started_at: the guest's first-mark timestamp (ISO 8601 — never a raw
-- epoch integer, PostgREST rejects numeric timestamptz input); null skips
-- duration telemetry.
create or replace function public.materialize_guest_rides(
  p_rides jsonb,
  p_kind text default 'materialize',
  p_started_at timestamptz default null
)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_user uuid;
  v_count integer;
  v_missing integer;
  v_prior integer;
begin
  v_user := auth.uid();
  if v_user is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if p_kind not in ('materialize', 'merge_append', 'fast_add') then
    raise exception 'Unknown guest promotion kind: %', p_kind;
  end if;

  if jsonb_typeof(p_rides) is distinct from 'array' then
    raise exception 'p_rides must be a JSON array of coaster ids';
  end if;
  if jsonb_array_length(p_rides) = 0 then
    raise exception 'Guest payload contains no rows';
  end if;
  -- The client caps guests at 100; this ceiling is defense-in-depth against
  -- metadata-stuffed payloads on secondary devices.
  if jsonb_array_length(p_rides) > 200 then
    raise exception 'Guest payload too large (max 200 rows)';
  end if;

  -- Unknown-id validation (same "refresh and retry" contract as the import
  -- RPC); duplicates keep their first occurrence, ranks renumber 1..n.
  select count(*) into v_missing
  from (
    select distinct on (coaster_id)
           (elem #>> '{}')::uuid as coaster_id
    from jsonb_array_elements(p_rides) with ordinality as t(elem, ord)
    order by coaster_id, ord
  ) g
  where not exists (select 1 from coasters c where c.id = g.coaster_id);
  if v_missing > 0 then
    raise exception 'Guest list references % unknown coaster(s) — refresh and retry', v_missing;
  end if;

  -- Coverage guard: refuse any payload that would silently drop ranked rows
  -- the client didn't send. The dedicated errcode is the client's signal for
  -- STALE PAYLOAD RECOVERY (§4.2 review round 2, E): a secondary device
  -- holding an outdated guest payload wipes it and continues instead of
  -- failing every login. Nothing has been written at this point.
  select count(*) into v_prior
  from user_rides ur
  where ur.user_id = v_user and ur.rank is not null;
  select count(*) into v_missing
  from user_rides ur
  where ur.user_id = v_user
    and ur.rank is not null
    and not exists (
      select 1
      from (
        select distinct on (coaster_id)
               (elem #>> '{}')::uuid as coaster_id
        from jsonb_array_elements(p_rides) with ordinality as t(elem, ord)
        order by coaster_id, ord
      ) g
      where g.coaster_id = ur.coaster_id
    );
  if v_missing > 0 then
    raise exception 'Account has % ranked coaster(s) absent from the guest payload — stale', v_missing
      using errcode = 'PGRD1';
  end if;

  insert into user_rides (user_id, coaster_id, rank, ridden)
  select v_user, t.coaster_id, (row_number() over (order by t.ord))::integer, true
  from (
    select distinct on (coaster_id)
           (elem #>> '{}')::uuid as coaster_id,
           ord::integer as ord
    from jsonb_array_elements(p_rides) with ordinality as t(elem, ord)
    order by coaster_id, ord
  ) t
  on conflict (user_id, coaster_id) do update
    set rank = excluded.rank,
        ridden = true;

  get diagnostics v_count = row_count;

  -- Telemetry: ride_count = rows NEWLY ranked by this call (ladder length
  -- minus the prior ranked count) — "appended count" for the merge/fast-add
  -- kinds, the full count for a fresh materialization. duration_ms is
  -- server-computed and clamped against client clock skew (§4.3 review A).
  insert into guest_promotions (user_id, kind, ride_count, duration_ms)
  values (
    v_user,
    p_kind,
    greatest(0, v_count - v_prior),
    case
      when p_started_at is null then null
      else greatest(0, (extract(epoch from (now() - p_started_at)) * 1000)::integer)
    end
  );

  return v_count;
end;
$$;

revoke execute on function public.materialize_guest_rides(jsonb, text, timestamptz) from public, anon;
grant execute on function public.materialize_guest_rides(jsonb, text, timestamptz) to authenticated;

-- ── 3. log_guest_merge_decision ────────────────────────────────────────────
-- merge_discard materializes nothing but is still a funnel signal; the
-- append path is logged by its own materialize_guest_rides call.
create or replace function public.log_guest_merge_decision(p_kind text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_kind is distinct from 'merge_discard' then
    raise exception 'log_guest_merge_decision only records merge_discard';
  end if;
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  insert into guest_promotions (user_id, kind) values (auth.uid(), p_kind);
end;
$$;

revoke execute on function public.log_guest_merge_decision(text) from public, anon;
grant execute on function public.log_guest_merge_decision(text) to authenticated;
