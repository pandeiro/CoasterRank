-- Submitter note + expanded submission payloads.
--
-- 1. `note`: free-text context the submitter attaches to EITHER submission
--    kind — explanations, corrections, evidence links (RCDB, park site), etc.
--    Reviewer-facing metadata only; it never lands on the coaster row itself.
--    Bounded (1–2000 chars after trim) so the queue and Telegram ping stay
--    readable.
--
-- 2. New-coaster submissions (kind='new') may now also carry the descriptive
--    fields the suggest-edit flow already supported (manufacturer_id, status,
--    model, type, opening_date), so a submitter can propose a complete
--    record instead of stats only. kind='edit' gains manufacturer_id, which
--    was deliberately absent before. The five stat keys stay REQUIRED for
--    kind='new' (the client always sends them, null = not suggested).
--
--    The payload validator is replaced in place (same signature, so the
--    CHECK constraint and its grants survive); it re-evaluates on write and
--    every pre-existing row remains valid under the relaxed key rules.

-- ── 1. note column ─────────────────────────────────────────────────────────
alter table public.coaster_submissions
  add column note text;

comment on column public.coaster_submissions.note is
  'Submitter-supplied context for the reviewer: explanation, evidence links, etc. Never applied to the coaster row.';

alter table public.coaster_submissions
  add constraint coaster_submissions_note_check
    check (note is null or char_length(trim(note)) between 1 and 2000);

-- ── 2. payload validator: extended key set + manufacturer_id ───────────────
-- Per kind:
--   new:  must include the five stat keys; no keys outside the extended set
--         (stats + manufacturer_id/status/model/type/opening_date)
--   edit: keys ⊆ the editable scalar set (now including manufacturer_id)
-- Value rules are kind-agnostic and now cover manufacturer_id (uuid shape).
-- All operators are IMMUTABLE, so the function can keep backing the CHECK.
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
            'manufacturer_id', 'status', 'model', 'type', 'opening_date'
          )
        ))
      or
      (p_kind = 'edit'
        and not exists (
          select 1
          from jsonb_object_keys(p_fields) as edit_key
          where edit_key not in (
            'height_m', 'speed_kmh', 'length_m', 'inversions', 'material',
            'manufacturer_id', 'status', 'model', 'type', 'opening_date', 'name'
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
    and (p_fields->>'manufacturer_id' is null
      or (jsonb_typeof(p_fields->'manufacturer_id') = 'string'
        and p_fields->>'manufacturer_id' ~* (
          '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
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

-- ── 3. Telegram ping carries the note ──────────────────────────────────────
-- Same trigger, same kill-switch; the note is the fastest way for a reviewer
-- to see the submitter's evidence without opening the admin queue.
create or replace function public.trigger_notify_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_username text;
  v_park_name text;
  v_body text;
begin
  if new.submitted_by is not null then
    select email into v_email
    from auth.users
    where id = new.submitted_by;

    if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
      return new;
    end if;

    select username into v_username
    from public.profiles
    where id = new.submitted_by;

    v_username := coalesce(v_username, split_part(v_email, '@', 1), 'unknown');
  else
    v_username := 'unknown';
  end if;

  if new.park_id is not null then
    select name into v_park_name
    from public.parks
    where id = new.park_id;
  end if;
  v_park_name := coalesce(v_park_name, new.park_name, 'unknown park');

  v_body := case when new.kind = 'edit'
    then '✏️ Edit suggestion: "' || new.coaster_name || '" @ ' || v_park_name || ' — by @' || v_username
    else '📝 Submission: "' || new.coaster_name || '" @ ' || v_park_name || ' — by @' || v_username
  end;
  if new.note is not null and trim(new.note) <> '' then
    v_body := v_body || E'\n🗒 ' || left(new.note, 500);
  end if;

  perform public.send_telegram_event('submission_events', v_body);

  return new;
end;
$$;
