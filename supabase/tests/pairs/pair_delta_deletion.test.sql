-- Pre-refactor CHARACTERIZATION for pair_cleanup_on_profile_delete() (P0).
--
-- Purpose (RFC §3): lock the CURRENT observable behavior before the mega-user
-- queue refactor changes this code, so the refactor has invariants to preserve.
-- These assertions are intentionally OUTCOME-based, not mechanics-based: they
-- constrain the final pair_totals / user_pairs / queue state without assuming
-- HOW the trigger (or its refactored successor) gets there. A refactor that
-- changes the upsert sequence but preserves these outcomes still passes.
--
-- Invariants characterized:
--   1. Deleting a profile subtracts exactly that user's user_pairs slice from
--      pair_totals via signed negative deltas.
--   2. Shared pairs survive with the remaining contributors' exact values.
--   3. Sole-contributor pairs disappear entirely (no ghost/zero rows).
--   4. The deleted user's user_pairs slice, dirty-queue row, and state row
--      are all removed; other users' data is untouched.
--
-- Runs as postgres (BEHAVIOR test, not an RLS test). Self-contained.

BEGIN;

SELECT plan(7);

-- Fixtures ------------------------------------------------------------------
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'delta-doomed@example.com', now(), '{"username":"delta_doomed"}'),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'delta-survivor@example.com', now(), '{"username":"delta_survivor"}');

INSERT INTO public.parks (id, name, slug)
VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Delta Test Park', 'delta-test-park');
INSERT INTO public.coasters (id, park_id, name, slug)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Delta X', 'delta-x'),
  ('d0000000-0000-4000-8000-000000000002', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Delta Y', 'delta-y'),
  ('d0000000-0000-4000-8000-000000000003', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Delta Z', 'delta-z');

-- Doomed user contributes (X>Y, 0.5) and (X>Z, 0.7); survivor holds (X>Y, 0.4).
INSERT INTO public.user_pairs (user_id, winner, loser, weight)
VALUES
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 0.5),
  ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 0.7),
  ('b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 0.4);

INSERT INTO public.pair_totals (winner, loser, weight_sum, wins)
VALUES
  ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000002', 0.9, 2),
  ('d0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000003', 0.7, 1);

INSERT INTO public.pair_dirty_users (user_id)
VALUES ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1');
INSERT INTO public.pair_user_state (user_id, eligible)
VALUES ('a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1', true);

-- Act: delete the doomed user's profile --------------------------------------
DELETE FROM public.profiles WHERE id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';

-- Assert: outcomes -----------------------------------------------------------
SELECT results_eq(
  $$ SELECT weight_sum, wins FROM public.pair_totals
     WHERE winner = 'd0000000-0000-4000-8000-000000000001'
       AND loser  = 'd0000000-0000-4000-8000-000000000002' $$,
  $$ VALUES (0.4::double precision, 1::bigint) $$,
  'shared pair keeps exactly the surviving contributor values'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.pair_totals
     WHERE winner = 'd0000000-0000-4000-8000-000000000001'
       AND loser  = 'd0000000-0000-4000-8000-000000000003' $$,
  'sole-contributor pair disappears entirely (no ghost/zero row)'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.user_pairs
     WHERE user_id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1' $$,
  'deleted user slice is gone from user_pairs'
);

SELECT results_eq(
  $$ SELECT weight FROM public.user_pairs
     WHERE user_id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2' $$,
  $$ VALUES (0.4::double precision) $$,
  'surviving user slice is untouched'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.pair_dirty_users
     WHERE user_id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1' $$,
  'deleted user is dequeued from pair_dirty_users'
);

SELECT is_empty(
  $$ SELECT 1 FROM public.pair_user_state
     WHERE user_id = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1' $$,
  'deleted user state row is removed from pair_user_state'
);

SELECT ok(
  EXISTS (SELECT 1 FROM public.profiles WHERE id = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'),
  'surviving profile is untouched'
);

SELECT * FROM finish();

ROLLBACK;
