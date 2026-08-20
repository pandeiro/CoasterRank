-- Fix v_coaster_rankings: only assign rank when score is not null.
-- When coaster_ratings is empty (no user rankings yet), all scores are null
-- and row_number() was assigning arbitrary ranks 1,2,3... based on physical row order.
create or replace view public.v_coaster_rankings as
select
  c.*,
  r.score,
  r.comparisons,
  r.participants,
  case
    when r.score is not null then row_number() over (order by r.score desc)
  end as rank
from public.coasters c
left join public.coaster_ratings r on r.coaster_id = c.id;