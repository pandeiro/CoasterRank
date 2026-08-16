-- User + submission tables, and the auto-profile trigger on auth.users.
-- RLS installed in a later migration. See PLAN §4.2 / §4.3.

-- Submission status enum (lives here next to the submissions table) -------
create type submission_status as enum ('pending', 'approved', 'rejected');

-- profiles ---------------------------------------------------------------
-- id is 1:1 with auth.users (PK + FK). Created by handle_new_user() trigger.
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text unique,
  display_name text,
  avatar_url  text,
  is_admin    boolean not null default false
);

-- user_rides -------------------------------------------------------------
create table public.user_rides (
  user_id   uuid not null references auth.users (id) on delete cascade,
  coaster_id uuid not null references public.coasters (id) on delete cascade,
  ridden    boolean not null default true,
  rank      integer check (rank is null or rank >= 1),
  primary key (user_id, coaster_id)
);

-- coaster_submissions ----------------------------------------------------
create table public.coaster_submissions (
  id              uuid primary key default gen_random_uuid(),
  coaster_name    text not null,
  park_name       text not null,
  park_id         uuid references public.parks (id) on delete set null,
  suggested_fields jsonb not null default '{}'::jsonb,
  submitted_by    uuid not null references auth.users (id) on delete cascade,
  status          submission_status not null default 'pending',
  reviewer_note   text,
  reviewed_by     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  reviewed_at     timestamptz
);

-- Indexes (PLAN §4.5) ----------------------------------------------------
-- composite (user_id, rank) is the pairwise-win self-join hot path
create index user_rides_user_id_rank_idx on public.user_rides (user_id, rank);
create index coaster_submissions_status_idx on public.coaster_submissions (status);

-- handle_new_user() ------------------------------------------------------
-- Inserts a profiles row the moment a new auth.users row is created, so the
-- FK and the is_admin bootstrap always have a row to attach to.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'username',
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();