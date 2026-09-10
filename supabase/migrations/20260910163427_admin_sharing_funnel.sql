-- Admin "Sharing" view backend — share-loop funnel over real (non-synthetic)
-- users: stage counts, current sharers, and the signup time series the SPA
-- overlays against Web Analytics shared-page traffic.
--
-- admin_sharing_funnel(): SECURITY DEFINER so it can aggregate user_rides
-- across all users (RLS is owner-only) and join auth.users (authoritative
-- created_at + the synthetic-user email marker, same filter as the Telegram
-- triggers and admin_user_overview()).
--
-- Execute is service_role ONLY: the admin-sharing-metrics Edge Function is the
-- sole caller. It validates the caller's admin JWT itself (GoTrue +
-- profiles.is_admin) before invoking this with the service key, mirroring
-- admin_user_overview(). Returns no emails.
--
-- Note: the funnel is cumulative STATE (no enable-event timestamps exist in
-- the DB — share opt-ins are only pushed to Telegram); PLAN §11 records that
-- deliberately. Nudge→enable conversion therefore reads "of users nudged so
-- far, how many share now", not a per-day series.
create or replace function public.admin_sharing_funnel()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with riders as (
    select
      p.id,
      p.username,
      p.public_list,
      p.share_nudge_shown_at,
      u.created_at,
      (
        select count(*) from public.user_rides r
        where r.user_id = p.id and r.rank is not null
      ) as ranked_count
    from public.profiles p
    join auth.users u on u.id = p.id
    where u.email is null
       or lower(u.email) not like '%@test.coasterrank.dev'
  )
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'total_users', count(*),
        'with_username', count(*) filter (where username is not null),
        'eligible', count(*) filter (where ranked_count >= 5),
        'nudged', count(*) filter (where share_nudge_shown_at is not null),
        'sharing_on', count(*) filter (where public_list)
      )
      from riders
    ),
    'sharers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'username', username,
          'ranked_count', ranked_count,
          'nudged', share_nudge_shown_at is not null
        )
        order by ranked_count desc, username asc
      )
      from riders
      where public_list and username is not null
    ), '[]'::jsonb),
    'signups_daily', (
      select jsonb_agg(jsonb_build_object('day', day, 'count', count) order by day)
      from (
        select (created_at at time zone 'utc')::date as day, count(*) as count
        from riders
        group by 1
      ) s
    )
  );
$$;

revoke execute on function public.admin_sharing_funnel() from public, anon, authenticated;
grant execute on function public.admin_sharing_funnel() to service_role;
