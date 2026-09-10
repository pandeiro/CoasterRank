-- Multi-manufacturer lineage for coasters (canonical example: Top Thrill 2 =
-- Intamin original + Zamperla re-track; filterable by either).
--
-- coasters.manufacturer_id STAYS the primary pointer (the board view columns,
-- rides embeds, rider RPC and slug disambiguation all keep reading it), but
-- the full lineage moves to a junction table:
--
--   canonical order = position ASC, added_at DESC
--     - position: explicit admin ordering (0..n-1, assigned on every save
--       that submits a lineage list). Equal positions mean "never explicitly
--       reordered" — for those, the NEWEST added manufacturer wins the front
--       slot (decision 2026-09: "otherwise defaults to most recent wins").
--     - primary = first row in canonical order; the trigger below keeps
--       coasters.manufacturer_id pointed at it (NULL when lineage empties).
--
-- All writers (importer, admin modal, submission approval) write junction
-- rows only; the pointer is derived, never set directly.
--
-- Community submissions still propose a SINGLE manufacturer (key
-- manufacturer_id, legacy) or a full replacement list (manufacturer_ids,
-- see the payload migration in the same PR); approval REPLACES the lineage.

create table public.coaster_manufacturers (
  coaster_id      uuid not null references public.coasters (id) on delete cascade,
  manufacturer_id uuid not null references public.manufacturers (id) on delete cascade,
  -- Explicit admin ordering. 0..n-1 after any admin save; all-equal (the
  -- backfill/importer default) means "never reordered" → added_at desc leads.
  position        int  not null default 0,
  -- Provenance: 'open-csv' (importer), 'admin' (admin modal), 'submission'
  -- (community approval). Lets the importer upsert its own rows without ever
  -- deleting admin-added lineage entries.
  source          text not null default 'admin',
  added_at        timestamptz not null default now(),
  primary key (coaster_id, manufacturer_id)
);

comment on table public.coaster_manufacturers is
  'Coaster manufacturer lineage, ordered. First row in canonical order (position asc, added_at desc) is the primary; coasters.manufacturer_id mirrors it via the sync_primary_manufacturer trigger.';

comment on column public.coaster_manufacturers.position is
  'Explicit ordering after an admin save; ties (all 0) mean never reordered and the newest added_at leads.';

create index coaster_manufacturers_manufacturer_id_idx
  on public.coaster_manufacturers (manufacturer_id);

-- RLS: same shape as the other reference tables — public read, admin write.
alter table public.coaster_manufacturers enable row level security;

create policy "coaster_manufacturers public read"
  on public.coaster_manufacturers for select using (true);

create policy "coaster_manufacturers admin manage"
  on public.coaster_manufacturers for all
  using (public.is_admin()) with check (public.is_admin());

-- Supabase does not auto-expose new tables to the Data API roles (see
-- 20260816183758_rls_policies §Privileges).
grant select on public.coaster_manufacturers to anon, authenticated;
grant insert, update, delete on public.coaster_manufacturers to authenticated;

-- Backfill: one row per existing coasters.manufacturer_id, in the "never
-- reordered" state (position 0). Single-row lineages make added_at moot; the
-- statement timestamp is as good as anything. Idempotent for re-runs.
insert into public.coaster_manufacturers
      (coaster_id, manufacturer_id, position, source, added_at)
select c.id,
       c.manufacturer_id,
       0,
       case when c.source = 'open-csv' then 'open-csv' else 'admin' end,
       now()
from public.coasters c
where c.manufacturer_id is not null
on conflict (coaster_id, manufacturer_id) do nothing;

-- Primary-pointer sync -------------------------------------------------------
-- The canonical order (position asc, added_at desc) is expressed here, in the
-- rankings view (manufacturer_ids/manufacturer_names) and in the app's
-- lineage helpers — keep the three in sync when touching the rule.
create function public.sync_primary_manufacturer()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_coaster uuid := coalesce(new.coaster_id, old.coaster_id);
  v_primary uuid;
begin
  select manufacturer_id into v_primary
  from public.coaster_manufacturers
  where coaster_id = v_coaster
  order by position asc, added_at desc, manufacturer_id asc
  limit 1;

  update public.coasters
     set manufacturer_id = v_primary
   where id = v_coaster;

  return null;
end;
$$;

create trigger sync_primary_manufacturer
after insert or update or delete on public.coaster_manufacturers
for each row execute function public.sync_primary_manufacturer();
