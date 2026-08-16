-- Ranking output: coaster_ratings + v_coaster_rankings view.
-- Public read; service-role write (the Edge Function, which bypasses RLS).
-- See PLAN §4.4.

-- coaster_ratings --------------------------------------------------------
create table public.coaster_ratings (
  coaster_id   uuid primary key references public.coasters (id) on delete cascade,
  score        numeric not null default 0,
  comparisons  integer not null default 0,
  wins         integer not null default 0,
  participants integer not null default 0,
  updated_at   timestamptz not null default now()
);

-- v_coaster_rankings -----------------------------------------------------
-- The board's read surface: coasters.* + BT metrics + a live row_number rank.
-- LEFT JOIN so operating coasters with no rating yet still appear (score null,
-- ranked last). Filtered to status = 'operating' per the PLAN.
create view public.v_coaster_rankings as
select
  c.*,
  r.score,
  r.comparisons,
  r.participants,
  row_number() over (order by r.score desc nulls last) as rank
from public.coasters c
left join public.coaster_ratings r on r.coaster_id = c.id
where c.status = 'operating';