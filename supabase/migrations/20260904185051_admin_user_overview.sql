-- Admin "Users" view backend (general-purpose successor to the Impersonate
-- tab's synthetic-only listing).
--
-- admin_user_overview(): one row per auth user with profile fields + activity
-- aggregates (rides, ranked rides, submissions made/reviewed). Security
-- definer so it can aggregate user_rides/coaster_submissions across all users
-- (RLS is owner-only) and read auth.users (authoritative created_at).
--
-- Execute is service_role ONLY: the admin-users Edge Function is the sole
-- caller. It validates the caller's admin JWT itself (GoTrue + profiles.
-- is_admin) before invoking this with the service key, mirroring
-- first_place_counts(). The RPC returns no emails — those come from GoTrue.
create or replace function public.admin_user_overview()
returns table (
  id uuid,
  username text,
  display_name text,
  avatar_url text,
  is_admin boolean,
  public_list boolean,
  created_at timestamptz,
  rides_total bigint,
  rides_ranked bigint,
  submissions_made bigint,
  submissions_reviewed bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with rides as (
    select user_id,
           count(*) as total,
           count(*) filter (where rank is not null) as ranked
    from public.user_rides
    group by user_id
  ),
  subs as (
    select submitted_by as user_id, count(*) as made
    from public.coaster_submissions
    group by submitted_by
  ),
  reviews as (
    select reviewed_by as user_id, count(*) as reviewed
    from public.coaster_submissions
    where reviewed_by is not null
    group by reviewed_by
  )
  select
    u.id,
    p.username,
    p.display_name,
    p.avatar_url,
    coalesce(p.is_admin, false),
    coalesce(p.public_list, false),
    u.created_at,
    coalesce(r.total, 0::bigint),
    coalesce(r.ranked, 0::bigint),
    coalesce(s.made, 0::bigint),
    coalesce(rv.reviewed, 0::bigint)
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join rides r on r.user_id = u.id
  left join subs s on s.user_id = u.id
  left join reviews rv on rv.user_id = u.id
  order by u.created_at desc;
$$;

revoke execute on function public.admin_user_overview() from public, anon, authenticated;
grant execute on function public.admin_user_overview() to service_role;
