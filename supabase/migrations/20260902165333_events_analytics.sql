-- Real-time Telegram notification triggers + extensible app_settings control panel
-- Migrations never applied directly — go through PR → merge → CI.

-- ── app_settings: extensible kill-switches for Telegram notifications ─────
-- Key-value setting store with labels for dynamic Admin Control Panel rendering.
create table public.app_settings (
  key        text primary key,
  enabled    boolean not null default true,
  label      text,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, enabled, label) values
  ('signup_events', true, 'Signup events'),
  ('submission_events', true, 'Submission events'),
  ('share_events', true, 'Share events')
on conflict (key) do update set label = excluded.label;

alter table public.app_settings enable row level security;

create policy "Admins can view app settings"
  on public.app_settings for select
  using (public.is_admin());

create policy "Admins can update app settings"
  on public.app_settings for update
  using (public.is_admin()) with check (public.is_admin());

grant select, update on public.app_settings to authenticated;

-- Keep updated_at fresh without client clock.
create or replace function public.set_app_settings_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger app_settings_updated_at
  before update on public.app_settings
  for each row execute function public.set_app_settings_updated_at();

-- ── Telegram Event Dispatcher Function (pg_net) ───────────────────────────
create or replace function public.send_telegram_event(
  p_setting_key text,
  p_message text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_enabled boolean;
  v_bot_token text;
  v_chat_id text;
  v_app_env text := coalesce(current_setting('app.settings.app_env', true), 'prod');
begin
  -- Check kill-switch toggle in app_settings
  select enabled into v_enabled
  from public.app_settings
  where key = p_setting_key;

  if not coalesce(v_enabled, true) then
    return;
  end if;

  -- Fetch Telegram bot credentials from Vault
  select decrypted_secret into v_bot_token
  from vault.decrypted_secrets
  where name in ('events_bot_token', 'alerts_bot_token')
  order by case when name = 'events_bot_token' then 1 else 2 end
  limit 1;

  select decrypted_secret into v_chat_id
  from vault.decrypted_secrets
  where name = 'telegram_user_id'
  limit 1;

  if v_bot_token is null or v_chat_id is null then
    return;
  end if;

  -- Asynchronous background HTTP POST via pg_net (non-blocking)
  perform net.http_post(
    url := 'https://api.telegram.org/bot' || v_bot_token || '/sendMessage',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'chat_id', v_chat_id,
      'text', '[' || v_app_env || '] ' || p_message
    ),
    timeout_milliseconds := 5000
  );
exception when others then
  -- Failures in background notifications must never break the main DB transaction.
  null;
end;
$$;

revoke execute on function public.send_telegram_event(text, text) from public, anon, authenticated;

-- ── 1. Signup Trigger (Profiles INSERT) ───────────────────────────────────
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
  select email into v_email
  from auth.users
  where id = new.id;

  -- Filter synthetic test users
  if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
    return new;
  end if;

  v_username := coalesce(new.username, split_part(v_email, '@', 1), 'new user');

  perform public.send_telegram_event(
    'signup_events',
    '✨ New user: @' || v_username
  );

  return new;
end;
$$;

create trigger on_profile_created_notify_telegram
  after insert on public.profiles
  for each row execute function public.trigger_notify_on_signup();

-- ── 2. Submission Trigger (Coaster Submissions INSERT) ─────────────────────
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
    select email into v_email
    from auth.users
    where id = new.submitted_by;

    if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
      return new;
    end if;

    select username into v_username
    from public.profiles
    where id = new.submitted_by;

    v_username := coalesce(v_username, split_part(v_email, '@', 1), 'unknown');
  else
    v_username := 'unknown';
  end if;

  if new.park_id is not null then
    select name into v_park_name
    from public.parks
    where id = new.park_id;
  end if;
  v_park_name := coalesce(v_park_name, new.park_name, 'unknown park');

  perform public.send_telegram_event(
    'submission_events',
    '📝 Submission: "' || new.coaster_name || '" @ ' || v_park_name || ' — by @' || v_username
  );

  return new;
end;
$$;

create trigger on_submission_created_notify_telegram
  after insert on public.coaster_submissions
  for each row execute function public.trigger_notify_on_submission();

-- ── 3. Share Enable Trigger (Profiles UPDATE) ──────────────────────────────
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
    select email into v_email
    from auth.users
    where id = new.id;

    if v_email is not null and lower(v_email) like '%@test.coasterrank.dev' then
      return new;
    end if;

    v_username := coalesce(new.username, split_part(v_email, '@', 1), 'unknown');

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

create trigger on_profile_share_notify_telegram
  after update on public.profiles
  for each row execute function public.trigger_notify_on_share();
