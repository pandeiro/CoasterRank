-- Events analytics: real-time signals + kill-switch for Telegram EVENTS
-- (PLAN § Events to Watch). Minimal-privacy: country only (ISO2 from Cloudflare),
-- no raw IP stored. Migrations never applied directly — go through PR → merge → CI.

-- ── analytics_events: append-only log for the 3 real-time signals ──────────
-- signup = new non-synthetic auth.users/profiles row (client fires /api/events after signUp)
-- submission = new coaster_submissions row
-- share = profiles.public_list false→true transition
create table public.analytics_events (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('signup','submission','share')),
  username   text,
  country    text check (country is null or country ~ '^[A-Z]{2}$'),
  meta       jsonb not null default '{}'::jsonb,
  user_id    uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index analytics_events_type_created_idx on public.analytics_events (type, created_at desc);

alter table public.analytics_events enable row level security;

create policy "Admins can view analytics events"
  on public.analytics_events for select
  using (public.is_admin());

-- Inserts come from the Worker via service_role (bypasses RLS).
grant insert on public.analytics_events to service_role;
grant select on public.analytics_events to authenticated;

-- ── app_settings: kill-switches for Telegram EVENTS dispatch ───────────────
-- One row per toggle. Worker reads these per /api/events request; Admin Control Panel
-- writes them. Default ON; flipping OFF silences that event's Telegram without redeploy.
create table public.app_settings (
  key        text primary key check (key in ('signup_events','submission_events','share_events')),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, enabled) values
  ('signup_events', true),
  ('submission_events', true),
  ('share_events', true);

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
