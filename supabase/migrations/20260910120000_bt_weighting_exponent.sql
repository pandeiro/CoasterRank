-- BT weighting v2 (PLAN §5.1, decision log 2026-09-10): replace the flat
-- per-rider equalization (each rider = 1.0 total influence, per-pair weight
-- 1/(n(n-1)/2)) with an evidence-scaled weight:
--
--   w = (P + c)^(−γ) × ramp,   P = n(n-1)/2 (the rider's pairwise count)
--
-- Production constants (γ = 0.5, c = 28, no ramp):
--   γ = 0.5 — a rider's TOTAL influence grows ~linearly with list length
--     (√P ≈ n/√2) instead of staying flat, while any single opinion stays
--     bounded (no n² blowout; a spam list cannot out-weigh the community).
--   c = 28 — soft floor: every list is treated as carrying 28 phantom
--     comparison pairs (≈ an 8-coaster list's worth), damping the per-opinion
--     weight of very short lists. A 2-item list's lone opinion weighs
--     1/√(1+28) ≈ 0.19 instead of 1.0 — previously one such opinion equalled
--     the ENTIRE anchor budget (a = 1), which let a 5-ride user supply
--     99.5–100% of the edge weight on every pair they touched and decide the
--     global #1/#2 outright.
--
-- Why not keep γ = 1: per-rider equalization means per-comparison influence
-- is wildly unequal (a 5-list rider's opinion of one pair outweighed a
-- 90-list rider's opinion of the same pair ~450×), it rewards ranking fewer
-- coasters (top-pick win-weight 2/n is maximized at the minimum list), and
-- simulation shows sparse-tail distortion GROWS with community size.
--
-- Structure:
--   pairwise_wins_custom(gamma, floor_pairs, ramp_k) — parameterized variant;
--     called by the admin compare-weightings Edge Function for ad-hoc
--     alternative-weighting comparisons. Never persists anything.
--   pairwise_wins() — same zero-arg signature the cron path and the
--     recompute-rankings Edge Function already call; now delegates to the
--     variant with the production constants. No caller changes needed.

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
           -- (P + floor)^(−γ), optionally ramped by list length n/(n+ramp_k).
           -- γ is clamped to [0,1] and floors to ≥0 defensively; the Edge
           -- Function validates before calling.
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

-- Production default: evidence-weighted (γ=0.5) with soft floor (c=28).
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
