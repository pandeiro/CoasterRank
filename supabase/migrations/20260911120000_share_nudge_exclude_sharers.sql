-- Fix (pandeiro, 2026-09-11): share_nudge_eligibility() never checked
-- profiles.public_list, so riders who ALREADY share their board were nudged
-- to share it. The nudge's job is done the moment someone is a public sharer
-- — exclude them server-side, WITHOUT claiming: leaving
-- share_nudge_shown_at NULL keeps the admin funnel's 'nudged' metric meaning
-- "the banner was actually shown" (claiming for never-shown sharers would
-- pollute it). A sharer who later turns sharing off simply becomes eligible
-- again on the usual idle window; the one-shot claim still applies to their
-- first real show.
--
-- Same signature, same grants (CREATE OR REPLACE preserves them; revoke/grant
-- re-run for idempotent safety).

create or replace function public.share_nudge_eligibility()
returns table (eligible boolean, ranked_count integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_user_id   uuid;
  v_count     integer;
  v_last_edit timestamptz;
begin
  v_user_id := auth.uid();
  if v_user_id is null then
    return query select false, 0;
    return;
  end if;

  -- One-shot: once shown (any prior session/tab), never again.
  if exists (
    select 1 from public.profiles
    where id = v_user_id and share_nudge_shown_at is not null
  ) then
    return query select false, 0;
    return;
  end if;

  -- Already sharing: the nudge's job is done. Not claimed (shown_at stays
  -- NULL) so the funnel's 'nudged' keeps meaning "banner was actually shown".
  if exists (
    select 1 from public.profiles
    where id = v_user_id and public_list
  ) then
    return query select false, 0;
    return;
  end if;

  select count(*)::integer, max(r.updated_at)
    into v_count, v_last_edit
  from public.user_rides r
  where r.user_id = v_user_id
    and r.rank is not null;

  -- Floor: nobody's "settled" this early (also covers the no-edit-yet edge,
  -- which the INSERT trigger above makes a practical impossibility).
  if v_count < 5 or v_last_edit is null then
    return query select false, v_count;
    return;
  end if;

  -- Settled = idle; a user mid-session tweaking their list stays silent.
  if v_last_edit > now() - interval '48 hours' then
    return query select false, v_count;
    return;
  end if;

  -- Write-on-render claim. The IS NULL guard makes a racing tab's UPDATE a
  -- zero-row no-op; found = this call flipped the row and owns the banner.
  update public.profiles
    set share_nudge_shown_at = now()
    where id = v_user_id
      and share_nudge_shown_at is null;

  return query select found, v_count;
end;
$$;

revoke execute on function public.share_nudge_eligibility() from public, anon;
grant execute on function public.share_nudge_eligibility() to authenticated;

comment on function public.share_nudge_eligibility() is
  'One-shot share-nudge gate for the My Coasters mount: eligible only when the rider is NOT already a public sharer, has >= 5 ranked coasters whose last edit is >= 48h old, and profiles.share_nudge_shown_at is still NULL. Already-public sharers return false WITHOUT being claimed (shown_at stays NULL so the funnel''s nudged metric keeps meaning "banner was actually shown"). Decides and claims atomically via a guarded UPDATE, so exactly one request/tab ever sees eligible = true.';
