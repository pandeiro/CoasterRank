-- P1: submission_payload_valid() — moderation-queue JSON guard.
--
-- Pure IMMUTABLE SQL function (no roles needed); runs as postgres. Pins the
-- representative accept/reject matrix: key shape per kind, numeric bounds,
-- enum/uuid formats, lineage caps, proposed-manufacturer rules, park_location
-- null-park rule, scalar formats — plus the CHECK-constraint binding on
-- coaster_submissions, so a guard regression fails loudly at row level.
-- Self-contained.

BEGIN;

SELECT plan(24);

-- Fixture for the constraint-binding checks -----------------------------------
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES ('80808080-8080-4808-8808-808080808080', 'submitter@example.com', now(), '{"username":"submitter1"}');

-- Valid shapes ------------------------------------------------------------------
SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel"}'),
  true,
  'valid new payload with required keys passes'
);

SELECT is(
  public.submission_payload_valid('edit', NULL, '{"name":"Renamed Coaster","height_m":"100"}'),
  true,
  'valid edit payload with a subset passes'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":null,"speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel"}'),
  true,
  'JSON null counts as absent for optional numerics'
);

-- Key shape per kind --------------------------------------------------------------
SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel"}'),
  false,
  'new payload missing a required key fails'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel","nickname":"Bob"}'),
  false,
  'unknown key fails on new'
);

SELECT is(
  public.submission_payload_valid('edit', NULL, '{"name":"Renamed Coaster"}'),
  true,
  'edit allows the name key'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel","name":"New Coaster"}'),
  false,
  'new rejects the name key'
);

-- Numeric bounds --------------------------------------------------------------------
SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"139.5","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel"}'),
  true,
  'realistic outlier height passes'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"120","speed_kmh":"501","length_m":"1500","inversions":"3","material":"steel"}'),
  false,
  'speed over the ceiling fails'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"2.5","material":"steel"}'),
  false,
  'fractional inversions fail'
);

-- Enums and uuids ---------------------------------------------------------------------
SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"titanium"}'),
  false,
  'unknown material fails'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel","manufacturer_id":"not-a-uuid"}'),
  false,
  'malformed manufacturer uuid fails'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    ('{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel","manufacturer_ids":'
     || (SELECT jsonb_agg('"12345678-1234-1234-1234-123456789012"'::text) FROM generate_series(1, 11))::text || '}')::jsonb),
  false,
  'lineage over the 10-entry cap fails'
);

-- Proposed manufacturers ----------------------------------------------------------------
SELECT is(
  public.submission_payload_valid('new', NULL,
    ('{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel",'
    || '"manufacturer_ids":["12345678-1234-1234-1234-123456789012"],'
    || '"proposed_manufacturers":[{"name":"New Co","position":1}]}')::jsonb),
  true,
  'well-formed proposal alongside lineage passes'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    ('{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel",'
    || '"proposed_manufacturers":[{"name":"A Co","position":0},{"name":"B Co","position":0}]}')::jsonb),
  false,
  'duplicate proposal positions fail'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    ('{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel",'
     || '"manufacturer_ids":'
     || (SELECT jsonb_agg('"12345678-1234-1234-1234-123456789012"'::text) FROM generate_series(1, 6))::text
     || ',"proposed_manufacturers":'
     || (SELECT jsonb_agg(jsonb_build_object('name', 'Co ' || g, 'position', g - 1)) FROM generate_series(1, 5) g)::text
     || '}')::jsonb),
  false,
  'combined ids + proposals over the cap fail'
);

-- Park location ----------------------------------------------------------------------------
SELECT is(
  public.submission_payload_valid('new', NULL,
    ('{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel",'
    || '"park_location":{"city":"Luna Park","lat":40.5,"lng":-74.0}}')::jsonb),
  true,
  'park location without a park_id passes'
);

SELECT is(
  public.submission_payload_valid('new', '99999999-9999-4999-8999-999999999999',
    ('{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel",'
    || '"park_location":{"city":"Luna Park"}}')::jsonb),
  false,
  'park location homing to an existing park fails'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    ('{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel",'
    || '"park_location":{"lat":91}}')::jsonb),
  false,
  'out-of-range latitude fails'
);

-- Scalars and envelope -----------------------------------------------------------------------
SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel","status":"retired"}'),
  false,
  'unknown status fails'
);

SELECT is(
  public.submission_payload_valid('new', NULL,
    '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel","opening_date":"2024-13-01"}'),
  false,
  'impossible opening month fails'
);

SELECT is(
  public.submission_payload_valid('new', NULL, '["not","an","object"]'),
  false,
  'non-object envelope fails'
);

-- Constraint binding ----------------------------------------------------------------------------
SELECT lives_ok(
  $$ INSERT INTO public.coaster_submissions (coaster_name, park_name, submitted_by, kind, suggested_fields)
     VALUES ('Test Coaster', 'Test Park', '80808080-8080-4808-8808-808080808080', 'new',
       '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"steel"}') $$,
  'valid submission row inserts through the payload CHECK'
);

SELECT throws_ok(
  $$ INSERT INTO public.coaster_submissions (coaster_name, park_name, submitted_by, kind, suggested_fields)
     VALUES ('Test Coaster', 'Test Park', '80808080-8080-4808-8808-808080808080', 'new',
       '{"height_m":"120","speed_kmh":"110","length_m":"1500","inversions":"3","material":"titanium"}') $$,
  '23514',
  'new row for relation "coaster_submissions" violates check constraint "coaster_submissions_payload_check"',
  'invalid submission row is rejected by the payload CHECK'
);

SELECT * FROM finish();

ROLLBACK;
