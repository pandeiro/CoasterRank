-- Fix: share_nudge_eligibility() never exited early — plpgsql RETURN QUERY
-- appends to the result set and FALLS THROUGH, it does not return. Every
-- guard branch ("anon", "already shown", "below floor", "not yet idle")
-- appended its row and then kept executing, so any call by a not-yet-eligible
-- rider ran the claim UPDATE and burned their one-shot
-- (profiles.share_nudge_shown_at set) while the client, reading data[0],
-- saw the pre-claim row and hid the banner. Verified live: the anon path
-- returned 3 rows instead of 1.
--
-- Same signature, same grants (CREATE OR REPLACE preserves them; the
-- revoke/grant below is re-run for idempotent safety). Minimal change: an
-- explicit bare `return;` after each early `return query` so the guard
-- branches actually exit. No rows were burned before this fix shipped
-- (verified: 0 profiles had share_nudge_shown_at set).

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
