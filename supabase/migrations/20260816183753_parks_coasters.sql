-- Reference tables: manufacturers, parks, coasters.
-- Public read; admin write (RLS policies installed in a later migration).
-- See docs/PLAN.md section 4.1.

-- Enums ------------------------------------------------------------------
create type coaster_status as enum (
  'operating', 'defunct', 'sbno', 'under_construction', 'relocated', 'unknown'
);

create type coaster_material as enum (
  'steel', 'wood', 'hybrid', 'other'
);

-- manufacturers ----------------------------------------------------------
create table public.manufacturers (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  country text
);

-- parks ------------------------------------------------------------------
create table public.parks (
  id   uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  country text,
  region  text,
  city    text,
  lat     numeric(9, 6) check (lat between -90 and 90),
  lng     numeric(9, 6) check (lng between -180 and 180),
  source      text not null default 'admin',
  external_id text
);

-- coasters ---------------------------------------------------------------
create table public.coasters (
  id             uuid primary key default gen_random_uuid(),
  park_id        uuid not null references public.parks (id) on delete cascade,
  name           text not null,
  slug           text not null,
  manufacturer_id uuid references public.manufacturers (id) on delete set null,
  model          text,
  opening_date   date,
  status         coaster_status not null default 'unknown',
  material       coaster_material not null default 'other',
  height_m       numeric check (height_m >= 0),
  speed_kmh      numeric check (speed_kmh >= 0),
  length_m       numeric check (length_m >= 0),
  inversions     integer check (inversions >= 0),
  type           text,
  source         text not null default 'admin',
  external_id    text,
  unique (park_id, slug)
);

-- Indexes (PLAN §4.5) ----------------------------------------------------
create index coasters_park_id_idx        on public.coasters (park_id);
create index coasters_manufacturer_id_idx on public.coasters (manufacturer_id);
create index coasters_status_idx         on public.coasters (status);
create index coasters_slug_idx            on public.coasters (slug);