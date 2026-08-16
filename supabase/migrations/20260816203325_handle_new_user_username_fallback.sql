-- Harden handle_new_user(): a duplicate username from signup metadata must not
-- abort the auth.users INSERT (and thus the whole signup). Fall back to a NULL
-- username; the user can claim one later on the profile page (unique enforced
-- there, with a friendly client error). See PLAN §4.3.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text := coalesce(
    new.raw_user_meta_data ->> 'display_name',
    split_part(new.email, '@', 1)
  );
begin
  insert into public.profiles (id, username, display_name)
  values (new.id, new.raw_user_meta_data ->> 'username', v_display_name);
  return new;
exception when unique_violation then
  -- Username taken (or a profile row raced in): never block signup.
  insert into public.profiles (id, username, display_name)
  values (new.id, null, v_display_name)
  on conflict (id) do nothing;
  return new;
end;
$$;
