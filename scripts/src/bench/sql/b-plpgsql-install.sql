-- BENCH-ONLY (staging project) — Approach B: move the whole pair pipeline
-- (aggregation + Bradley-Terry MM fit) into Postgres so nothing but the
-- fitted board crosses the PostgREST gateway. NOT a migration; applied by the
-- bench harness via psql.
--
-- The platform enforces an ~8s statement timeout per PostgREST call, and a
-- plpgsql CALL is one statement — so the fit SPLITS across three RPCs the
-- forked Edge Function drives:
--
--   bench_fit_begin()   aggregation into persistent bench.fit_* tables
--                       (warm-starts scores from the current board)
--   bench_fit_step(k)   up to k MM iterations per call (real state, resumable)
--   bench_fit_rows()    fitted rows + diagnostics (tiny payload)
--
-- The MM is a faithful port of packages/bt/src/mm.ts (Hunter 2004,
-- simultaneous/Jacobi update): a=1 anchor, λ=0.5 L2, ε=1e-8 max |Δ log score|,
-- cap 500 iterations, 1e-12 score floor. Warm-start (SCALE.md option 4)
-- converges the steady-state in ~1-3 iterations; the fixed point is identical
-- (checked by `bench parity`).
create schema if not exists bench;

create table if not exists bench.fit_pairs (
  winner uuid, loser uuid, weight double precision, wins bigint
);
create table if not exists bench.fit_opp (
  a uuid, b uuid, n double precision, wins bigint
);
create table if not exists bench.fit_scores (
  coaster_id uuid primary key,
  score double precision not null,
  w double precision not null,
  comparisons bigint not null,
  wins bigint not null,
  new_score double precision
);
create table if not exists bench.fit_state (
  id integer primary key default 1,
  iterations integer not null default 0,
  converged boolean not null default false,
  ready boolean not null default false
);
-- one shared state row
insert into bench.fit_state (id) values (1) on conflict (id) do nothing;

-- 1a. Dirty-user maintenance hook. No-op in the plain b-plpgsql variant (no
--     dirty machinery); the ab-combined variant overrides this to run
--     bench.maintain_pairs() (processes only users who changed).
create or replace function public.bench_fit_maintain() returns void
language plpgsql
volatile
security definer
set search_path = public, bench
as $$
begin
  null;
end;
$$;

-- 1b. Aggregation: the exact production pair query (γ = 0.5, c = 28), plus the
--    sparse opponent structure (both directions carry the pair's weight —
--    matching computeRankings()'s opponents map) and per-coaster aggregates.
--    The ab-combined variant overrides this to aggregate bench.user_pairs
--    (maintained incrementally) instead of re-joining user_rides.
create or replace function public.bench_fit_agg() returns void
language plpgsql
volatile
security definer
set search_path = public, bench
as $$
begin
  truncate bench.fit_pairs;
  truncate bench.fit_opp;
  truncate bench.fit_scores;

  insert into bench.fit_pairs (winner, loser, weight, wins)
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
               (a.n::double precision * (a.n - 1) / 2) + 28::double precision,
               -0.5
             ) as weight
      from ranked a
      join ranked b
        on a.user_id = b.user_id
       and a.coaster_id <> b.coaster_id
       and a.rank < b.rank
    )
    select winner, loser, sum(weight)::double precision, count(*)::bigint
    from pairs
    group by winner, loser;

  insert into bench.fit_opp (a, b, n, wins)
    select winner, loser, weight, wins from bench.fit_pairs
    union all
    select loser, winner, weight, wins from bench.fit_pairs;

  -- Warm start: previous board score where present, else 1.0.
  insert into bench.fit_scores (coaster_id, score, w, comparisons, wins, new_score)
    select
      o.coaster_id,
      coalesce(prev.score, 1.0)::double precision,
      coalesce(w.w, 0)::double precision,
      o.raw,
      coalesce(w.raw_wins, 0)::bigint,
      null::double precision
    from (
      select a as coaster_id, sum(wins)::bigint as raw
      from bench.fit_opp
      group by a
    ) o
    left join (
      select winner, sum(weight)::double precision as w, sum(wins)::bigint as raw_wins
      from bench.fit_pairs
      group by winner
    ) w on w.winner = o.coaster_id
    left join public.coaster_ratings prev on prev.coaster_id = o.coaster_id;

  update bench.fit_state set iterations = 0, converged = false, ready = true where id = 1;
end;
$$;

-- 2. Up to p_max MM iterations per call. Each statement inside stays well
--    under the statement timeout; the fork calls this repeatedly until done.
create or replace function public.bench_fit_step(p_max integer default 25)
returns table (done boolean)
language plpgsql
volatile
security definer
set search_path = public, bench
as $$
#variable_conflict use_column
declare
  v_delta double precision;
  v_done boolean := false;
  v_iter_in_call integer := 0;
begin
  if not exists (select 1 from bench.fit_scores) then
    update bench.fit_state set converged = true, ready = true where id = 1;
    return query select true;
  end if;

  loop
    update bench.fit_scores s
    set new_score = t.new_score
    from (
      select
        s0.coaster_id,
        greatest(
          (s0.w + 0.5 + 0.5) /
            (0.5 + 1.0 / (s0.score + 1.0) + coalesce(o.opp, 0)),
          1e-12
        ) as new_score
      from bench.fit_scores s0
      left join (
        select b.a, sum(b.n / (o1.score + o2.score)) as opp
        from bench.fit_opp b
        join bench.fit_scores o1 on o1.coaster_id = b.a
        join bench.fit_scores o2 on o2.coaster_id = b.b
        group by b.a
      ) o on o.a = s0.coaster_id
    ) t
    where s.coaster_id = t.coaster_id;

    select max(abs(ln(s.new_score / s.score))) into v_delta from bench.fit_scores s;
    update bench.fit_scores set score = new_score, new_score = null where true;

    update bench.fit_state
    set iterations = iterations + 1,
        converged = (v_delta is null or v_delta < 1e-8)
    where id = 1;

    v_iter_in_call := v_iter_in_call + 1;
    select (converged or iterations >= 500) into v_done from bench.fit_state where id = 1;
    exit when v_done or v_iter_in_call >= coalesce(greatest(p_max, 1), 25);
  end loop;

  return query select v_done;
end;
$$;

-- 3. Fitted rows (the fork maps these onto the same upserts as the JS path).
create or replace function public.bench_fit_rows()
returns table (
  coaster_id uuid,
  score double precision,
  comparisons bigint,
  wins bigint,
  iterations integer,
  converged boolean
)
language sql
volatile
security definer
set search_path = public, bench
as $$
  select s.coaster_id, s.score, s.comparisons, s.wins, st.iterations, st.converged
  from bench.fit_scores s
  cross join bench.fit_state st
  where st.id = 1 and st.ready
  order by s.score desc;
$$;

-- Kept for the `bench parity` command: maintain + aggregate + fit-to-completion
-- in one call (works under psql/parity, where no per-request timeout applies).
create or replace function public.bench_recompute_plpgsql()
returns table (
  coaster_id uuid,
  score double precision,
  comparisons bigint,
  wins bigint,
  iterations integer,
  converged boolean
)
language plpgsql
volatile
security definer
set search_path = public, bench
as $$
begin
  perform public.bench_fit_maintain();
  perform public.bench_fit_agg();
  while not (select done from public.bench_fit_step(25)) loop
    null;
  end loop;
  return query select * from public.bench_fit_rows();
end;
$$;

grant execute on function public.bench_fit_maintain() to service_role;
grant execute on function public.bench_fit_agg() to service_role;
grant execute on function public.bench_fit_step(integer) to service_role;
grant execute on function public.bench_fit_rows() to service_role;
grant execute on function public.bench_recompute_plpgsql() to service_role;
