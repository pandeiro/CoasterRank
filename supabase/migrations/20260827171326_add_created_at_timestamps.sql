-- Add created_at columns to profiles and user_rides.
-- Existing rows will receive the migration timestamp; no backfill possible
-- from current data.

ALTER TABLE profiles ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE user_rides ADD COLUMN created_at TIMESTAMPTZ DEFAULT NOW();
