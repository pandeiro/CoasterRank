-- BENCH-ONLY — restores public.pairwise_wins() to the production body
-- (migration 20260910120000_bt_weighting_exponent.sql, verbatim) and removes
-- the dirty-tracking scaffolding. Applied after every variant-A run so the
-- next variant always starts from the production function shape.
create or replace function public.pairwise_wins_custom(
  gamma double precision default 0.5,
  floor_pairs integer default 28,
  ramp_k integer default 0
)
returns table (winner uuid, loser uuid, weight double precision, wins bigint)
language sql
stable
security definer
set search_path = public
as $$
  with eligible_users as (
    select u.id
    from auth.users u
    join public.profiles p on p.id = u.id
    where p.is_admin = false
      and coalesce(u.raw_user_meta_data->>'synthetic', 'false') <> 'true'
      and lower(coalesce(u.email, '')) not like '%@test.coasterrank.dev'
  ),
  ranked as (
    select ur.user_id, ur.coaster_id, ur.rank,
           count(*) over (partition by ur.user_id) as n
    from public.user_rides ur
    join eligible_users eu on eu.id = ur.user_id
    where ur.rank is not null
  ),
  pairs as (
    select a.coaster_id as winner,
           b.coaster_id as loser,
           power(
             (a.n::double precision * (a.n - 1) / 2)
               + greatest(floor_pairs, 0)::double precision,
             -least(greatest(gamma, 0), 1)
           )
           * case
               when coalesce(ramp_k, 0) > 0
                 then a.n::double precision / (a.n + ramp_k)
               else 1.0
             end as pair_weight
    from ranked a
    join ranked b
      on a.user_id = b.user_id
     and a.coaster_id <> b.coaster_id
     and a.rank < b.rank
  )
  select winner, loser, sum(pair_weight)::double precision, count(*)
  from pairs
  group by winner, loser;
$$;

create or replace function public.pairwise_wins()
returns table (winner uuid, loser uuid, weight double precision, wins bigint)
language sql
stable
security definer
set search_path = public
as $$
  select * from public.pairwise_wins_custom(0.5, 28, 0);
$$;

revoke execute on function public.pairwise_wins_custom(double precision, integer, integer)
  from public, anon, authenticated;
revoke execute on function public.pairwise_wins() from public, anon, authenticated;
grant execute on function public.pairwise_wins_custom(double precision, integer, integer)
  to service_role;
grant execute on function public.pairwise_wins() to service_role;

-- Remove the scaffolding (deferred until after the function restore so a
-- failure leaves the production body in place).
drop trigger if exists trg_bench_dirty_insert on public.user_rides;
drop trigger if exists trg_bench_dirty_update on public.user_rides;
drop trigger if exists trg_bench_dirty_delete on public.user_rides;
drop function if exists bench.mark_user_dirty();
drop function if exists bench.maintain_pairs();
drop table if exists bench.user_pairs;
drop table if exists bench.dirty_users;
