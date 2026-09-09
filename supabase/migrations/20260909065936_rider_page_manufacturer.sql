-- Rider OG cards: expose the coaster manufacturer on public_rider_page rides.
--
-- The recomposed rider share card spotlights TOP PARK + TOP BUILDER. Park was
-- already derivable (park_name); manufacturer was not — the RPC only returned
-- `material`. This adds `manufacturer_name` (LEFT JOIN, NULL when unknown) so
-- the worker can compute the rider's most-ridden builder without a second
-- round trip. Manufacturer names are public catalog data (no privacy impact;
-- the function's no-existence-leak contract is unchanged).
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
      m.name as manufacturer_name,
      rt.score
    from rider u
    join public.user_rides r
      on r.user_id = u.id and r.rank is not null
    join public.coasters c on c.id = r.coaster_id
    left join public.parks pk on pk.id = c.park_id
    left join public.manufacturers m on m.id = c.manufacturer_id
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
