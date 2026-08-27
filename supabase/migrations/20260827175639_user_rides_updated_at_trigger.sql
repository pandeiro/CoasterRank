-- Add updated_at to user_rides with a conditional trigger that only fires
-- when the rank value actually changes. The batched upsert touches every row
-- in the ranked list, but most ranks don't change — the WHEN clause skips
-- those.

ALTER TABLE user_rides ADD COLUMN updated_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.set_user_rides_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER user_rides_updated_at
  BEFORE UPDATE ON public.user_rides
  FOR EACH ROW
  WHEN (OLD.rank IS DISTINCT FROM NEW.rank)
  EXECUTE FUNCTION public.set_user_rides_updated_at();
