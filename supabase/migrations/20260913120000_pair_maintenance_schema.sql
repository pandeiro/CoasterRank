-- Pair-state schema for incremental pair maintenance + in-DB BT fitting
-- (promotion spec: docs/spikes/2026-09-pairwise-bench/PROMOTION.md §2-§3).
--
-- Two levels of pair storage replace the per-run O(R) aggregation over
-- user_rides that pairs each recompute against the edge-function memory wall:
--
--   user_pairs  — one row per (user, winner, loser): each user's current
--                 pair contribution. Rewritten whole-slice only when that
--                 user is dirty (the delta source).
--   pair_totals — the global aggregate the fit consumes (summed weight + win
--                 count per directed pair), maintained by delta in bounded
--                 batches. A second PK index makes the fit's reads O(P).
--
-- Dirty state (PROMOTION §2 — never lock user_rides; durable queue):
--
--   pair_dirty_users — the queue. Insert/delete-only; batches are claimed
--     via processing_until (no row locks held across calls) and the flag is
--     deleted only after the user's contribution is durably updated, so a
--     crash mid-batch re-queues them (maintenance is idempotent).
--     Marked atomically with every ride write by the tiny flag-only trigger
--     below — O(1) distinct rows per statement, NOT the measured O(n²)
--     pair-permutation trigger trap the spec rejects (§1).
--   pair_user_state — per-user last-maintained bookkeeping the hourly
--     reconciliation sweep compares against user_rides timestamps
--     (PROMOTION §1: missed flags self-heal within an hour).
--
-- Fit scratch (persistent working tables for the in-DB MM fit; rebuilt per
-- run by pair_fit_agg() in the functions migration):
--   pair_fit_opp / pair_fit_scores / pair_fit_state.
--
-- Security: every table has RLS enabled with no policies (deny-all); writes
-- flow through security-definer functions owned by postgres, called only by
-- the recompute pipeline (service_role). pair_dirty_users gets an admin
-- read-only policy so /admin/rankings can show queue depth + oldest entry —
-- same pattern as cron_execution_logs.

-- ── Queue + bookkeeping ─────────────────────────────────────────────────
create table public.pair_dirty_users (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  marked_at        timestamptz not null default now(),
  -- Claim marker: non-null + in the future = being processed by a batch that
  -- may still be in flight. Expired or null = claimable again.
  processing_until timestamptz
);

create index pair_dirty_users_marked_idx on public.pair_dirty_users (marked_at);

create table public.pair_user_state (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  last_maintained_at timestamptz not null default now(),
  -- Eligibility signature at maintenance time (bt_eligible_users()). The
  -- sweep re-marks users whose CURRENT eligibility differs, so admin /
  -- synthetic-marker flips heal like missed flags instead of leaving stale
  -- pair contributions that only a ride edit would notice.
  eligible           boolean not null default false
);

-- ── Two-level pair storage ──────────────────────────────────────────────
create table public.user_pairs (
  user_id uuid not null references auth.users (id) on delete cascade,
  winner  uuid not null references public.coasters (id) on delete cascade,
  loser   uuid not null references public.coasters (id) on delete cascade,
  weight  double precision not null,
  primary key (user_id, winner, loser)
)
-- Delete+rewrite-heavy (a dirty user's slice is swapped whole): leave
-- headroom for HOT updates and run autovacuum eagerly — the churn
-- simulation measured later-epoch degradation between vacuums (RESULTS.md
-- growth section; PROMOTION §3 makes vacuum a first-class concern).
with (
  fillfactor = 60,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);

create table public.pair_totals (
  winner     uuid not null references public.coasters (id) on delete cascade,
  loser      uuid not null references public.coasters (id) on delete cascade,
  weight_sum double precision not null,
  wins       bigint not null,
  primary key (winner, loser)
)
-- Delta-upserts touch rows scattered across the keyspace; same eager
-- autovacuum treatment as user_pairs.
with (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_analyze_scale_factor = 0.01
);

-- ── Fit scratch (service_role-only; rebuilt per run) ────────────────────
create table public.pair_fit_opp (
  a    uuid not null,
  b    uuid not null,
  n    double precision not null,
  wins bigint not null
);

create table public.pair_fit_scores (
  coaster_id uuid primary key,
  score      double precision not null,
  w          double precision not null,
  comparisons bigint not null,
  wins       bigint not null,
  new_score  double precision
);

create table public.pair_fit_state (
  id         integer primary key default 1,
  iterations integer not null default 0,
  converged  boolean not null default false,
  ready      boolean not null default false
);

insert into public.pair_fit_state (id) values (1) on conflict (id) do nothing;

-- ── RLS / grants ────────────────────────────────────────────────────────
alter table public.pair_dirty_users enable row level security;
alter table public.pair_user_state   enable row level security;
alter table public.user_pairs        enable row level security;
alter table public.pair_totals       enable row level security;
alter table public.pair_fit_opp      enable row level security;
alter table public.pair_fit_scores   enable row level security;
alter table public.pair_fit_state    enable row level security;

-- No policies = deny-all; the pipeline's security-definer functions run as
-- the table owner and bypass RLS. Explicit revokes in case of non-default
-- privileges on the cluster.
revoke all on public.pair_dirty_users from anon, authenticated;
revoke all on public.pair_user_state   from anon, authenticated;
revoke all on public.user_pairs        from anon, authenticated;
revoke all on public.pair_totals       from anon, authenticated;
revoke all on public.pair_fit_opp      from anon, authenticated;
revoke all on public.pair_fit_scores   from anon, authenticated;
revoke all on public.pair_fit_state    from anon, authenticated;

-- Admin monitoring (same pattern as cron_execution_logs): read-only view of
-- the queue for the /admin/rankings dirty-queue panel.
create policy "Admins can view pair dirty queue"
  on public.pair_dirty_users
  for select
  using (public.is_admin());

grant select on public.pair_dirty_users to authenticated;

-- ── Eligibility helper ──────────────────────────────────────────────────
-- The exact eligible-user filter the aggregates use (recompute_idle_skip,
-- pairwise_wins_custom) — security definer because it reads auth.users.
-- Used by the maintenance + sweep functions so maintained state can never
-- drift from what the (shadow/legacy) pairwise_wins aggregation includes.
create or replace function public.bt_eligible_users()
returns table (id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from auth.users u
  join public.profiles p on p.id = u.id
  where p.is_admin = false
    and coalesce(u.raw_user_meta_data->>'synthetic', 'false') <> 'true'
    and lower(coalesce(u.email, '')) not like '%@test.coasterrank.dev'
$$;

revoke execute on function public.bt_eligible_users() from public, anon, authenticated;
grant execute on function public.bt_eligible_users() to service_role;

-- ── Dirty-mark trigger (flag-only; statement-level + transition tables) ─
-- Marks users dirty atomically with every user_rides write — including the
-- security-definer RPCs (import apply, guest materialize), direct PostgREST
-- writes from the ranking UI, CLI/ops inserts, and FK cascade deletes.
-- Statement-level with transition tables: one insert per RIDE WRITE
-- STATEMENT (not per row), zero per-row trigger cost.
--
-- Scope: rank-relevant changes only — unranked-only touches (marking a ride
-- ridden, holding-pen inserts) change no pairs and are deliberately
-- excluded, matching recompute_idle_fingerprint's philosophy, so the idle
-- skip and the queue can never disagree about "nothing changed". Updates
-- mark when the rank transitions (old or new side ranked), mirroring
-- user_rides_updated_at's OLD.rank IS DISTINCT FROM NEW.rank condition.
create or replace function public.pair_mark_dirty_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pair_dirty_users (user_id)
  select distinct user_id from new_rides where rank is not null
  on conflict (user_id) do nothing;
  return null;
end;
$$;

create or replace function public.pair_mark_dirty_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pair_dirty_users (user_id)
  select user_id
  from (
    select nr.user_id
    from new_rides nr
    join old_rides orr
      on orr.user_id = nr.user_id and orr.coaster_id = nr.coaster_id
    where nr.rank is distinct from orr.rank
  ) t
  on conflict (user_id) do nothing;
  return null;
end;
$$;

create or replace function public.pair_mark_dirty_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pair_dirty_users (user_id)
  select distinct user_id from old_rides where rank is not null
  on conflict (user_id) do nothing;
  return null;
end;
$$;

drop trigger if exists pair_dirty_insert on public.user_rides;
create trigger pair_dirty_insert
  after insert on public.user_rides
  referencing new table as new_rides
  for each statement
  execute function public.pair_mark_dirty_insert();

drop trigger if exists pair_dirty_update on public.user_rides;
create trigger pair_dirty_update
  after update on public.user_rides
  referencing new table as new_rides old table as old_rides
  for each statement
  execute function public.pair_mark_dirty_update();

drop trigger if exists pair_dirty_delete on public.user_rides;
create trigger pair_dirty_delete
  after delete on public.user_rides
  referencing old table as old_rides
  for each statement
  execute function public.pair_mark_dirty_delete();

-- ── Backfill seed ───────────────────────────────────────────────────────
-- The pair tables start EMPTY; the first recompute after this migration
-- processes the whole queue (the prototype's cold-fit path, measured) and
-- lands the board on the maintained totals. Seed every eligible user who
-- currently has ranked rides.
insert into public.pair_dirty_users (user_id)
select distinct ur.user_id
from public.user_rides ur
join public.bt_eligible_users() e on e.id = ur.user_id
where ur.rank is not null
on conflict (user_id) do nothing;
