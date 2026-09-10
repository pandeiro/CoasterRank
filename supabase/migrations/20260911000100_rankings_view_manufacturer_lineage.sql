-- v_coaster_rankings: expose the full manufacturer lineage on the board's
-- read surface (multi-manufacturer support, e.g. Top Thrill 2 = Intamin +
-- Zamperla). Columns are APPENDED, so CREATE OR REPLACE applies in place.
--
--   manufacturer_ids / manufacturer_names — the full ordered lineage
--     (canonical order: position asc, added_at desc — the SAME rule the
--     sync_primary_manufacturer trigger enforces; keep the two in sync).
--   manufacturer_id / manufacturer_name — semantics UNCHANGED: the primary
--     (first in canonical order), so every existing consumer (rides embed,
--     /me list, client-side filters, detail page) keeps working.
--
-- Deploy-order skew safety: the app treats the arrays as optional and falls
-- back to manufacturer_name, so an app deployed before or after this
-- migration degrades gracefully either way.

create or replace view public.v_coaster_rankings as
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
  p.city as park_city,
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
    when r.score is not null
      then row_number() over (order by r.score desc nulls last, c.id)
  end as rank,
  ws.rank as rank_last_week,
  coalesce(
    (select array_agg(cm.manufacturer_id
                      order by cm.position asc, cm.added_at desc, cm.manufacturer_id asc)
     from public.coaster_manufacturers cm
     where cm.coaster_id = c.id),
    '{}'::uuid[]
  ) as manufacturer_ids,
  coalesce(
    (select array_agg(m2.name order by cm2.position asc, cm2.added_at desc, m2.name asc)
     from public.coaster_manufacturers cm2
     left join public.manufacturers m2 on m2.id = cm2.manufacturer_id
     where cm2.coaster_id = c.id),
    '{}'::text[]
  ) as manufacturer_names
from public.coasters c
left join public.coaster_ratings r on r.coaster_id = c.id
left join public.rank_weekly_snapshots ws
  on ws.coaster_id = c.id
 and ws.week_start =
       ((date_trunc('week', now() at time zone 'utc') - interval '7 days'))::date
left join public.parks p on p.id = c.park_id
left join public.manufacturers m on m.id = c.manufacturer_id;
