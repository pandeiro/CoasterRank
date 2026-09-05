-- Board meta for the homepage status line + "Last ranked" popunder, exposed
-- as one RPC callable with the anon key (the /api/ranking worker holds no
-- service credentials):
--   * real_user_count — profiles where is_admin = false, minus synthetic users.
--     Synthetic markers mirror scripts/src/testride/markers.ts:
--     (raw_user_meta_data->>'synthetic') = 'true' OR email on the synthetic
--     test domain. Pure aggregate — leaks nothing per-row.
--   * last_recomputed_at — latest successful pg_cron recompute from
--     cron_execution_logs. That table is admin-only RLS; security definer is
--     what lets the anon caller read this single timestamp without opening it.
--     (coaster_ratings.updated_at is NOT usable: the recompute upsert never
--     writes it, so it keeps the row's first-insert value.)
-- Grant pattern mirrors ranked_user_count() (20260829204443_rankings_view_v2).

create or replace function public.public_board_meta()
returns table (real_user_count bigint, last_recomputed_at timestamptz)
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
      select created_at
      from public.cron_execution_logs
      where status = 'success'
      order by created_at desc
      limit 1
    );
$$;

revoke execute on function public.public_board_meta() from public, anon, authenticated;
grant execute on function public.public_board_meta() to anon, authenticated;
