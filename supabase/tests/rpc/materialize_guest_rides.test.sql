-- P1: materialize_guest_rides() — guest promotion merges (SECURITY INVOKER).
--
-- Covers the review's rank-conflict case explicitly: a guest ladder merged
-- onto an owned list with overlap must produce a gapless 1..n sequence, and
-- a stale payload (prior ranked rows missing) must raise PGRD1 with NOTHING
-- written. Also pins validation boundaries (unknown ids, empty/non-array,
-- 5000-row ceiling, unauthenticated) and the holding-pen rule.
--
-- Reads of guest_promotions assert as postgres (RESET ROLE): that table's
-- reads are admin-only by design, so the impersonated caller can never see
-- its own telemetry row through RLS. Everything else impersonates via
-- SET LOCAL ROLE + request.jwt.claim.sub. Self-contained.

BEGIN;

SELECT plan(18);

-- Fixtures ------------------------------------------------------------------
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES
  ('44444444-4444-4444-4444-444444444444', 'guest-fresh@example.com', now(), '{"username":"guest_fresh"}'),
  ('55555555-5555-5555-5555-555555555555', 'guest-merge@example.com', now(), '{"username":"guest_merge"}'),
  ('66666666-6666-6666-6666-666666666666', 'guest-dup@example.com', now(), '{"username":"guest_dup"}'),
  ('77777777-7777-7777-7777-777777777777', 'guest-pen@example.com', now(), '{"username":"guest_pen"}');

INSERT INTO public.parks (id, name, slug)
VALUES ('c1111111-1111-4111-8111-111111111111', 'Guest Test Park', 'guest-test-park');
INSERT INTO public.coasters (id, park_id, name, slug)
VALUES
  ('e0000000-0000-4000-8000-000000000001', 'c1111111-1111-4111-8111-111111111111', 'Guest X', 'guest-x'),
  ('e0000000-0000-4000-8000-000000000002', 'c1111111-1111-4111-8111-111111111111', 'Guest Y', 'guest-y'),
  ('e0000000-0000-4000-8000-000000000003', 'c1111111-1111-4111-8111-111111111111', 'Guest Z', 'guest-z'),
  ('e0000000-0000-4000-8000-000000000004', 'c1111111-1111-4111-8111-111111111111', 'Guest W', 'guest-w'),
  ('e0000000-0000-4000-8000-000000000005', 'c1111111-1111-4111-8111-111111111111', 'Guest A', 'guest-a'),
  ('e0000000-0000-4000-8000-000000000006', 'c1111111-1111-4111-8111-111111111111', 'Guest B', 'guest-b'),
  ('e0000000-0000-4000-8000-000000000007', 'c1111111-1111-4111-8111-111111111111', 'Guest C', 'guest-c');

-- Owned ranked rows for the merge user (A=1, B=2); unranked holding-pen row
-- for the pen user. Inserted as postgres (BYPASSRLS); the RPC itself runs
-- under RLS as the impersonated user.
INSERT INTO public.user_rides (user_id, coaster_id, rank)
VALUES
  ('55555555-5555-5555-5555-555555555555', 'e0000000-0000-4000-8000-000000000005', 1),
  ('55555555-5555-5555-5555-555555555555', 'e0000000-0000-4000-8000-000000000006', 2);
INSERT INTO public.user_rides (user_id, coaster_id, rank)
VALUES ('77777777-7777-7777-7777-777777777777', 'e0000000-0000-4000-8000-000000000004', NULL);

-- Fresh materialization ------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', true);

SELECT is(
  public.materialize_guest_rides('["e0000000-0000-4000-8000-000000000001","e0000000-0000-4000-8000-000000000002","e0000000-0000-4000-8000-000000000003"]'::jsonb),
  3,
  'fresh materialize returns the ladder length'
);

SELECT results_eq(
  $$ SELECT rank FROM public.user_rides WHERE user_id = '44444444-4444-4444-4444-444444444444' $$,
  $$ VALUES (1), (2), (3) $$,
  'fresh ranks are gapless 1..3'
);

SELECT is(
  (SELECT coaster_id FROM public.user_rides
   WHERE user_id = '44444444-4444-4444-4444-444444444444' AND rank = 1),
  'e0000000-0000-4000-8000-000000000001'::uuid,
  'array position maps to rank (first element is rank 1)'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT kind, ride_count FROM public.guest_promotions
     WHERE user_id = '44444444-4444-4444-4444-444444444444' $$,
  $$ VALUES ('materialize'::text, 3) $$,
  'telemetry row records the full fresh count'
);

-- Merge onto overlap ---------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);

SELECT is(
  public.materialize_guest_rides('["e0000000-0000-4000-8000-000000000005","e0000000-0000-4000-8000-000000000006","e0000000-0000-4000-8000-000000000007"]'::jsonb, 'merge_append'),
  3,
  'merge over overlap returns the complete ladder length'
);

SELECT results_eq(
  $$ SELECT coaster_id, rank FROM public.user_rides
     WHERE user_id = '55555555-5555-5555-5555-555555555555' $$,
  $$ VALUES
    ('e0000000-0000-4000-8000-000000000005'::uuid, 1),
    ('e0000000-0000-4000-8000-000000000006'::uuid, 2),
    ('e0000000-0000-4000-8000-000000000007'::uuid, 3) $$,
  'merge produces a gapless ladder over the overlap (no off-by-one)'
);

RESET ROLE;

SELECT results_eq(
  $$ SELECT kind, ride_count FROM public.guest_promotions
     WHERE user_id = '55555555-5555-5555-5555-555555555555' $$,
  $$ VALUES ('merge_append'::text, 1) $$,
  'telemetry counts only newly appended rows on merge'
);

-- Duplicates: first occurrence wins ------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', true);

SELECT is(
  public.materialize_guest_rides('["e0000000-0000-4000-8000-000000000001","e0000000-0000-4000-8000-000000000002","e0000000-0000-4000-8000-000000000001"]'::jsonb),
  2,
  'duplicate coaster collapses to first occurrence'
);

SELECT results_eq(
  $$ SELECT coaster_id, rank FROM public.user_rides
     WHERE user_id = '66666666-6666-6666-6666-666666666666' $$,
  $$ VALUES
    ('e0000000-0000-4000-8000-000000000001'::uuid, 1),
    ('e0000000-0000-4000-8000-000000000002'::uuid, 2) $$,
  'ranks renumber 1..n after dedup'
);

-- Stale payload: nothing written ----------------------------------------------
SELECT set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', true);

SELECT throws_ok(
  $$ SELECT public.materialize_guest_rides('["e0000000-0000-4000-8000-000000000005","e0000000-0000-4000-8000-000000000006"]'::jsonb) $$,
  'PGRD1',
  'Account has 1 ranked coaster(s) absent from the guest payload — stale',
  'stale payload (prior ranked row missing) raises PGRD1'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_rides WHERE user_id = '55555555-5555-5555-5555-555555555555'),
  3,
  'stale call writes nothing (still 3 rows)'
);

-- Validation boundaries -------------------------------------------------------
SELECT throws_ok(
  $$ SELECT public.materialize_guest_rides('["e0000000-0000-4000-8000-000000000001","12345678-1234-1234-1234-123456789012"]'::jsonb) $$,
  'P0001',
  'Guest list references 1 unknown coaster(s) — refresh and retry',
  'unknown coaster id is rejected'
);

SELECT throws_ok(
  $$ SELECT public.materialize_guest_rides('[]'::jsonb) $$,
  'P0001',
  'Guest payload contains no rows',
  'empty payload is rejected'
);

SELECT throws_ok(
  $$ SELECT public.materialize_guest_rides('{"not":"an array"}'::jsonb) $$,
  'P0001',
  'p_rides must be a JSON array of coaster ids',
  'non-array payload is rejected'
);

SELECT throws_ok(
  $$ SELECT public.materialize_guest_rides((SELECT jsonb_agg(gen_random_uuid()::text) FROM generate_series(1, 5001))) $$,
  'P0001',
  'Guest payload too large (max 5000 rows)',
  'over-ceiling payload is rejected'
);

-- Unauthenticated (claim unset, role still authenticated) ----------------------
SELECT set_config('request.jwt.claim.sub', NULL, true);

SELECT throws_ok(
  $$ SELECT public.materialize_guest_rides('["e0000000-0000-4000-8000-000000000001"]'::jsonb) $$,
  '42501',
  'Not authenticated',
  'missing JWT subject is denied'
);

-- Holding pen untouched ---------------------------------------------------------
SELECT set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', true);

SELECT is(
  public.materialize_guest_rides('["e0000000-0000-4000-8000-000000000001","e0000000-0000-4000-8000-000000000002"]'::jsonb),
  2,
  'materialize alongside a holding-pen row returns the ladder length'
);

SELECT is(
  (SELECT rank FROM public.user_rides
   WHERE user_id = '77777777-7777-7777-7777-777777777777'
     AND coaster_id = 'e0000000-0000-4000-8000-000000000004'),
  NULL,
  'holding-pen row not in the payload stays unranked'
);

SELECT * FROM finish();

ROLLBACK;
