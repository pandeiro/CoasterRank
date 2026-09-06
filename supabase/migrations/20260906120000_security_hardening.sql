-- Security hardening from the 2026-09 audit.
-- Applied via PR -> merge to main -> CI supabase db push.

-- C-02: enforce the same username contract at the database boundary as the
-- SPA. Fail the migration rather than silently renaming or dropping a user's
-- public handle if an older environment still contains invalid data.
do $$
begin
  if exists (
    select 1
    from public.profiles
    where username is not null
      and username !~ '^[a-z0-9_]{3,20}$'
  ) then
    raise exception
      'profiles contains usernames outside ^[a-z0-9_]{3,20}$; clean them up before applying security hardening';
  end if;

  if exists (
    select 1
    from public.profiles
    where username is not null
    group by lower(username)
    having count(*) > 1
  ) then
    raise exception
      'profiles contains case-insensitive duplicate usernames; resolve them before applying security hardening';
  end if;
end;
$$;

alter table public.profiles
  add constraint profiles_username_format_check
  check (username is null or username ~ '^[a-z0-9_]{3,20}$');

create unique index profiles_lower_username_unique_idx
  on public.profiles (lower(username))
  where username is not null;

-- C-01: only the five fields that the review UI is designed to approve may be
-- persisted. A jsonb ?& check is insufficient here because it validates that
-- keys exist, rather than rejecting additional keys.
create or replace function public.suggested_fields_keys_valid(p_fields jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_typeof(p_fields) = 'object', false)
    and not exists (
      select 1
      from jsonb_object_keys(p_fields) as key
      where key not in ('height_m', 'speed_kmh', 'length_m', 'inversions', 'material')
    );
$$;

revoke execute on function public.suggested_fields_keys_valid(jsonb) from public, anon;
grant execute on function public.suggested_fields_keys_valid(jsonb) to authenticated;

alter table public.coaster_submissions
  add constraint coaster_submissions_suggested_fields_keys_check
  check (public.suggested_fields_keys_valid(suggested_fields));

-- F-02: close the anonymous oracle. Keep EXECUTE for authenticated because
-- these functions are invoked directly by authenticated RLS policy
-- expressions; SECURITY DEFINER changes the function body owner, not the
-- privilege check needed to invoke the function from the policy.
revoke execute on function public.user_email_verified(uuid) from public, anon;
grant execute on function public.user_email_verified(uuid) to authenticated;
revoke execute on function public.submission_within_cap() from public, anon;
grant execute on function public.submission_within_cap() to authenticated;

-- H-07: number-one history is trigger-owned. The trigger must be
-- security-definer before client INSERT is revoked.
create or replace function public.log_user_number_one()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  prev_id uuid;
begin
  if NEW.rank = 1 and (OLD.rank IS DISTINCT FROM 1) then
    select coaster_id into prev_id
      from public.user_rides
      where user_id = NEW.user_id and rank = 1 and coaster_id != NEW.coaster_id
      limit 1;

    insert into public.user_number_ones (user_id, coaster_id, previous_coaster_id)
    values (NEW.user_id, NEW.coaster_id, prev_id);
  end if;
  return NEW;
end;
$$;

revoke insert on public.user_number_ones from authenticated;

-- F-03 + P-05: a public bucket may still serve known object URLs, but list
-- and writes are scoped to the caller's single canonical avatar path. This
-- prevents UUID enumeration, arbitrary object creation, and unbounded counts.
drop policy if exists "Avatar public read" on storage.objects;
create policy "Avatar owner list"
  on storage.objects for select
  using (
    bucket_id = 'avatars'
    and auth.uid() is not null
    and name like auth.uid()::text || '/%'
  );

drop policy if exists "Users can insert own avatar" on storage.objects;
create policy "Users can insert own avatar"
  on storage.objects for insert
  with check (
    bucket_id = 'avatars'
    and name = auth.uid()::text || '/avatar.jpg'
  );

drop policy if exists "Users can update own avatar" on storage.objects;
create policy "Users can update own avatar"
  on storage.objects for update
  using (
    bucket_id = 'avatars'
    and name = auth.uid()::text || '/avatar.jpg'
  )
  with check (
    bucket_id = 'avatars'
    and name = auth.uid()::text || '/avatar.jpg'
  );

drop policy if exists "Users can delete own avatar" on storage.objects;
create policy "Users can delete own avatar"
  on storage.objects for delete
  using (
    bucket_id = 'avatars'
    and name = auth.uid()::text || '/avatar.jpg'
  );

-- V-01: make all recompute aggregates exclude administrators and synthetic
-- accounts, matching public_board_meta().
create or replace function public.pairwise_wins()
returns table (winner uuid, loser uuid, weight double precision, wins bigint)
language sql
stable
security definer
set search_path = public
as $$
  with eligible_users as (
    select u.id
    from auth.users u
    left join public.profiles p on p.id = u.id
    where coalesce(p.is_admin, false) = false
      and coalesce(u.raw_user_meta_data->>'synthetic', 'false') <> 'true'
      and lower(coalesce(u.email, '')) not like '%@test.coasterrank.dev'
  ),
  ranked as (
    select ur.user_id, ur.coaster_id, ur.rank,
           count(*) over (partition by ur.user_id) as n
    from public.user_rides ur
    join eligible_users eu on eu.id = ur.user_id
    where ur.rank is not null
  ),
  pairs as (
    select a.coaster_id as winner,
           b.coaster_id as loser,
           1.0 / (a.n * (a.n - 1) / 2) as pair_weight
    from ranked a
    join ranked b
      on a.user_id = b.user_id
     and a.coaster_id <> b.coaster_id
     and a.rank < b.rank
  )
  select winner, loser, sum(pair_weight)::double precision, count(*)
  from pairs
  group by winner, loser;
$$;

create or replace function public.ranked_participants()
returns table (coaster_id uuid, participants bigint)
language sql
stable
security definer
set search_path = public
as $$
  select ur.coaster_id, count(distinct ur.user_id)
  from public.user_rides ur
  join public.profiles p on p.id = ur.user_id
  join auth.users u on u.id = ur.user_id
  where ur.rank is not null
    and p.is_admin = false
    and coalesce(u.raw_user_meta_data->>'synthetic', 'false') <> 'true'
    and lower(coalesce(u.email, '')) not like '%@test.coasterrank.dev'
  group by ur.coaster_id;
$$;

create or replace function public.first_place_counts()
returns table (coaster_id uuid, first_place_votes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select ur.coaster_id, count(*)
  from public.user_rides ur
  join public.profiles p on p.id = ur.user_id
  join auth.users u on u.id = ur.user_id
  where ur.rank = 1
    and p.is_admin = false
    and coalesce(u.raw_user_meta_data->>'synthetic', 'false') <> 'true'
    and lower(coalesce(u.email, '')) not like '%@test.coasterrank.dev'
  group by ur.coaster_id;
$$;

create or replace function public.ranked_user_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(distinct ur.user_id)
  from public.user_rides ur
  join public.profiles p on p.id = ur.user_id
  join auth.users u on u.id = ur.user_id
  where ur.rank is not null
    and p.is_admin = false
    and coalesce(u.raw_user_meta_data->>'synthetic', 'false') <> 'true'
    and lower(coalesce(u.email, '')) not like '%@test.coasterrank.dev';
$$;

-- Preserve the service-role-only boundary after replacing the function bodies.
revoke execute on function public.pairwise_wins() from public, anon, authenticated;
grant execute on function public.pairwise_wins() to service_role;
revoke execute on function public.ranked_participants() from public, anon, authenticated;
grant execute on function public.ranked_participants() to service_role;
revoke execute on function public.first_place_counts() from public, anon, authenticated;
grant execute on function public.first_place_counts() to service_role;
revoke execute on function public.ranked_user_count() from public, anon, authenticated;
grant execute on function public.ranked_user_count() to anon, authenticated;

-- C-02b + H-08: keep user-controlled text bounded and single-line before it
-- reaches the Telegram admin channel. No parse_mode is used.
create or replace function public.telegram_safe_text(p_text text, p_max_len integer default 80)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select left(regexp_replace(p_text, E'[\\r\\n]+', ' ', 'g'), greatest(p_max_len, 0));
$$;

revoke execute on function public.telegram_safe_text(text, integer) from public, anon, authenticated;

create or replace function public.trigger_notify_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_username text;
begin
  select email into v_email from auth.users where id = new.id;
  if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
    return new;
  end if;
  v_username := public.telegram_safe_text(
    coalesce(new.username, split_part(v_email, '@', 1), 'new user'), 40
  );
  perform public.send_telegram_event('signup_events', '✨ New user: @' || v_username);
  return new;
end;
$$;

create or replace function public.trigger_notify_on_submission()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_username text;
  v_park_name text;
begin
  if new.submitted_by is not null then
    select email into v_email from auth.users where id = new.submitted_by;
    if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
      return new;
    end if;
    select username into v_username from public.profiles where id = new.submitted_by;
    v_username := public.telegram_safe_text(
      coalesce(v_username, split_part(v_email, '@', 1), 'unknown'), 40
    );
  else
    v_username := 'unknown';
  end if;
  if new.park_id is not null then
    select name into v_park_name from public.parks where id = new.park_id;
  end if;
  v_park_name := public.telegram_safe_text(coalesce(v_park_name, new.park_name, 'unknown park'), 80);
  perform public.send_telegram_event(
    'submission_events',
    '📝 Submission: "' || public.telegram_safe_text(new.coaster_name, 80) ||
    '" @ ' || v_park_name || ' — by @' || v_username
  );
  return new;
end;
$$;

create or replace function public.trigger_notify_on_share()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_email text;
  v_username text;
  v_ranked_count bigint;
begin
  if coalesce(old.public_list, false) = false and new.public_list = true then
    select email into v_email from auth.users where id = new.id;
    if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
      return new;
    end if;
    v_username := public.telegram_safe_text(
      coalesce(new.username, split_part(v_email, '@', 1), 'unknown'), 40
    );
    select count(*) into v_ranked_count
    from public.user_rides
    where user_id = new.id and rank is not null;
    perform public.send_telegram_event(
      'share_events',
      '📣 @' || v_username || ' shared their list — ' || v_ranked_count || ' ranked'
    );
  end if;
  return new;
end;
$$;
