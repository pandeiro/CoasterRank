-- Row-Level Security for all tables, plus the helper functions the policies
-- depend on. See PLAN §4 (table-specific notes) and §4.6 (email-confirmed gate).
--
-- Roles: anon / authenticated talk to PostgREST under RLS; service_role bypasses
-- RLS entirely, so coaster_ratings writes (the Edge Function) need no policy.

-- Helper functions -------------------------------------------------------
-- is_admin(): is the current JWT subject an admin? Security-definer so it can
-- read profiles.is_admin regardless of the caller's RLS (no recursion: it reads
-- profiles, not the table a policy is evaluating on).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = auth.uid()),
    false
  );
$$;

-- user_email_verified(uid): is this user's email confirmed? Security-definer
-- so RLS can read auth.users.email_confirmed_at (the email-confirmed gate).
create or replace function public.user_email_verified(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(
    (select email_confirmed_at is not null from auth.users where id = p_user_id),
    false
  );
$$;

-- Enable RLS --------------------------------------------------------------
alter table public.manufacturers      enable row level security;
alter table public.parks              enable row level security;
alter table public.coasters           enable row level security;
alter table public.profiles           enable row level security;
alter table public.user_rides         enable row level security;
alter table public.coaster_submissions enable row level security;
alter table public.coaster_ratings    enable row level security;

-- Reference tables: public read, admin write -----------------------------
-- "admin manage" covers insert/update/delete (SELECT is also granted by it but
-- ORs with the public-read policy, so non-admins still get read).
create policy "manufacturers public read"
  on public.manufacturers for select using (true);
create policy "manufacturers admin manage"
  on public.manufacturers for all
  using (public.is_admin()) with check (public.is_admin());

create policy "parks public read"
  on public.parks for select using (true);
create policy "parks admin manage"
  on public.parks for all
  using (public.is_admin()) with check (public.is_admin());

create policy "coasters public read"
  on public.coasters for select using (true);
create policy "coasters admin manage"
  on public.coasters for all
  using (public.is_admin()) with check (public.is_admin());

-- profiles: own row only --------------------------------------------------
-- No INSERT policy (the handle_new_user() trigger creates the row; users can't
-- forge one). No DELETE policy (don't let a user drop their profile row).
-- is_admin is protected below via column grants — only username/display_name/
-- avatar_url are updateable by client roles.
create policy "profiles own select"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles own update"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- user_rides: own rows only + email-confirmed gate on all writes ---------
create policy "user_rides own select"
  on public.user_rides for select
  using (user_id = auth.uid());

create policy "user_rides own insert"
  on public.user_rides for insert
  with check (user_id = auth.uid() and public.user_email_verified(auth.uid()));

create policy "user_rides own update"
  on public.user_rides for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.user_email_verified(auth.uid()));

create policy "user_rides own delete"
  on public.user_rides for delete
  using (user_id = auth.uid() and public.user_email_verified(auth.uid()));

-- coaster_submissions: insert own (confirmed); select own + admin; admin edit
create policy "submissions owner insert"
  on public.coaster_submissions for insert
  with check (submitted_by = auth.uid() and public.user_email_verified(auth.uid()));

create policy "submissions owner or admin select"
  on public.coaster_submissions for select
  using (submitted_by = auth.uid() or public.is_admin());

create policy "submissions admin update"
  on public.coaster_submissions for update
  using (public.is_admin()) with check (public.is_admin());

create policy "submissions admin delete"
  on public.coaster_submissions for delete
  using (public.is_admin());

-- coaster_ratings: public read, service-role write -----------------------
-- No write policies => default-deny for anon/authenticated; the Edge Function
-- (service_role) bypasses RLS.
create policy "coaster_ratings public read"
  on public.coaster_ratings for select using (true);

-- Privileges --------------------------------------------------------------
-- Supabase's current default does NOT auto-expose new tables to the Data API
-- roles; without these GRANTs, queries are rejected at the privilege check
-- before RLS even applies. anon = public read; authenticated = the same reads
-- plus the client writes that RLS then filters to "own"/"admin" per the policies.
grant usage on schema public to anon, authenticated;

-- Reference: anon may read; authenticated also needs write so admin users can
-- manage rows (RLS restricts writes to is_admin() only).
grant select on public.manufacturers, public.parks, public.coasters to anon, authenticated;
grant insert, update, delete on public.manufacturers, public.parks, public.coasters to authenticated;

-- profiles: a user can read and update their own row, but is_admin must stay
-- un-updateable by client roles (only the SQL-editor/service bootstrap sets it).
-- We grant UPDATE on ONLY the safe columns — column grants override a blanket
-- UPDATE, so is_admin is never writable by anon/authenticated.
revoke update on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_url) on public.profiles to authenticated;

-- user_rides: a confirmed user manages their own rows (RLS + email gate).
grant select, insert, update, delete on public.user_rides to authenticated;

-- coaster_submissions: confirmed users submit + read their own; admins moderate.
grant select, insert, update, delete on public.coaster_submissions to authenticated;

-- coaster_ratings: public read only; writes come through the service_role.
grant select on public.coaster_ratings to anon, authenticated;

-- The public board view.
grant select on public.v_coaster_rankings to anon, authenticated;