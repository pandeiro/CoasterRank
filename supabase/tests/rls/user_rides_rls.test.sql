-- RLS policy-drift smoke for public.user_rides (P0).
--
-- Scope is deliberately "smoke": one positive case (owner allowed) and one
-- negative case (non-owner denied) per operation, via SET ROLE + JWT claims.
-- Escalation-matrix expansion is trigger-gated (RFC §6 Q2), not open-ended.
--
-- Environment notes (spike-verified on supabase/postgres:17.6.1.175):
-- - auth.uid() reads request.jwt.claim.sub (singular), which GoTrue normally
--   sets per request. No GoTrue runs in Job A, so tests set it directly.
-- - The image auto-grants anon/authenticated full default privileges on new
--   public tables (prod no longer does, but our migrations carry explicit
--   GRANTs for client-touched tables). Negative paths therefore assert RLS
--   enforcement, not missing privileges — the identical policy evaluation
--   prod performs after its own grants.
--
-- Run via pg_prove as the postgres role (member of authenticated/anon, so
-- SET LOCAL ROLE works). Self-contained: BEGIN ... ROLLBACK, no residue.

BEGIN;

SELECT plan(7);

-- Fixtures (as postgres, BYPASSRLS so trigger + inserts just work) ---------
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES
  ('11111111-1111-1111-1111-111111111111', 'rls-owner@example.com', now(), '{"username":"rls_owner"}'),
  ('22222222-2222-2222-2222-222222222222', 'rls-other@example.com', now(), '{"username":"rls_other"}'),
  ('33333333-3333-3333-3333-333333333333', 'rls-unconfirmed@example.com', NULL, '{"username":"rls_unconfirmed"}');

INSERT INTO public.parks (id, name, slug)
VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RLS Test Park', 'rls-test-park');
INSERT INTO public.coasters (id, park_id, name, slug)
VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'RLS Test Coaster', 'rls-test-coaster');

-- Act as the confirmed owner ------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

SELECT lives_ok(
  $$ INSERT INTO public.user_rides (user_id, coaster_id, rank)
     VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1) $$,
  'owner can insert their own ride'
);

SELECT is(
  (SELECT count(*)::int FROM public.user_rides WHERE user_id = '11111111-1111-1111-1111-111111111111'),
  1,
  'owner can read their own ride'
);

SELECT throws_ok(
  $$ INSERT INTO public.user_rides (user_id, coaster_id, rank)
     VALUES ('22222222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1) $$,
  '42501',
  'new row violates row-level security policy for table "user_rides"',
  'owner cannot insert a ride for another user'
);

-- Act as the other confirmed user: owner's rows must be invisible -----------
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', true);

SELECT is(
  (SELECT count(*)::int FROM public.user_rides),
  0,
  'non-owner sees zero rows through the select policy'
);

-- Act as the unconfirmed user: the email gate must deny the write -----------
SELECT set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', true);

SELECT throws_ok(
  $$ INSERT INTO public.user_rides (user_id, coaster_id, rank)
     VALUES ('33333333-3333-3333-3333-333333333333', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1) $$,
  '42501',
  'new row violates row-level security policy for table "user_rides"',
  'unconfirmed user cannot insert even their own ride (email gate)'
);

-- Act as anon: RLS must filter everything (uid is NULL) ----------------------
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*)::int FROM public.user_rides),
  0,
  'anon sees zero rows through the select policy'
);

-- NOTE: anon is denied one layer earlier than the policy check itself: the
-- email-gate helper public.user_email_verified() is revoked from anon
-- (security_hardening), so the WITH CHECK errors at the function boundary.
-- Still 42501, still denied — defense in depth.
SELECT throws_ok(
  $$ INSERT INTO public.user_rides (user_id, coaster_id, rank)
     VALUES ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 1) $$,
  '42501',
  'permission denied for function user_email_verified',
  'anon cannot insert rides'
);

SELECT * FROM finish();

ROLLBACK;
