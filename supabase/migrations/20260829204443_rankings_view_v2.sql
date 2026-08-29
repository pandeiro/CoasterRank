-- Rankings board v2 (PLAN 3.0):
--   * coaster_ratings.first_place_votes — maintained by the recompute Edge
--     Function (count of user_rides rows with rank = 1 per coaster).
--   * first_place_counts() / ranked_user_count() — service-visible aggregates
--     over user_rides (mirrors ranked_participants()).
--   * v_coaster_rankings — slimmed to the columns the SPA actually reads and
--     denormalized with park/manufacturer display data + aliases so the board
--     can filter and search entirely client-side.

-- First-place votes column (0 for coasters nobody put first; the Edge Function
-- refreshes it on every recompute).
alter table public.coaster_ratings
  add column first_place_votes integer not null default 0;

-- Users whose ordered list starts with each coaster. Security definer so it
-- can aggregate user_rides across all users (RLS is owner-only); callable only
-- by the Edge Function's service_role.
create or replace function public.first_place_counts()
returns table (coaster_id uuid, first_place_votes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coaster_id, count(*)
  from public.user_rides
  where rank = 1
  group by coaster_id;
$$;

revoke execute on function public.first_place_counts() from public, anon, authenticated;
grant execute on function public.first_place_counts() to service_role;

-- Total users with at least one ranked ride — the board's "enough data yet?"
-- gate for showing first-place numbers. A pure aggregate (no per-user rows),
-- so exposing it to anon/authenticated leaks nothing.
create or replace function public.ranked_user_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct user_id)
  from public.user_rides
  where rank is not null;
$$;

revoke execute on function public.ranked_user_count() from public, anon, authenticated;
grant execute on function public.ranked_user_count() to anon, authenticated;

-- The board view. Explicit column list (no more c.*): drops source/external_id
-- and the review-metadata columns the SPA never read from the view, and adds
-- the denormalized display/filter fields the board needs in one payload.
-- (CREATE OR REPLACE cannot change a view's column list, so drop + recreate;
-- the migration runs in one transaction, so the view is never absent.)
drop view if exists public.v_coaster_rankings;

create view public.v_coaster_rankings as
select
  c.id,
  c.park_id,
  c.name,
  c.slug,
  c.manufacturer_id,
  c.model,
  c.opening_date,
  c.status,
  c.material,
  c.height_m,
  c.speed_kmh,
  c.length_m,
  c.inversions,
  c.type,
  p.name as park_name,
  p.slug as park_slug,
  p.country as park_country,
  m.name as manufacturer_name,
  coalesce(
    (select array_agg(a.name order by a.name)
     from public.coaster_aliases a
     where a.coaster_id = c.id),
    '{}'::text[]
  ) as aliases,
  r.score,
  r.comparisons,
  r.participants,
  r.first_place_votes,
  case
    when r.score is not null then row_number() over (order by r.score desc)
  end as rank
from public.coasters c
left join public.coaster_ratings r on r.coaster_id = c.id
left join public.parks p on p.id = c.park_id
left join public.manufacturers m on m.id = c.manufacturer_id;

grant select on public.v_coaster_rankings to anon, authenticated;
