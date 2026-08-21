# CoasterRank Current Database Schema

Generated from all Supabase migrations in chronological order. This represents the complete schema as of the latest migration.

---

## Enums

```sql
-- Migration: 20260816183753_parks_coasters.sql
create type coaster_status as enum (
  'operating',
  'defunct',
  'sbno',                 -- Standing But Not Operating
  'under_construction',
  'relocated',
  'unknown'
);

create type coaster_material as enum (
  'steel',
  'wood',
  'hybrid',
  'other'
);

-- Migration: 20260816183755_profiles_rides_submissions.sql
create type submission_status as enum (
  'pending',
  'approved',
  'rejected'
);
```

---

## Tables

### 1. `public.manufacturers`

```sql
-- Migration: 20260816183753_parks_coasters.sql
create table public.manufacturers (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  slug    text not null unique,
  country text
);

-- Indexes (PLAN §4.5)
-- (no explicit indexes on manufacturers; slug has implicit unique index)
```

**Purpose**: Reference table for coaster manufacturers.
**RLS**: Public read; admin write (see RLS policies).

---

### 2. `public.parks`

```sql
-- Migration: 20260816183753_parks_coasters.sql
create table public.parks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  country      text,
  region       text,
  city         text,
  lat          numeric(9, 6) check (lat between -90 and 90),
  lng          numeric(9, 6) check (lng between -180 and 180),
  source       text not null default 'admin',        -- 'open-csv', 'admin', 'community'
  external_id  text
);

-- Indexes (PLAN §4.5)
create index parks_slug_idx on public.parks (slug);
```

**Purpose**: Reference table for amusement/theme parks.
**Provenance**: `source` tracks origin (`open-csv` for initial import, `admin` for manual, `community` for approved submissions). `external_id` stores source-native key for idempotent re-imports.
**RLS**: Public read; admin write.

---

### 3. `public.coasters`

```sql
-- Migration: 20260816183753_parks_coasters.sql
create table public.coasters (
  id               uuid primary key default gen_random_uuid(),
  park_id          uuid not null references public.parks (id) on delete cascade,
  name             text not null,
  slug             text not null,
  manufacturer_id  uuid references public.manufacturers (id) on delete set null,
  model            text,
  opening_date     date,
  status           coaster_status not null default 'unknown',
  material         coaster_material not null default 'other',
  height_m         numeric check (height_m >= 0),
  speed_kmh        numeric check (speed_kmh >= 0),
  length_m         numeric check (length_m >= 0),
  inversions       integer check (inversions >= 0),
  type             text,                              -- free-text classification (e.g., "sit-down", "inverted", "launched")
  source           text not null default 'admin',      -- 'open-csv', 'admin', 'community'
  external_id      text,
  unique (park_id, slug)
);

-- Indexes (PLAN §4.5)
create index coasters_park_id_idx         on public.coasters (park_id);
create index coasters_manufacturer_id_idx on public.coasters (manufacturer_id);
create index coasters_status_idx          on public.coasters (status);
create index coasters_slug_idx            on public.coasters (slug);
```

**Purpose**: Canonical coaster table, anchored to parks.
**Key constraint**: `unique (park_id, slug)` allows same coaster name across different parks.
**Provenance**: Same `source`/`external_id` pattern as parks for idempotent imports.
**RLS**: Public read; admin write.

---

### 4. `public.profiles`

```sql
-- Migration: 20260816183755_profiles_rides_submissions.sql
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  username     text unique,
  display_name text,
  avatar_url   text,
  is_admin     boolean not null default false
);

-- Column-level grants (Migration: 20260816183758_rls_policies.sql)
revoke update on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_url) on public.profiles to authenticated;
-- is_admin is NOT grantable to anon/authenticated; only SQL editor/service_role can set it
```

**Purpose**: User profile extension of `auth.users`.
**Creation**: Auto-created by `handle_new_user()` trigger on `auth.users` INSERT.
**Username handling**: Signup metadata username may be NULL if taken; user claims later on profile page.
**RLS**: Own row select/update only. `is_admin` column protected via column grants.

---

### 5. `public.user_rides`

```sql
-- Migration: 20260816183755_profiles_rides_submissions.sql
create table public.user_rides (
  user_id     uuid not null references auth.users (id) on delete cascade,
  coaster_id  uuid not null references public.coasters (id) on delete cascade,
  ridden      boolean not null default true,
  rank        integer check (rank is null or rank >= 1),
  primary key (user_id, coaster_id)
);

-- Indexes (PLAN §4.5)
-- Composite (user_id, rank) is the pairwise-win self-join hot path
create index user_rides_user_id_rank_idx on public.user_rides (user_id, rank);
```

**Purpose**: User's ridden coasters with personal ranking.
**Semantics**: `rank = 1` is top of user's list; `null` = ridden but unranked. Drag-sort renumbers gaplessly on save.
**Cascade**: `coaster_id` FK `ON DELETE CASCADE` so defunct/removed coasters cleanly drop out.
**RLS**: Own rows only + email-confirmed gate on all writes (INSERT/UPDATE/DELETE require `user_email_verified()`).

---

### 6. `public.coaster_submissions`

```sql
-- Migration: 20260816183755_profiles_rides_submissions.sql
create table public.coaster_submissions (
  id               uuid primary key default gen_random_uuid(),
  coaster_name     text not null,
  park_name        text not null,
  park_id          uuid references public.parks (id) on delete set null,
  suggested_fields jsonb not null default '{}'::jsonb,
  submitted_by     uuid not null references auth.users (id) on delete cascade,
  status           submission_status not null default 'pending',
  reviewer_note    text,
  reviewed_by      uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  reviewed_at      timestamptz
);

-- Indexes (PLAN §4.5)
create index coaster_submissions_status_idx on public.coaster_submissions (status);
```

**Purpose**: User-submitted coaster proposals for admin moderation.
**Workflow**: User submits → `pending` → Admin approves (creates coaster row, keeps submission for audit) or rejects.
**RLS**: 
- INSERT: Own submissions only, email confirmed, **and** under pending cap (max 5 pending per user)
- SELECT: Own submissions + admins
- UPDATE/DELETE: Admins only

---

### 7. `public.coaster_ratings`

```sql
-- Migration: 20260816183756_rankings_view.sql
create table public.coaster_ratings (
  coaster_id   uuid primary key references public.coasters (id) on delete cascade,
  score        numeric not null default 0,           -- Bradley-Terry latent strength
  comparisons  integer not null default 0,           -- Total weighted comparisons
  wins         integer not null default 0,           -- Total weighted wins
  participants integer not null default 0,           -- Distinct users ranking this coaster
  updated_at   timestamptz not null default now()
);
```

**Purpose**: Stores Bradley-Terry ranking output from the recompute job.
**Write path**: Only `service_role` (Edge Function) writes; no RLS write policies = default-deny for anon/authenticated.
**Read**: Public.

---

### 8. `public.v_coaster_rankings` (View)

```sql
-- Migration: 20260816214541_relax_rankings_view.sql (replaces 20260816183756_rankings_view.sql)
-- Migration: 20260820143144_fix_rank_null_scores.sql (further fix)
create or replace view public.v_coaster_rankings as
select
  c.*,
  r.score,
  r.comparisons,
  r.participants,
  case
    when r.score is not null then row_number() over (order by r.score desc)
  end as rank
from public.coasters c
left join public.coaster_ratings r on r.coaster_id = c.id;
```

**Evolution**:
1. **Original** (20260816183756): `status = 'operating'` filter + park/manufacturer joins.
2. **Relaxed** (20260816214541): Dropped status filter (SPA owns client-side filtering); dropped joins (client-side join of cached reference data).
3. **Null-score fix** (20260820143144): Only assign `rank` when `score IS NOT NULL`. When `coaster_ratings` is empty (no user rankings yet), all scores are null and `row_number()` was assigning arbitrary ranks 1,2,3... based on physical row order. Now unrated coasters get `rank = NULL`.

**RLS**: Public read (granted to anon, authenticated).

---

## Functions

### `public.handle_new_user()` — Trigger Function

```sql
-- Migration: 20260816203325_handle_new_user_username_fallback.sql (replaces original)
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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

**Behavior**: Creates profile row on signup. If username from metadata is taken (unique violation), falls back to `NULL` username — user claims one later on profile page. Never blocks signup.

---

### `public.is_admin()` — Security Definer Helper

```sql
-- Migration: 20260816183758_rls_policies.sql
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
```

**Purpose**: Checks if current JWT subject is admin. Security definer to read `profiles.is_admin` regardless of caller's RLS (no recursion).

---

### `public.user_email_verified(p_user_id uuid)` — Security Definer Helper

```sql
-- Migration: 20260816183758_rls_policies.sql
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
```

**Purpose**: Email-confirmed gate for RLS. Security definer so RLS can read `auth.users.email_confirmed_at`.

---

### `public.pairwise_wins()` — Security Definer RPC

```sql
-- Migration: 20260817170724_bt_recompute_pg_cron.sql
create or replace function public.pairwise_wins()
returns table (winner uuid, loser uuid, weight double precision, wins bigint)
language sql
stable
security definer
set search_path = public
as $$
  with ranked as (
    select user_id, coaster_id, rank,
           count(*) over (partition by user_id) as n
    from public.user_rides
    where rank is not null
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

revoke execute on function public.pairwise_wins() from public, anon, authenticated;
grant execute on function public.pairwise_wins() to service_role;
```

**Purpose**: Aggregates per-user-normalized pairwise wins for BT recompute.
**Normalization**: User with n ranked coasters contributes n*(n-1)/2 pairs at weight 1/(n*(n-1)/2) each → every user ≈ 1 unit of influence.
**Security**: `EXECUTE` revoked from public/anon/authenticated; granted to `service_role` only. Not exposed as public PostgREST RPC.

---

### `public.ranked_participants()` — Security Definer RPC

```sql
-- Migration: 20260817170724_bt_recompute_pg_cron.sql
create or replace function public.ranked_participants()
returns table (coaster_id uuid, participants bigint)
language sql
stable
security definer
set search_path = public
as $$
  select coaster_id, count(distinct user_id)
  from public.user_rides
  where rank is not null
  group by coaster_id;
$$;

revoke execute on function public.ranked_participants() from public, anon, authenticated;
grant execute on function public.ranked_participants() to service_role;
```

**Purpose**: Counts distinct users ranking each coaster (for `participants` column in `coaster_ratings`).
**Security**: Same as `pairwise_wins()`.

---

### `public.recompute_rankings_cron()` — Cron Entrypoint

```sql
-- Migration: 20260817170724_bt_recompute_pg_cron.sql
create or replace function public.recompute_rankings_cron()
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'recompute_auth_secret'
  limit 1;

  select decrypted_secret into v_url
  from vault.decrypted_secrets
  where name = 'recompute_function_url'
  limit 1;

  if v_url is null or v_secret is null then
    raise warning 'recompute_rankings_cron: vault secrets recompute_function_url / recompute_auth_secret not set; skipping';
    return;
  end if;

  -- 60s timeout: full recompute (2 RPCs + MM fit + chunked upserts) can exceed pg_net's ~5s default
  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function public.recompute_rankings_cron() from public, anon, authenticated;
```

**Purpose**: Called by `pg_cron` every 15 minutes. Reads Edge Function URL + shared secret from Supabase Vault (no env values in migrations). POSTs to Edge Function via `pg_net`.
**Bootstrap**: Vault secrets set once via SQL (see AGENTS.md runbook).
**Missing secrets**: Job no-ops silently (warns in cron logs).

---

### `public.submission_within_cap()` — Anti-Abuse Helper

```sql
-- Migration: 20260819231049_submission_cap.sql
create or replace function public.submission_within_cap()
returns boolean
language sql
security definer
set search_path = public
as $$
  select (
    select count(*)
    from public.coaster_submissions
    where submitted_by = auth.uid() and status = 'pending'
  ) < 5;
$$;
```

**Purpose**: Enforces max 5 pending submissions per user. Security definer avoids RLS recursion (policy counts caller's rows without hitting the policy it's evaluating).
**Used in**: Updated `submissions owner insert` policy (replaces original).

---

## pg_cron Schedule

```sql
-- Migration: 20260817170724_bt_recompute_pg_cron.sql
do $$
begin
  if exists (select 1 from cron.job where jobname = 'recompute-rankings') then
    perform cron.unschedule('recompute-rankings');
  end if;
  perform cron.schedule(
    'recompute-rankings',
    '*/15 * * * *',     -- every 15 minutes
    $cron$ select public.recompute_rankings_cron(); $cron$
  );
end;
$$;
```

**Requires**: `pg_cron` extension, `pg_net` extension (in `extensions` schema).

---

## Extensions

```sql
-- Migration: 20260817170724_bt_recompute_pg_cron.sql
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
```

---

## RLS Policies Summary

| Table | SELECT | INSERT | UPDATE | DELETE |
|-------|--------|--------|--------|--------|
| `manufacturers` | Public | Admin | Admin | Admin |
| `parks` | Public | Admin | Admin | Admin |
| `coasters` | Public | Admin | Admin | Admin |
| `profiles` | Own row | — (trigger) | Own row (username, display_name, avatar_url only) | — |
| `user_rides` | Own rows | Own + email verified | Own + email verified | Own + email verified |
| `coaster_submissions` | Own + Admin | Own + email verified + cap | Admin | Admin |
| `coaster_ratings` | Public | — | — | — |

**Note**: `service_role` bypasses RLS entirely (used by Edge Function for `coaster_ratings` writes and RPC calls).

---

## Privileges (Data API Exposure)

```sql
-- Migration: 20260816183758_rls_policies.sql + 20260818180500_service_role_default_grants.sql
grant usage on schema public to anon, authenticated;

-- Reference tables
grant select on public.manufacturers, public.parks, public.coasters to anon, authenticated;
grant insert, update, delete on public.manufacturers, public.parks, public.coasters to authenticated;

-- Profiles (column-level for is_admin protection)
revoke update on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (username, display_name, avatar_url) on public.profiles to authenticated;

-- User rides
grant select, insert, update, delete on public.user_rides to authenticated;

-- Submissions
grant select, insert, update, delete on public.coaster_submissions to authenticated;

-- Ratings (read only for clients)
grant select on public.coaster_ratings to anon, authenticated;

-- View
grant select on public.v_coaster_rankings to anon, authenticated;

-- Service role (for Edge Functions)
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO service_role;
```

---

## Trigger

```sql
-- Migration: 20260816183755_profiles_rides_submissions.sql
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

---

## Migration Order (Chronological)

1. `20260816183753_parks_coasters.sql` — Reference tables (manufacturers, parks, coasters) + enums
2. `20260816183755_profiles_rides_submissions.sql` — User tables (profiles, user_rides, coaster_submissions) + handle_new_user trigger
3. `20260816183756_rankings_view.sql` — coaster_ratings + v_coaster_rankings (initial, with operating filter + joins)
4. `20260816183758_rls_policies.sql` — All RLS policies, helper functions, privileges
5. `20260816203325_handle_new_user_username_fallback.sql` — Hardened handle_new_user (username fallback to NULL)
6. `20260816214541_relax_rankings_view.sql` — Relaxed v_coaster_rankings (no status filter, no joins)
7. `20260817170724_bt_recompute_pg_cron.sql` — BT recompute RPCs, cron function, pg_cron schedule
8. `20260818180500_service_role_default_grants.sql` — Fix service_role grants (backfill + default privileges)
9. `20260819231049_submission_cap.sql` — Submission pending cap (5) + updated insert policy

---

## Key Design Decisions (from PLAN.md)

- **No table prefix**: Dedicated Supabase project → no shared-DB concerns.
- **All tables in `public` schema**.
- **RLS is the security boundary**: PostgREST + RLS; `service_role` bypasses RLS for Edge Functions.
- **Per-user normalization**: Each user contributes ~1 unit of influence regardless of list length.
- **Batch recompute**: pg_cron every 15 min + manual admin button; Edge Function does MM fitting.
- **View normalization**: `v_coaster_rankings` is denormalized for the board (client-side joins for park/manufacturer).
- **Email confirmation required**: RLS gate via `user_email_verified()` on all `user_rides` writes.
- **Admin bootstrap**: One-time SQL sets `profiles.is_admin = true` for chosen email.