-- Public rider share pages: /riders/<username> (PLAN §10 Phase 9).
--
-- Decision: public sharing is OPT-IN. The underlying tables stay exactly as
-- private as before — profiles and user_rides keep their owner-only RLS. The
-- ONLY new public read surface is public_rider_page(), a narrowly-scoped
-- SECURITY DEFINER function that returns data exclusively for profiles with
-- public_list = true. It never exposes email, user id, is_admin, or
-- ridden-but-unranked rides.

-- Opt-in flag. Default false: nobody's page goes live without action.
alter table public.profiles
  add column public_list boolean not null default false;

-- Per-rider share card (1200x630 PNG), generated client-side on the profile
-- page (canvas) and uploaded to the public avatars bucket at <uid>/og-card.png.
-- NULL = no custom card yet; consumers fall back to the static /og-default.png.
alter table public.profiles
  add column og_image_url text;

-- Column grants are a whitelist, not cumulative lists — add the new columns so
-- the owner can flip the toggle and store their card URL from the profile page.
grant update (public_list, og_image_url) on public.profiles to authenticated;

-- Case-insensitive username lookup for the public hot path.
create index profiles_lower_username_idx on public.profiles (lower(username));

-- One round-trip: rider identity + ranked list (coaster + park join data).
-- Returns NULL when no user matches / has not opted in, so callers treat
-- "not found" and "not shared" identically (no existence leak).
create or replace function public.public_rider_page(p_username text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with rider as (
    select id, username, display_name, avatar_url, og_image_url, created_at
    from public.profiles
    where public_list
      and username is not null
      and lower(username) = lower(p_username)
    limit 1
  ),
  rides as (
    select
      r.coaster_id,
      r.rank,
      c.name,
      c.slug,
      c.material,
      c.status,
      pk.name as park_name,
      pk.slug as park_slug,
      rt.score
    from rider u
    join public.user_rides r
      on r.user_id = u.id and r.rank is not null
    join public.coasters c on c.id = r.coaster_id
    left join public.parks pk on pk.id = c.park_id
    left join public.coaster_ratings rt on rt.coaster_id = c.id
    order by r.rank asc
    limit 1000
  )
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'username',     u.username,
      'display_name', u.display_name,
      'avatar_url',   u.avatar_url,
      'og_image_url', u.og_image_url,
      'member_since', u.created_at
    ),
    'rides', coalesce(
      (select jsonb_agg(to_jsonb(x) order by x.rank) from rides x),
      '[]'::jsonb
    )
  )
  from rider u;
$$;

-- Functions get EXECUTE for PUBLIC by default; tighten to the two Data API
-- roles that should ever call this, then re-grant explicitly.
revoke execute on function public.public_rider_page(text) from public;
grant execute on function public.public_rider_page(text) to anon, authenticated;

comment on function public.public_rider_page(text) is
  'Public read model for /riders/<username>. Only returns data for profiles '
  || 'with public_list = true, never exposes email, user id, is_admin, or '
  || 'unranked rides. NULL result = unknown user OR sharing disabled.';
