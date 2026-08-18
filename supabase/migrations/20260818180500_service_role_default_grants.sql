-- Fix: grant service_role table-level privileges in public schema.
--
-- Problem: supabase db push runs migrations as the `postgres` role, but
-- postgres's default ACL only grants to `anon` and `authenticated`. The
-- `supabase_admin` role has the correct default (grants to service_role),
-- but it never applies because migrations don't run as supabase_admin.
-- Result: service_role had zero table privileges on every table, causing
-- "permission denied for table" errors in edge functions using the service
-- key (e.g. recompute-rankings).
--
-- Fix: backfill all existing tables and align postgres's default ACL with
-- supabase_admin so future tables auto-grant correctly.

-- Backfill: grant service_role full access to all existing public tables
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- Future-proof: ensure tables created by postgres (i.e. migrations) also
-- grant to service_role by default
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
