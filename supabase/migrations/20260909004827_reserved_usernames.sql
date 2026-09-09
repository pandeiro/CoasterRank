-- Reserved usernames: brand/system words can never be claimed as public
-- /@<username> handles (squatting "/@admin" or "/@coasterrank" must not be
-- possible). Keep the list in sync with RESERVED_USERNAMES in
-- app/src/lib/validation.ts (client-side mirror with the friendly error).
--
-- The site-owner admin account predates this list and is grandfathered: rows
-- with is_admin = true are exempt from the constraint. Non-admin profiles
-- holding a reserved name would fail the migration — fix the data first.

do $$
begin
  if exists (
    select 1 from public.profiles
    where username is not null
      and not is_admin
      and username ~* '^(admin|api|me|coasterrank|support|help|official|system|root|moderator|mod|null)$'
  ) then
    raise exception
      'profiles contains non-admin usernames matching the reserved list; resolve them before applying';
  end if;
end
$$;

alter table public.profiles
  add constraint profiles_username_reserved_check
  check (
    username is null
    or is_admin  -- grandfathered: the site admin may keep a reserved handle
    or username !~* '^(admin|api|me|coasterrank|support|help|official|system|root|moderator|mod|null)$'
  );

-- handle_new_user(): extend the fallback to check_violation. Signup metadata
-- (raw_user_meta_data.username) is attacker-controllable via direct auth API
-- calls: without this, a reserved or malformed username would violate the
-- profiles CHECK constraints with 23514, abort the auth.users insert, and
-- break the whole signup. Fall back to a NULL username (claimable later on
-- the profile page), exactly like the existing unique_violation fallback.
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
exception
  when unique_violation then
    -- Username taken (or a profile row raced in): never block signup.
    insert into public.profiles (id, username, display_name)
    values (new.id, null, v_display_name)
    on conflict (id) do nothing;
    return new;
  when check_violation then
    -- Username violates a profiles CHECK constraint (format or reserved
    -- list): claim a valid one later on the profile page. Never block signup.
    insert into public.profiles (id, username, display_name)
    values (new.id, null, v_display_name)
    on conflict (id) do nothing;
    return new;
end;
$$;
