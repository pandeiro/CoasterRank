-- Strip leftover Supabase platform default-privilege grants from anon/authenticated.
--
-- Context (Supabase notice, 2026-10-20, effective 2026-10-30): new tables in
-- "public" no longer receive automatic Data API grants; explicit GRANTs from
-- the migration that creates the table (which has been our convention all
-- along — see AGENTS.md) become the only source of table access. On the way
-- out, the platform auto-grant was only ever carrying junk privileges for
-- anon/authenticated: TRUNCATE / REFERENCES / TRIGGER / MAINTAIN (the
-- useful half — SELECT/INSERT/UPDATE/DELETE — was always granted explicitly
-- by our migrations instead).
--
-- None of those junk privileges are load-bearing:
--   - The Data API (PostgREST) exposes only select/insert/update/delete/rpc,
--     so anon/authenticated can never exercise TRUNCATE through it; TRUNCATE
--     also ignores RLS, which is why we don't want the privilege lying around.
--   - The only TRUNCATE usage in the project (pair_fit_agg / pair_fit_step)
--     runs inside SECURITY DEFINER functions owned by postgres — the table
--     owner — so permission checks never consult anon/authenticated grants.
--   - REFERENCES / TRIGGER / MAINTAIN are owner-territory privileges (FK and
--     trigger creation, VACUUM/REFRESH) no API role uses.
--
-- What this migration does:
--   1. Table level: drop the junk privileges from every existing relation in
--      public. Explicit SELECT/INSERT/UPDATE/DELETE grants (table- and
--      column-level) are untouched, and revoking a privilege a relation never
--      held is a no-op — safe to re-run.
--   2. Default privileges: reset postgres's default ACL on public.tables for
--      anon/authenticated to nothing, so every future table starts at zero
--      and each table-creating migration must grant exactly what it needs.
--
-- Left untouched, deliberately: the service_role default grant
-- (arwdDxtm, migration 20260818180500_service_role_default_grants.sql) — it
-- is load-bearing for the recompute Edge Function, pg_cron maintenance jobs,
-- and the scripts/ tooling. The supabase_admin-owned default ACLs are the
-- platform's business (per the same notice, Supabase is changing those).

revoke truncate, references, trigger, maintain on all tables in schema public from anon;
revoke truncate, references, trigger, maintain on all tables in schema public from authenticated;

alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on tables from authenticated;
