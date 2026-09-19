-- Profile deletion trigger: clean up pair contributions to prevent ghost rankings
--
-- When a user profile is deleted (via Admin Users UI or direct cascade from auth.users),
-- their slice in public.user_pairs must be subtracted from public.pair_totals so
-- their comparisons do not linger as permanent ghost wins/weights in the
-- Bradley-Terry ranking model.
--
-- How it works:
--   1. The trigger inspects public.user_pairs for that user_id.
--   2. If rows exist, it aggregates that user's exact slice, updates pair_totals
--      with negative deltas, and deletes rows where wins <= 0.
--   3. Deletes the user_pairs slice for that user.
--   4. Removes the user from pair_dirty_users and pair_user_state.
--
-- Zero performance impact on recompute / warm start:
--   Normal operations (ranking rides, recomputing BT, warm starts) never delete profiles.
--   This trigger only runs when a user is actively deleted.

create or replace function public.pair_cleanup_on_profile_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Inspect public.user_pairs for this user_id.
  -- If this user has recorded pairwise contributions, aggregate their exact slice,
  -- apply signed negative deltas to pair_totals, and delete rows where wins <= 0.
  if exists (select 1 from public.user_pairs where user_id = old.id) then
    insert into public.pair_totals (winner, loser, weight_sum, wins)
      select winner, loser, -sum(weight), -count(*)::bigint
      from public.user_pairs
      where user_id = old.id
      group by winner, loser
      order by winner, loser
    on conflict (winner, loser) do update
      set weight_sum = public.pair_totals.weight_sum + excluded.weight_sum,
          wins = public.pair_totals.wins + excluded.wins;

    -- Delete pairs whose contributors all went away (wins is exact integer
    -- arithmetic; any float residue in weight_sum dies with the row).
    delete from public.pair_totals where wins <= 0;

    -- Clean up user_pairs slice for this user
    delete from public.user_pairs where user_id = old.id;
  end if;

  -- Remove any dirty queue or state tracking for this user
  delete from public.pair_dirty_users where user_id = old.id;
  delete from public.pair_user_state where user_id = old.id;

  return old;
end;
$$;

revoke execute on function public.pair_cleanup_on_profile_delete() from public, anon, authenticated;

drop trigger if exists pair_cleanup_profile_delete on public.profiles;
create trigger pair_cleanup_profile_delete
  before delete on public.profiles
  for each row
  execute function public.pair_cleanup_on_profile_delete();

-- Defend pair_mark_dirty_delete() against cascading user deletions:
-- when a user/profile is deleted, their rides cascade-delete from user_rides.
-- Only active users with an existing profile should be inserted into pair_dirty_users.
create or replace function public.pair_mark_dirty_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pair_dirty_users (user_id)
  select distinct user_id from old_rides
  where rank is not null
    and exists (select 1 from public.profiles p where p.id = old_rides.user_id)
  on conflict (user_id) do nothing;
  return null;
end;
$$;
