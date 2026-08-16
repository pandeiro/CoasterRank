-- Relax v_coaster_rankings. Two changes, per the Phase 4 refactor:
--
-- 1. Drop the status = 'operating' filter. The SPA owns status filtering
--    client-side (default operating-only with a clean / URL; ?status=... to
--    show defunct/sbno/etc.). See PLAN §12.
-- 2. Drop the park + manufacturer joins. Reference data is small (~279 parks,
--    ~101 manufacturers) and is fetched once in parallel, cached by the SPA,
--    and joined client-side — this avoids repeating park/manufacturer names
--    across every coaster row in the full-dataset board fetch.
create or replace view public.v_coaster_rankings as
select
  c.*,
  r.score,
  r.comparisons,
  r.participants,
  row_number() over (order by r.score desc nulls last) as rank
from public.coasters c
left join public.coaster_ratings r on r.coaster_id = c.id;