-- Rank numbering fix: the window's `order by r.score desc` defaulted to
-- NULLS FIRST (Postgres's DESC default), so every unrated coaster consumed a
-- rank slot ahead of rated ones — rated coasters started in the 1000s.
-- NULLS LAST restricts row_number to the rated prefix (1..N over rated
-- coasters); the CASE still renders NULL for unrated rows. `c.id` breaks ties
-- so equal scores get a deterministic rank across loads and recomputes.
-- Column list is unchanged, so CREATE OR REPLACE applies in place.

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
  end as rank
from public.coasters c
left join public.coaster_ratings r on r.coaster_id = c.id
left join public.parks p on p.id = c.park_id
left join public.manufacturers m on m.id = c.manufacturer_id;
