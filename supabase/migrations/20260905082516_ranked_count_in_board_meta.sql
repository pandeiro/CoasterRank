-- Ranked-user count for the first-place visibility gate, folded into the
-- already-cached /api/ranking payload (see board-types RankingBoardPayload).
-- The homepage previously called ranked_user_count() as a separate RPC per
-- page load; the data is now part of public_board_meta() so the board needs
-- only one edge-cached fetch. The standalone ranked_user_count() function is
-- retained (no drop) for backwards compat during the rollout.
--
-- real_user_count  — existing: all real profiles (excludes admins/synthetic).
-- ranked_user_count — NEW: distinct real users with at least one ranked ride
--   (rank is not null), same synthetic/admin exclusions as real_user_count.
--   Gated (>30) for the coral first-place pill (FIRST_PLACE_MIN_USERS).
-- Both are pure aggregates — no per-user rows leak via the anon-executable RPC.
--
-- NOTE: this migration initially deployed FAILED (both 2026-09-05 runs,
-- PRs #132 and #137): Postgres refuses `create or replace function` when the
-- return type changes (SQLSTATE 42P13) — the function existed from
-- board_meta_rpc with the 2-column signature. DROP first; it is a pure
-- aggregate RPC (no state), so the drop/recreate window is harmless, and the
-- grants below re-apply immediately.

drop function if exists public.public_board_meta();

create or replace function public.public_board_meta()
returns table (real_user_count bigint, ranked_user_count bigint, last_recomputed_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select
    (
      select count(*)
      from public.profiles p
      join auth.users u on u.id = p.id
      where p.is_admin = false
        and coalesce(u.raw_user_meta_data->>'synthetic', 'false') <> 'true'
        and lower(coalesce(u.email, '')) not like '%@test.coasterrank.dev'
    ),
    (
      select count(distinct ur.user_id)
      from public.user_rides ur
      join public.profiles p on p.id = ur.user_id
      join auth.users u on u.id = ur.user_id
      where ur.rank is not null
        and p.is_admin = false
        and coalesce(u.raw_user_meta_data->>'synthetic', 'false') <> 'true'
        and lower(coalesce(u.email, '')) not like '%@test.coasterrank.dev'
    ),
    (
      select created_at
      from public.cron_execution_logs
      where status = 'success'
      order by created_at desc
      limit 1
    );
$$;

revoke execute on function public.public_board_meta() from public, anon, authenticated;
grant execute on function public.public_board_meta() to anon, authenticated;
