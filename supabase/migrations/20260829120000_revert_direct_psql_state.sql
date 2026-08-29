-- Revert schema changes that were applied directly via psql, bypassing the
-- migration pipeline. Two pending migrations had been run manually against
-- prod:
--   * 20260829125130_rider_public_pages.sql — partially applied (columns,
--     index, grant persisted; function creation failed on a CTE bug)
--   * 20260829130000_coaster_aliases.sql — fully applied but untracked
-- This restores the database to its last recorded state (20260829020000) so
-- both migrations apply cleanly through `supabase db push` in version order.
-- All statements are IF EXISTS no-ops on a fresh database.

drop table if exists public.coaster_aliases;

drop index if exists public.profiles_lower_username_idx;

alter table public.profiles
  drop column if exists public_list;

alter table public.profiles
  drop column if exists og_image_url;
