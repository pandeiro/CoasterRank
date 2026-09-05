-- Rank movement, weekly baseline (PLAN §11 "Rank movement indicators").
-- One row per coaster per ISO week (UTC Monday). The recompute Edge Function
-- upserts the CURRENT week's row on every 15-min run, so a week's row
-- converges to that week's final rank; the PREVIOUS week's row freezes when
-- the week rolls over and serves as the "↑2 this week" baseline via
-- v_coaster_rankings.rank_last_week. Only service-role (the recompute
-- function) writes; public reads go through the view, and RLS with no
-- policies keeps direct anon/authenticated access empty.
create table public.rank_weekly_snapshots (
  coaster_id  uuid not null references public.coasters (id) on delete cascade,
  week_start  date not null,
  rank        integer not null,
  score       numeric not null,
  computed_at timestamptz not null default now(),
  primary key (coaster_id, week_start)
);

alter table public.rank_weekly_snapshots enable row level security;
