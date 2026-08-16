-- Relax v_coaster_rankings: drop the status = 'operating' filter so the SPA
-- decides which statuses appear (default operating-only; ?status=... to show
-- defunct/sbno/etc.). Also join in park + manufacturer display names so the
-- board and detail pages don't need secondary lookups. See PLAN §12.
create or replace view public.v_coaster_rankings as
select
  c.*,
  p.name     as park_name,
  p.slug     as park_slug,
  p.country  as park_country,
  p.city     as park_city,
  m.name     as manufacturer_name,
  m.slug     as manufacturer_slug,
  r.score,
  r.comparisons,
  r.participants,
  row_number() over (order by r.score desc nulls last) as rank
from public.coasters c
left join public.parks p on p.id = c.park_id
left join public.manufacturers m on m.id = c.manufacturer_id
left join public.coaster_ratings r on r.coaster_id = c.id;