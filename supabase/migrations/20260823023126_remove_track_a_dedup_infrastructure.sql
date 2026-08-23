-- Remove Track A Data Quality Pipeline Infrastructure
-- This migration cleans up all database objects created for the abandoned
-- Track A deduplication pipeline (Phases 0-8). The pipeline was never completed
-- and the infrastructure is not used by the application.

-- 1. Drop broken Track A functions that reference dropped tables
DROP FUNCTION IF EXISTS public.apply_park_merge(uuid, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.generate_park_candidates(numeric);
DROP FUNCTION IF EXISTS public.count_park_candidates(numeric);

-- 2. Drop Track A function on remaining tables (before dropping tables)
DROP FUNCTION IF EXISTS public.apply_coaster_merge(uuid, uuid, uuid, text, text);

-- 3. Drop Track A staging tables (park_dupe_candidates and manufacturer_dupe_candidates
--    were already dropped in earlier migrations)
DROP TABLE IF EXISTS public.coaster_dupe_candidates;
DROP TABLE IF EXISTS public.coaster_merge_log;

-- 4. Drop review metadata columns from coasters
--    (review_state CHECK constraint is automatically dropped with the column)
ALTER TABLE public.coasters
  DROP COLUMN IF EXISTS review_state,
  DROP COLUMN IF EXISTS confidence,
  DROP COLUMN IF EXISTS last_verified_at,
  DROP COLUMN IF EXISTS needs_review_reason;

-- 5. Drop pg_trgm extension and trigram indexes (CASCADE removes dependent indexes)
DROP EXTENSION IF EXISTS pg_trgm CASCADE;