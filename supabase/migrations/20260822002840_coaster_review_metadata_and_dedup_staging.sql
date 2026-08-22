-- Phase 0: Review metadata + dedup staging
-- Applied via: PR → merge to main → CI supabase db push (never run db push locally)

-- 1. Coasters: review metadata columns
alter table public.coasters
  add column if not exists last_verified_at    timestamptz,
  add column if not exists confidence          numeric check (confidence between 0 and 1),
  add column if not exists review_state        text not null default 'active'
    check (review_state in ('active', 'needs_review', 'possibly_duplicate', 'possibly_outdated', 'archived')),
  add column if not exists needs_review_reason text;

-- 2. pg_trgm extension and trigram indexes (coasters, parks, manufacturers)
create extension if not exists pg_trgm;
create index if not exists coasters_name_trgm_idx
  on public.coasters using gin (name gin_trgm_ops);
create index if not exists parks_name_trgm_idx
  on public.parks using gin (name gin_trgm_ops);
create index if not exists manufacturers_name_trgm_idx
  on public.manufacturers using gin (name gin_trgm_ops);

-- 3. Coaster merge audit trail
create table if not exists public.coaster_merge_log (
  id                   uuid primary key default gen_random_uuid(),
  duplicate_coaster_id uuid not null,
  canonical_coaster_id uuid not null references public.coasters (id),
  merged_by            text,
  reason               text,
  created_at           timestamptz not null default now()
);

-- 4. Coaster duplicate candidate staging
create table if not exists public.coaster_dupe_candidates (
  id                  uuid primary key default gen_random_uuid(),
  coaster_a_id        uuid not null references public.coasters (id),
  coaster_b_id        uuid not null references public.coasters (id),
  similarity          numeric not null check (similarity between 0 and 1),
  match_basis         text not null,
  verdict             text,
  verdict_confidence  numeric check (verdict_confidence between 0 and 1),
  verdict_reasoning   text,
  resolved            boolean not null default false,
  reviewed_by         text,
  created_at          timestamptz not null default now(),
  constraint coaster_dupe_candidates_pair_unique unique (coaster_a_id, coaster_b_id)
);

-- 5. Park duplicate candidate staging
create table if not exists public.park_dupe_candidates (
  id           uuid primary key default gen_random_uuid(),
  park_a_id    uuid not null references public.parks (id),
  park_b_id    uuid not null references public.parks (id),
  similarity   numeric not null check (similarity between 0 and 1),
  verdict      text,
  verdict_reasoning text,
  resolved     boolean not null default false,
  reviewed_by  text,
  created_at   timestamptz not null default now(),
  constraint park_dupe_candidates_pair_unique unique (park_a_id, park_b_id)
);

-- 6. Manufacturer duplicate candidate staging
create table if not exists public.manufacturer_dupe_candidates (
  id                  uuid primary key default gen_random_uuid(),
  manufacturer_a_id   uuid not null references public.manufacturers (id),
  manufacturer_b_id   uuid not null references public.manufacturers (id),
  similarity          numeric not null check (similarity between 0 and 1),
  verdict             text,
  verdict_reasoning   text,
  resolved            boolean not null default false,
  reviewed_by         text,
  created_at          timestamptz not null default now(),
  constraint manufacturer_dupe_candidates_pair_unique unique (manufacturer_a_id, manufacturer_b_id)
);

-- 7. RLS for all four new tables
--    No access for anon or authenticated (internal pipeline tables)
--    Admin-only SELECT policy via is_admin()
--    service_role bypasses RLS naturally

alter table public.coaster_merge_log         enable row level security;
alter table public.coaster_dupe_candidates   enable row level security;
alter table public.park_dupe_candidates      enable row level security;
alter table public.manufacturer_dupe_candidates enable row level security;

create policy "coaster_merge_log admin select"
  on public.coaster_merge_log for select
  using (public.is_admin());

create policy "coaster_dupe_candidates admin select"
  on public.coaster_dupe_candidates for select
  using (public.is_admin());

create policy "park_dupe_candidates admin select"
  on public.park_dupe_candidates for select
  using (public.is_admin());

create policy "manufacturer_dupe_candidates admin select"
  on public.manufacturer_dupe_candidates for select
  using (public.is_admin());

-- Grant SELECT to authenticated so the admin policy can fire via PostgREST
grant select on public.coaster_merge_log           to authenticated;
grant select on public.coaster_dupe_candidates     to authenticated;
grant select on public.park_dupe_candidates        to authenticated;
grant select on public.manufacturer_dupe_candidates to authenticated;

-- 8. Mark legacy import records for review
update public.coasters
  set review_state = 'needs_review',
      confidence   = 0.3
where source = 'open-csv';

-- 9. Atomic coaster merge helper (used by review-dupes CLI via supabaseAdmin.rpc)
create or replace function public.apply_coaster_merge(
  p_duplicate_id  uuid,
  p_canonical_id  uuid,
  p_candidate_id  uuid,
  p_reason        text,
  p_merged_by     text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.coasters where id = p_duplicate_id;

  insert into public.coaster_merge_log (
    duplicate_coaster_id, canonical_coaster_id, merged_by, reason
  ) values (
    p_duplicate_id, p_canonical_id, p_merged_by, p_reason
  );

  update public.coaster_dupe_candidates
    set resolved = true
  where id = p_candidate_id;
end;
$$;

revoke execute on function public.apply_coaster_merge(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_coaster_merge(uuid, uuid, uuid, text, text)
  to service_role;
