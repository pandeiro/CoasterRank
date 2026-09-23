-- Platform compatibility shim for the postgres-only CI job (Job A).
--
-- RUN AS: supabase_admin (the image's real superuser), exactly once per
-- ephemeral database, BEFORE applying supabase/migrations/ and BEFORE pg_prove.
-- NEVER as part of supabase/migrations/ (it must never reach prod via db push),
-- and NEVER via pg_prove (setup runs under a different role than the tests).
--
-- Why each statement exists (spike-verified 2026-09-23 on
-- supabase/postgres:17.6.1.175; see RFC §6 Q1):
--
-- 1. pgtap: the image ships pgTAP 1.3.3 as available-but-not-enabled.
--    Flipping it on here keeps it out of migrations and out of prod.
-- 2. auth.users.email_confirmed_at: the bare image bootstraps the ANCIENT
--    GoTrue auth schema (confirmed_at, no email_confirmed_at); prod runs
--    current GoTrue which has the column, and our RLS migration reads it.
--    This is the ONLY non-id auth.users column our migrations reference.
-- 3. storage surface: the image ships an EMPTY storage schema (the tables are
--    created by storage-api at boot, which Job A never starts). Our single
--    storage migration (avatar_storage) needs buckets + objects + foldername()
--    to exist. Minimal DDL-satisfying definitions only; drift fails LOUD at
--    migration-apply time, never silently.
--
-- Local equivalent (no passwords needed; image uses trust auth on localhost):
--   psql -h localhost -U supabase_admin -d postgres -f supabase/tests/setup/00_platform_shim.sql

CREATE EXTENSION IF NOT EXISTS pgtap;

ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz;

CREATE TABLE IF NOT EXISTS storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text,
  name text
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE OR REPLACE FUNCTION storage.foldername(name text) RETURNS text[]
  LANGUAGE sql IMMUTABLE
  AS $$ SELECT string_to_array(name, '/') $$;

GRANT ALL ON storage.buckets, storage.objects TO postgres;
