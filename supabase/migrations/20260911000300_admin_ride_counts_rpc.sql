-- Admin Coasters panel: accurate per-coaster ride counts.
--
-- getAllCoastersAdmin() counted rides via the PostgREST aggregate embed
-- `ride_count:user_rides(count)`, which runs under the CALLER's RLS — and
-- user_rides is deliberately own-rows-only (no admin read policy; do NOT add
-- one: raw ride rows stay private beyond the aggregates admins already get).
-- An admin with no rides of their own therefore saw 0 for EVERY coaster
-- (579 rides existed at the time). This security-definer RPC is the admin
-- read path instead: it bypasses RLS (definer = table owner) but returns an
-- empty set for anyone who is not an admin — auth.uid() is evaluated with
-- the CALLER's JWT claims, so a leaked non-admin call leaks nothing.
--
-- Functions default to EXECUTE for PUBLIC, so the grants below start from an
-- explicit revoke. Additive; CREATE OR REPLACE keeps the signature stable.

create or replace function public.coaster_ride_counts()
returns table (coaster_id uuid, rides bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select r.coaster_id, count(*)::bigint as rides
  from public.user_rides r
  where coalesce(
    (select p.is_admin from public.profiles p where p.id = auth.uid()),
    false
  )
  group by r.coaster_id
$$;

revoke execute on function public.coaster_ride_counts() from public, anon;
grant execute on function public.coaster_ride_counts() to authenticated;
