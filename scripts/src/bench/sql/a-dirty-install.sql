-- BENCH-ONLY (staging project) — MEASURED PROTOTYPE.
-- NOTE: DB triggers maintaining pair permutations are deliberately SUPERSEDED for
-- production by app-set dirty flags + a reconciliation sweep (write amplification,
-- bloat, lock contention) — see docs/spikes/2026-09-pairwise-bench/PROMOTION.md §1.
-- This file exists to reproduce the measured variant, not as a promotion artifact. — Approach A: dirty-tracking / incremental pair
-- maintenance. NOT a migration; applied by the bench harness via psql.
--
-- Replaces the body of public.pairwise_wins() (same name/signature, so the
-- deployed recompute-rankings Edge Function is untouched and the harness
-- measures the identical call path) with a table-backed aggregate:
--
--   user_rides writes  --(row trigger: mark user dirty)-->  bench.dirty_users
--   pairwise_wins()    --> bench.maintain_pairs(): for each dirty user only,
--                          rewrite their per-pair rows in bench.user_pairs
--                      --> aggregate bench.user_pairs (linear read, no join)
--
-- Per-run SQL cost drops from O(R · join) to O(dirty · n² + R · read). The
-- PostgREST payload (P distinct pairs) is UNCHANGED by design — this variant
-- isolates the SQL-side improvement.
create schema if not exists bench;

create table if not exists bench.user_pairs (
  user_id uuid not null,
  winner uuid not null,
  loser uuid not null,
  weight double precision not null,
  primary key (user_id, winner, loser)
);

create table if not exists bench.dirty_users (
  user_id uuid primary key,
  marked_at timestamptz not null default now()
);

create or replace function bench.mark_user_dirty() returns trigger
language plpgsql security definer set search_path = public, bench as $$
declare
  uid uuid;
begin
  uid = coalesce(new.user_id, old.user_id);
  insert into bench.dirty_users (user_id) values (uid) on conflict (user_id) do nothing;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_bench_dirty_insert on public.user_rides;
create trigger trg_bench_dirty_insert
  after insert on public.user_rides
  for each row execute function bench.mark_user_dirty();

drop trigger if exists trg_bench_dirty_update on public.user_rides;
create trigger trg_bench_dirty_update
  after update on public.user_rides
  for each row execute function bench.mark_user_dirty();

drop trigger if exists trg_bench_dirty_delete on public.user_rides;
create trigger trg_bench_dirty_delete
  after delete on public.user_rides
  for each row execute function bench.mark_user_dirty();

-- Rewrite the dirty users' per-pair rows from their current ranked rides.
-- Weight formula matches production: (P + 28)^(−0.5), P = n(n−1)/2.
create or replace function bench.maintain_pairs() returns integer
language plpgsql security definer set search_path = public, bench as $$
declare
  uid uuid;
  processed integer := 0;
begin
  for uid in select user_id from bench.dirty_users loop
    delete from bench.user_pairs where user_id = uid;
    insert into bench.user_pairs (user_id, winner, loser, weight)
    select
      a.user_id,
      a.coaster_id,
      b.coaster_id,
      power(
        (a.n::double precision * (a.n - 1) / 2) + 28::double precision,
        -0.5
      )
    from (
      select ur.user_id, ur.coaster_id, ur.rank,
             count(*) over (partition by ur.user_id) as n
      from public.user_rides ur
      where ur.user_id = uid and ur.rank is not null
    ) a
    join (
      select ur.coaster_id, ur.rank
      from public.user_rides ur
      where ur.user_id = uid and ur.rank is not null
    ) b on a.user_id = uid and a.coaster_id <> b.coaster_id and a.rank < b.rank;
    delete from bench.dirty_users where user_id = uid;
    processed := processed + 1;
  end loop;
  return processed;
end;
$$;

-- Same name/signature the Edge Function already calls; body now reads the
-- maintained table. Grant state re-asserted explicitly.
create or replace function public.pairwise_wins()
returns table (winner uuid, loser uuid, weight double precision, wins bigint)
language plpgsql
volatile
security definer
set search_path = public, bench
as $$
begin
  perform bench.maintain_pairs();
  return query
  select up.winner, up.loser, sum(up.weight)::double precision, count(*)
  from bench.user_pairs up
  group by up.winner, up.loser;
end;
$$;

revoke execute on function public.pairwise_wins() from public, anon, authenticated;
grant execute on function public.pairwise_wins() to service_role;
