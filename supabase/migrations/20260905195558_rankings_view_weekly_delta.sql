-- Expose the weekly rank baseline on the board's read surface (PLAN §11
-- "Rank movement indicators"): rank_last_week is the coaster's final rank in
-- the PREVIOUS ISO week (UTC), from rank_weekly_snapshots. NULL when the
-- coaster wasn't ranked at the end of last week (new to the board, or the
-- feature's first week). The view's live row_number() rank remains the sole
-- source of truth for the current position; the snapshot never shadows it.
-- `now() at time zone 'utc'` pins the week boundary to UTC Monday so the
-- boundary matches the Edge Function's own week_start computation
-- (date_trunc('week', …) follows the session TimeZone otherwise).
-- Column list is append-only, so CREATE OR REPLACE applies in place.

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
  ws.rank as rank_last_week
from public.coasters c
left join public.coaster_ratings r on r.coaster_id = c.id
left join public.rank_weekly_snapshots ws
  on ws.coaster_id = c.id
 and ws.week_start =
       ((date_trunc('week', now() at time zone 'utc') - interval '7 days'))::date
left join public.parks p on p.id = c.park_id
left join public.manufacturers m on m.id = c.manufacturer_id;
