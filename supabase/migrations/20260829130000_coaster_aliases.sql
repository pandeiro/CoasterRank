-- Coaster aliases: track alternate / historical names for a coaster.
-- Simple list (no date ranges or notes), displayed as smaller text on the
-- coaster detail page and managed through the admin form.

create table public.coaster_aliases (
  id         uuid primary key default gen_random_uuid(),
  coaster_id uuid not null references public.coasters (id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

-- Prevent duplicate alias names per coaster
create unique index coaster_aliases_coaster_name_idx
  on public.coaster_aliases (coaster_id, name);

-- RLS: public read, admin manage (same pattern as coasters)
alter table public.coaster_aliases enable row level security;

create policy "coaster_aliases public read"
  on public.coaster_aliases for select using (true);
create policy "coaster_aliases admin manage"
  on public.coaster_aliases for all
  using (public.is_admin()) with check (public.is_admin());

-- Privileges: anon may read; authenticated needs write for admin users
grant select on public.coaster_aliases to anon, authenticated;
grant insert, update, delete on public.coaster_aliases to authenticated;
