-- Make coaster slugs globally unique (previously only unique per park).
--
-- Ad-hoc data fix has already renamed the 21 duplicate slugs (46 rows) on
-- 2026-09-04 to `slug || '-' || COALESCE(NULLIF(park_slug,'other'), manu_slug)`.
-- See docs/audit/2026-09-04-slug-dedup.md for the full mapping.
-- This migration is the hardening step so future inserts cannot re-introduce
-- collisions exploited by /coasters/:slug (maybeSingle).
--
-- Keep the existing UNIQUE (park_id, slug) (coasters_park_id_slug_key) –
-- it is now redundant (implied by UNIQUE(slug)) but retained for clarity
-- and to avoid a separate drop that would need a coordinated deploy.
-- Add the global constraint. If the ad-hoc fix is ever reverted or the DB
-- drifts, this will fail visibly at `db push` rather than silently breaking
-- the detail page.

alter table public.coasters
  add constraint coasters_slug_key unique (slug);
