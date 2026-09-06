-- Submission edits + trust surfacing.
--
-- Extends coaster_submissions with a kind discriminator so users can suggest
-- edits to existing coasters (not just propose new ones), and adds a
-- seen-by-submitter marker so reviewed outcomes can be badged as "new".
--
-- DEPENDENCY: merge the security-hardening PR (#145,
-- 20260906120000_security_hardening.sql) FIRST. That migration adds
-- coaster_submissions_suggested_fields_keys_check, which cannot express edit
-- payloads — this migration drops it (IF EXISTS, so it is also safe if #145
-- has not landed yet) and replaces it with the kind-aware
-- coaster_submissions_payload_check below. If this migration ever runs before
-- #145, #145's migration will fail on edit rows / block future edits, so the
-- merge order matters.
--
-- NOTE: prod coaster_submissions is empty (verified 2026-09-06), so no
-- backfill is needed; the kind default ('new') covers any dev rows.

-- ── 1. kind discriminator + edit target + seen marker ──────────────────────
create type submission_kind as enum ('new', 'edit');

alter table public.coaster_submissions
  add column kind submission_kind not null default 'new',
  add column coaster_id uuid references public.coasters (id) on delete set null,
  add column seen_by_submitter_at timestamptz;

create index coaster_submissions_coaster_idx
  on public.coaster_submissions (coaster_id)
  where coaster_id is not null;

comment on column public.coaster_submissions.kind is
  'new = propose a coaster not in the catalog; edit = suggest changes to coaster_id';
comment on column public.coaster_submissions.coaster_id is
  'Edit target. NULL for kind=new. Park changes ride on park_id/park_name; scalar diffs ride on suggested_fields.';
comment on column public.coaster_submissions.seen_by_submitter_at is
  'Set when the submitter has viewed the reviewed outcome (drives the "new result" badge).';

-- ── 2. kind-aware payload validator (C-01 follow-up) ───────────────────────
-- The audit's key allowlist (subset of the five stat keys) is necessary but
-- not sufficient: it permits hostile VALUES (wrong types, absurd magnitudes)
-- and cannot express edit payloads. This validator enforces, per kind:
--   new:  exactly the five canonical stat keys (null = not suggested)
--   edit: keys ⊆ the editable scalar set (park moves ride on
--         park_id/park_name, never inside suggested_fields)
-- plus per-key type/range checks. All operators used (~, casts guarded by
-- regex, jsonb accessors) are IMMUTABLE, so the function can back a CHECK.
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
        and (select count(*) from jsonb_object_keys(p_fields)) = 5)
      or
      (p_kind = 'edit'
        and not exists (
          select 1
          from jsonb_object_keys(p_fields) as edit_key
          where edit_key not in (
            'height_m', 'speed_kmh', 'length_m', 'inversions', 'material',
            'status', 'model', 'type', 'opening_date', 'name'
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
    -- edit-only scalars
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

revoke execute on function public.submission_payload_valid(submission_kind, jsonb)
  from public, anon;
grant execute on function public.submission_payload_valid(submission_kind, jsonb)
  to authenticated;

-- Replace the audit's new-only allowlist with the kind-aware check. The audit
-- helper is kept (harmless, and #145's rollback story stays intact).
alter table public.coaster_submissions
  drop constraint if exists coaster_submissions_suggested_fields_keys_check,
  add constraint coaster_submissions_payload_check
    check (public.submission_payload_valid(kind, suggested_fields));

-- ── 3. submitter "seen" marker (security-definer; owners have no UPDATE) ───
-- Submitters cannot UPDATE their rows (admin-only update policy), so a tiny
-- RPC marks their own reviewed outcomes as seen. It touches only the caller's
-- rows that have been reviewed and not yet seen — nothing else is writable.
create or replace function public.mark_own_submissions_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.coaster_submissions
  set seen_by_submitter_at = now()
  where submitted_by = auth.uid()
    and reviewed_at is not null
    and seen_by_submitter_at is null;
$$;

revoke execute on function public.mark_own_submissions_seen() from public, anon;
grant execute on function public.mark_own_submissions_seen() to authenticated;

-- ── 4. kind-aware Telegram notification ────────────────────────────────────
-- Same trigger, same kill-switch; edit suggestions get their own prefix so
-- reviewers can tell them apart at a glance in the channel.
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

  perform public.send_telegram_event(
    'submission_events',
    case when new.kind = 'edit'
      then '✏️ Edit suggestion: "' || new.coaster_name || '" @ ' || v_park_name || ' — by @' || v_username
      else '📝 Submission: "' || new.coaster_name || '" @ ' || v_park_name || ' — by @' || v_username
    end
  );

  return new;
end;
$$;
