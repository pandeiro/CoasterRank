-- P1: handle_new_user() — NULL-username fallback stays valid downstream.
--
-- Signup must never fail on username problems: reserved names, duplicates,
-- and malformed values all fall back to username IS NULL (unique_violation /
-- check_violation handlers). This suite pins that fallback AND the review's
-- downstream question: the NULL row must not break share-nudge (single row,
-- no burned one-shot) or the public rider page (never leaks, NULL-safe).
--
-- Trigger fires on auth.users INSERT; all fixture inserts run as postgres.
-- Self-contained.

BEGIN;

SELECT plan(11);

-- Fixtures: each auth.users INSERT fires handle_new_user() --------------------
INSERT INTO auth.users (id, email, raw_user_meta_data)
VALUES
  ('10101010-1010-4101-8101-101010101010', 'reserved@example.com', '{"username":"admin","display_name":"Reserved"}'),
  ('20202020-2020-4202-8202-202020202020', 'firstcopy@example.com', '{"username":"copycat1"}'),
  ('30303030-3030-4303-8303-303030303030', 'secondcopy@example.com', '{"username":"copycat1"}'),
  ('40404040-4040-4404-8404-404040404040', 'malformed@example.com', '{"username":"AB!"}'),
  ('50505050-5050-4505-8505-505050505050', 'valid@example.com', '{"username":"valid_rider"}');

-- Fallback rows ---------------------------------------------------------------
SELECT is(
  (SELECT username FROM public.profiles WHERE id = '10101010-1010-4101-8101-101010101010'),
  NULL,
  'reserved username falls back to NULL (never blocks signup)'
);

SELECT is(
  (SELECT display_name FROM public.profiles WHERE id = '10101010-1010-4101-8101-101010101010'),
  'Reserved',
  'explicit display_name survives the NULL fallback'
);

SELECT is(
  (SELECT username FROM public.profiles WHERE id = '20202020-2020-4202-8202-202020202020'),
  'copycat1',
  'first claimant keeps the contested username'
);

SELECT is(
  (SELECT username FROM public.profiles WHERE id = '30303030-3030-4303-8303-303030303030'),
  NULL,
  'duplicate username falls back to NULL (partial unique index allows it)'
);

SELECT is(
  (SELECT username FROM public.profiles WHERE id = '40404040-4040-4404-8404-404040404040'),
  NULL,
  'malformed username falls back to NULL'
);

SELECT is(
  (SELECT display_name FROM public.profiles WHERE id = '40404040-4040-4404-8404-404040404040'),
  'malformed',
  'display_name falls back to the email local part'
);

SELECT is(
  (SELECT username FROM public.profiles WHERE id = '50505050-5050-4505-8505-505050505050'),
  'valid_rider',
  'valid username flows through untouched (control case)'
);

-- Downstream: share nudge -------------------------------------------------------
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '10101010-1010-4101-8101-101010101010', true);

SELECT results_eq(
  $$ SELECT eligible, ranked_count FROM public.share_nudge_eligibility() $$,
  $$ VALUES (false, 0) $$,
  'NULL-username rider gets a single ineligible row (no banner loop)'
);

SELECT is(
  (SELECT share_nudge_shown_at FROM public.profiles WHERE id = '10101010-1010-4101-8101-101010101010'),
  NULL,
  'ineligible nudge burns nothing (one-shot unclaimed)'
);

RESET ROLE;

-- Downstream: public rider page --------------------------------------------------
UPDATE public.profiles SET public_list = true WHERE id = '10101010-1010-4101-8101-101010101010';

-- NOTE: scalar function, so "no rider" is one NULL row, not zero rows.
SELECT is(
  public.public_rider_page(NULL),
  NULL,
  'rider page with NULL input returns NULL without error'
);

SELECT is(
  public.public_rider_page('admin'),
  NULL,
  'NULL-username public row never surfaces on the rider page'
);

SELECT * FROM finish();

ROLLBACK;
