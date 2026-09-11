-- Submitters can propose what doesn't exist yet (yet another rung on the
-- "widen the payload guard" ladder):
--
-- 1. proposed_manufacturers: a JSON array of {name, position} objects —
--    manufacturers NOT yet in the catalog that the submitter proposes to add
--    to the coaster's lineage. `position` is the index in the MERGED lineage
--    (0 = primary), interleaved with the existing manufacturer_ids, so a
--    proposed manufacturer can be primary without admin fix-up. Bounded so a
--    hostile payload cannot wedge the queue: ids + proposals ≤ 10 entries,
--    names 1–80 chars, positions 0–9 and unique. Approval creates the
--    manufacturers (slugified, race-safe like community parks) and merges
--    them into the lineage at the proposed positions.
--
-- 2. park_location: {city, region, country, lat, lng} (all optional) —
--    location metadata for a park that does not exist yet. Only valid when
--    park_id IS NULL (the free-text "new park" path); a submission homing to
--    an existing park cannot smuggle location for it. Approval writes the
--    fields onto the community park it creates (previously bare name+slug).
--
-- Both keys are allowed for kind='new' AND kind='edit'. The function gains a
-- park_id parameter so the CHECK can enforce the null-park rule at the row
-- level; the constraint is dropped and re-added with the 3-arg call. The
-- rules stay strictly additive (every pre-existing valid row remains valid),
-- so the constraint re-validation on restore keeps passing.

create or replace function public.submission_payload_valid(
  p_kind submission_kind,
  p_park_id uuid,
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
            'manufacturer_id', 'manufacturer_ids', 'status', 'model', 'type', 'opening_date',
            'proposed_manufacturers', 'park_location'
          )
        ))
      or
      (p_kind = 'edit'
        and not exists (
          select 1
          from jsonb_object_keys(p_fields) as edit_key
          where edit_key not in (
            'height_m', 'speed_kmh', 'length_m', 'inversions', 'material',
            'manufacturer_id', 'manufacturer_ids', 'status', 'model', 'type', 'opening_date', 'name',
            'proposed_manufacturers', 'park_location'
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
    -- existing-manufacturer lineage: array of well-formed uuids. The 0–10
    -- bound stays, but when proposals ride along the COMBINED count (ids +
    -- proposed entries) must also fit the lineage cap — see below.
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
    -- proposed NEW manufacturers: [{name, position}, …]. Each entry is an
    -- object with exactly the keys name (1–80 chars after trim) and position
    -- (integer 0–9, < ids + proposals); positions are unique; ids + proposals
    -- ≤ 10 so the merged lineage fits the cap. positions encode the slot in
    -- the merged lineage — approval interleaves ids and proposals by position.
    and (p_fields->'proposed_manufacturers' is null
      or (
        jsonb_typeof(p_fields->'proposed_manufacturers') = 'array'
        and jsonb_array_length(p_fields->'proposed_manufacturers') between 1 and 10
        and (p_fields->'manufacturer_ids' is null
          or jsonb_array_length(p_fields->'manufacturer_ids')
            + jsonb_array_length(p_fields->'proposed_manufacturers') between 0 and 10)
        and not exists (
          select 1
          from jsonb_array_elements(p_fields->'proposed_manufacturers') as pm
          where jsonb_typeof(pm) <> 'object'
            or not (pm ? 'name')
            or jsonb_typeof(pm->'name') <> 'string'
            or char_length(btrim(pm->>'name')) not between 1 and 80
            or not (pm ? 'position')
            or jsonb_typeof(pm->'position') <> 'number'
            or (pm->>'position')::numeric <> trunc((pm->>'position')::numeric)
            or (pm->>'position')::numeric not between 0 and 9
            or (pm->>'position')::numeric
              >= (case
                    when jsonb_typeof(p_fields->'manufacturer_ids') = 'array'
                      then jsonb_array_length(p_fields->'manufacturer_ids')
                    else 0
                  end)
                + jsonb_array_length(p_fields->'proposed_manufacturers')
            or exists (
              select 1
              from jsonb_object_keys(pm) as pm_key
              where pm_key not in ('name', 'position')
            )
        )
        and (
          select count(distinct pm->>'position')
          from jsonb_array_elements(p_fields->'proposed_manufacturers') as pm
        ) = jsonb_array_length(p_fields->'proposed_manufacturers')
      ))
    -- park location for a not-yet-existing park: only when park_id is null
    -- (free-text park name). Optional text fields trim to 1–120 chars;
    -- coordinates mirror the parks lat/lng check constraints. JSON null
    -- counts as "absent" for each field, matching the other optional keys.
    and (p_fields->'park_location' is null
      or (
        p_park_id is null
        and jsonb_typeof(p_fields->'park_location') = 'object'
        and (p_fields->'park_location' ?| array['city', 'region', 'country', 'lat', 'lng'])
        and not exists (
          select 1
          from jsonb_object_keys(p_fields->'park_location') as loc_key
          where loc_key not in ('city', 'region', 'country', 'lat', 'lng')
        )
        and (p_fields->'park_location'->>'city' is null
          or (jsonb_typeof(p_fields->'park_location'->'city') = 'string'
            and char_length(btrim(p_fields->'park_location'->>'city')) between 1 and 120))
        and (p_fields->'park_location'->>'region' is null
          or (jsonb_typeof(p_fields->'park_location'->'region') = 'string'
            and char_length(btrim(p_fields->'park_location'->>'region')) between 1 and 120))
        and (p_fields->'park_location'->>'country' is null
          or (jsonb_typeof(p_fields->'park_location'->'country') = 'string'
            and char_length(btrim(p_fields->'park_location'->>'country')) between 1 and 120))
        and (p_fields->'park_location'->>'lat' is null
          or (jsonb_typeof(p_fields->'park_location'->'lat') = 'number'
            and (p_fields->'park_location'->>'lat')::numeric between -90 and 90))
        and (p_fields->'park_location'->>'lng' is null
          or (jsonb_typeof(p_fields->'park_location'->'lng') = 'number'
            and (p_fields->'park_location'->>'lng')::numeric between -180 and 180))
      ))
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

revoke execute on function public.submission_payload_valid(submission_kind, uuid, jsonb)
  from public, anon;
grant execute on function public.submission_payload_valid(submission_kind, uuid, jsonb)
  to authenticated;

-- Re-bind the CHECK to the new 3-arg signature, then drop the superseded
-- 2-arg function (superseded only AFTER the constraint swap so the swap
-- itself always has a valid function to call).
alter table public.coaster_submissions
  drop constraint coaster_submissions_payload_check;
alter table public.coaster_submissions
  add constraint coaster_submissions_payload_check
    check (public.submission_payload_valid(kind, park_id, suggested_fields));

drop function public.submission_payload_valid(submission_kind, jsonb);
