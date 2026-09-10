-- Multi-manufacturer lineage, part 3: rider share cards + submission payloads.
--
-- 1. public_rider_page(): each ride gains `manufacturer_names` (the full
--    ordered lineage, canonical order position asc / added_at desc — same
--    rule the sync_primary_manufacturer trigger and the rankings view use).
--    The OG spotlight's TOP BUILDER now credits EVERY lineage manufacturer
--    (e.g. a Top Thrill 2 ride counts toward Zamperla, not just Intamin);
--    `manufacturer_name` stays the primary, unchanged for existing readers.
--    Public catalog data only; the function's no-existence-leak contract is
--    unchanged.
--
-- 2. submission_payload_valid(): allowlists `manufacturer_ids` — a JSON
--    array of well-formed uuid strings (the full lineage a submitter
--    proposes; approval REPLACES the coaster's lineage with it). The legacy
--    single `manufacturer_id` key stays accepted; the client normalizes it
--    to a one-element list at approval time. Bounded at 10 entries so a
--    hostile payload cannot wedge the queue UI; an empty array is valid and
--    means "propose no manufacturers" (clears the lineage on approval).
--    The function is replaced in place (same signature), so the CHECK
--    constraint and its grants survive; every pre-existing row remains
--    valid under the relaxed rules.

-- ── 1. public_rider_page: lineage on every ride ────────────────────────────
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
      coalesce(
        (select array_agg(m2.name order by cm.position asc, cm.added_at desc, m2.name asc)
         from public.coaster_manufacturers cm
         left join public.manufacturers m2 on m2.id = cm.manufacturer_id
         where cm.coaster_id = c.id),
        '{}'
      ) as manufacturer_names,
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

-- ── 2. payload validator: allowlist manufacturer_ids ───────────────────────
create or replace function public.submission_payload_valid(
  p_kind submission_kind,
  p_fields jsonb
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_typeof(p_fields) = 'object', false)
    -- key shape per kind
    and (
      (p_kind = 'new'
        and p_fields ?& array['height_m', 'speed_kmh', 'length_m', 'inversions', 'material']
        and not exists (
          select 1
          from jsonb_object_keys(p_fields) as new_key
          where new_key not in (
            'height_m', 'speed_kmh', 'length_m', 'inversions', 'material',
            'manufacturer_id', 'manufacturer_ids', 'status', 'model', 'type', 'opening_date'
          )
        ))
      or
      (p_kind = 'edit'
        and not exists (
          select 1
          from jsonb_object_keys(p_fields) as edit_key
          where edit_key not in (
            'height_m', 'speed_kmh', 'length_m', 'inversions', 'material',
            'manufacturer_id', 'manufacturer_ids', 'status', 'model', 'type', 'opening_date', 'name'
          )
        ))
    )
    -- numeric stats: absent (missing key or JSON null) or a sane magnitude.
    -- Bounds have wide headroom over real records (tallest ~139 m, fastest
    -- ~240 km/h, longest ~2479 m, most inversions 14) to catch fat-fingers
    -- and hostile values without rejecting legitimate outliers.
    and (p_fields->>'height_m' is null
      or (p_fields->>'height_m' ~ '^[0-9]+(\.[0-9]+)?$'
        and (p_fields->>'height_m')::numeric between 0 and 500))
    and (p_fields->>'speed_kmh' is null
      or (p_fields->>'speed_kmh' ~ '^[0-9]+(\.[0-9]+)?$'
        and (p_fields->>'speed_kmh')::numeric between 0 and 500))
    and (p_fields->>'length_m' is null
      or (p_fields->>'length_m' ~ '^[0-9]+(\.[0-9]+)?$'
        and (p_fields->>'length_m')::numeric between 0 and 10000))
    and (p_fields->>'inversions' is null
      or (p_fields->>'inversions' ~ '^[0-9]+$'
        and (p_fields->>'inversions')::numeric between 0 and 30))
    and (p_fields->>'material' is null
      or p_fields->>'material' in ('steel', 'wood', 'hybrid', 'other'))
    -- legacy single manufacturer (uuid) — kept so older pending submissions
    -- and older clients stay valid.
    and (p_fields->>'manufacturer_id' is null
      or (jsonb_typeof(p_fields->'manufacturer_id') = 'string'
        and p_fields->>'manufacturer_id' ~* (
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        )))
    -- proposed lineage: array of well-formed uuids (≤ 10; empty = clear).
    -- Rejection is silent but loud enough — the CHECK just refuses the row.
    and (p_fields->>'manufacturer_ids' is null
      or (jsonb_typeof(p_fields->'manufacturer_ids') = 'array'
        and jsonb_array_length(p_fields->'manufacturer_ids') between 0 and 10
        and not exists (
          select 1
          from jsonb_array_elements_text(p_fields->'manufacturer_ids') as lineage_id
          where lineage_id !~* (
            '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          )
        )))
    -- descriptive scalars (kind='new' may now send these too)
    and (p_fields->>'status' is null
      or p_fields->>'status' in (
        'operating', 'defunct', 'sbno', 'under_construction', 'relocated', 'unknown'
      ))
    and (p_fields->>'model' is null
      or (jsonb_typeof(p_fields->'model') = 'string'
        and char_length(p_fields->>'model') between 1 and 120))
    and (p_fields->>'type' is null
      or (jsonb_typeof(p_fields->'type') = 'string'
        and char_length(p_fields->>'type') between 1 and 120))
    and (p_fields->>'name' is null
      or (jsonb_typeof(p_fields->'name') = 'string'
        and char_length(p_fields->>'name') between 1 and 120))
    and (p_fields->>'opening_date' is null
      -- Month/day ranges are bounded; impossible calendar dates (e.g. Feb 30)
      -- fail the cast and abort the statement — still a rejection, just loud.
      or (p_fields->>'opening_date' ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
        and (p_fields->>'opening_date')::date between '1800-01-01' and '2100-01-01'))
$$;
