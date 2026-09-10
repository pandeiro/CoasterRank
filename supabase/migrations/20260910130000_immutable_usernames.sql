-- Claim-once usernames: once a profile has a username, client roles can no
-- longer change it (rename, clear, or swap). The public rider URL
-- (/riders/<username> + /@username share alias) is derived from the handle,
-- so renames break shared links and cached unfurls. Typo fixes go through an
-- admin (service_role / SQL editor / admin JWT), which this trigger allows.
--
-- NULL -> value (first claim from signup fallback or the profile page) is
-- still allowed for the owner; the column UPDATE grant is unchanged.

create or replace function public.prevent_username_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.username is not null and new.username is distinct from old.username then
    -- Privileged paths have no auth.uid (service_role, postgres / SQL editor).
    if auth.uid() is null then
      return new;
    end if;
    -- Admins (authenticated JWT with profiles.is_admin) may fix typos.
    if public.is_admin() then
      return new;
    end if;
    raise exception
      'username is immutable once claimed (contact admin@coasterrank.app for help)'
      using errcode = '23514', constraint = 'profiles_username_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_username_immutable on public.profiles;
create trigger profiles_username_immutable
  before update of username on public.profiles
  for each row
  execute function public.prevent_username_change();
