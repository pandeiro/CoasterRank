# CoasterRank — Plan

> The authoritative source of truth for CoasterRank's architecture, data model, algorithm, and delivery phasing. Update this document as decisions evolve; treat it as a living doc, not a one-time artifact.

## 1. Vision

A multi-user webapp where users rank the roller coasters they've ridden, and every visitor sees a live global ranking derived from the cumulative input of all users.

- Users sign up, mark ridden coasters, and drag-sort them into a personal ranked list.
- Visitors (no login) see a live public board ordered by a Bradley-Terry score computed from everyone's pairwise preferences.
- Each user contributes roughly one unit of influence regardless of list length, so casual fans aren't drowned out by power users.

## 2. Locked decisions

| Area | Decision | Rationale |
| --- | --- | --- |
| Backend | **No custom API server.** SPA talks to Supabase PostgREST directly. | Simplest stack for v1; zero backend to host. |
| Auth | **Supabase Auth** (email/password now; OAuth later). | Dedicated Supabase instance; integrates with RLS via JWT. Email confirmation **required** before ranking. |
| Data access | **Row-Level Security** for all access control. | PostgREST + RLS is the security boundary. |
| Migrations | **Supabase CLI** built-in migrations. | Dedicated instance → no shared-DB concerns, no custom runner, **no table prefix**. |
| Instance | **New dedicated Supabase project** for CoasterRank. | Removes the shared-instance/multi-tenant need that originally motivated table prefixes. |
| Frontend | **React + Vite + TypeScript SPA**, Tailwind. | SEO/static-build not needed now; could evolve toward a wiki later. |
| Ranking input | **Ordered drag-sort list** of ridden coasters (`@dnd-kit/sortable`). | Familiar UX; pairwise wins are derivable; supports the BT aggregation. |
| Algorithm | **Bradley-Terry batch** (MM algorithm, L2-regularized). | Statistically principled latent-strength model; handles sparse/partial data; recompute job is fine for v1 scale. |
| Per-user weighting | **Normalize per user** (1 user ≈ 1 unit of influence). | Prevents power users with 200 coasters from dominating. |
| Recompute cadence | **pg_cron every 15 min** + manual admin button. | "Live" feel within 15 min; cheap on Supabase quotas. |
| Reference data | **Open CSV import + admin additions + user submission/moderation queue.** | Legally clean, realistic, community-growable. |
| Seed dataset | **Rob Mulla's Wikipedia-derived CC0 `coaster_db.csv`** (~1,000 coasters, public domain). | Avoids RCDB's Terms-of-Service prohibition on data reuse; larger 11k RCDB-derived datasets are explicitly **not** used. |
| Admin bootstrap | **One-time SQL** sets `profiles.is_admin = true` for a chosen email. | Simple, auditable, standard Supabase pattern. |

## 3. Architecture

```
Browser (SPA)  ──HTTPS──►  Supabase PostgREST (RLS-filtered)  ──►  Postgres tables
                              │
                              ▼  (auth.jwt() drives RLS)
                         Supabase Auth (JWT, email confirmation)

pg_cron (every 15 min) ──► pg_net ──► Edge Function `recompute-rankings`
                                          │ reads aggregated pairwise wins
                                          ▼
                                     packages/bt (MM)
                                          │ upserts scores
                                          ▼
                                 coaster_ratings  ──►  v_coaster_rankings (view)
                                          ▲
Admin "Recompute now" button ─────────────┘
```

No custom backend. The only server-side code is the Deno Edge Function plus client-side SQL migrations and a one-time import script.

### 3.1 Tech stack

- **Frontend**: React 18, Vite, TypeScript, React Router, TanStack Query, `@supabase/supabase-js`, Tailwind CSS, `@dnd-kit/sortable`, lucide-react.
- **Edge**: Deno (Supabase Edge Functions) for the BT recompute job.
- **Migrations/seed**: Supabase CLI (`supabase/migrations`, `supabase/seed.sql`).
- **Quality**: ESLint + Prettier, `tsc --noEmit`, **Vitest**. Commands documented in `AGENTS.md`.
- **Env** (`.env.example`): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (scripts/edge only).

## 4. Data model

All tables live in the `public` schema (no prefix). Migrations under `supabase/migrations/`.

### 4.1 Reference tables — RLS: public read, admin write

- **`manufacturers`(id, name, slug UNIQUE, country)**
- **`parks`(id, name, slug UNIQUE, country, region, city, lat, lng, source, external_id)**
  - `source` records where the row came from (`open-csv`, `admin`, `community`).
  - `external_id` carries the source's native key for idempotent re-imports.
- **`coasters`(id, park_id→parks, name, slug, manufacturer_id, model, opening_date, status, material, height_m, speed_kmh, length_m, inversions, type, source, external_id)**
  - `UNIQUE(park_id, slug)` — same coaster name can repeat across parks.
  - `status` enum: `operating | defunct | sbno | under_construction | relocated | unknown` (`sbno` = standing but not operating).
  - `material` enum: `steel | wood | hybrid | other`.
  - Same provenance columns (`source`, `external_id`) as `parks` for idempotent imports.

### 4.2 Submissions — RLS: insert own; select own + admins; update admins only

- **`coaster_submissions`(id, coaster_name, park_name, park_id null, suggested_fields jsonb, submitted_by→auth.users, status, reviewer_note, reviewed_by, created_at, reviewed_at)**
  - `status` enum: `pending | approved | rejected`.
  - Admin review marks `approved` → a coaster row is created; the submission is kept for audit.

### 4.3 User tables — RLS: own rows only

- **`profiles`(id→auth.users PK, username UNIQUE, display_name, avatar_url, is_admin bool default false)**
  - Created automatically by a `handle_new_user()` trigger on `auth.users` INSERT.
  - `username` is the public-facing handle; `display_name` can change freely.
- **`user_rides`(user_id→auth.users, coaster_id→coasters, ridden bool default true, rank int null, PK(user_id, coaster_id))**
  - `rank = 1` is the **top** of the user's personal list; `null` = ridden but unranked.
  - Drag-sort reorders in batches; ranks renumbered (gapless positive integers) on save.
  - `coaster_id` FK `ON DELETE CASCADE` so defunct/removed coasters cleanly drop out.

### 4.4 Ranking output — RLS: public read, service-role write

- **`coaster_ratings`(coaster_id PK→coasters, score numeric, comparisons int, wins int, participants int, updated_at)**
  - `score` = Bradley-Terry latent strength.
  - `comparisons`/`wins`/`participants` are diagnostics/transparency metrics surfaced on the public board.
- **`v_coaster_rankings`** (view): `coasters.*` + `score`, `comparisons`, `participants`, `rank = row_number() over (order by score desc)`, filtered to `status = 'operating'`. The SPA board reads this view.

### 4.5 Indexes (non-exhaustive)

- `coasters(park_id)`, `coasters(manufacturer_id)`, `coasters(status)`, `coasters(slug)`.
- `parks(slug)`, `manufacturers(slug)`.
- `user_rides(user_id, rank)` — the pairwise-win self-join's hot path.
- `coaster_submissions(status)` for the admin queue.
- `profiles(username)` unique index.

### 4.6 Bootstrap / runbooks

- **First admin**: after creating your account, run once in the SQL editor:
  ```sql
  update public.profiles set is_admin = true where id = (
    select id from auth.users where email = 'you@example.com'
  );
  ```
  Documented in `AGENTS.md` too.
- **Email confirmation**: enable in Supabase dashboard (Auth → Email); the SPA enforces a "confirm your email before ranking" gate client-side + RLS denies `user_rides` writes until `email_confirmed_at` is set.

## 5. Bradley-Terry batch job

### 5.1 Pairwise-win source

A single SQL self-join on `user_rides`:

```sql
-- per-coaster aggregated wins, using per-user normalized weights
with pairs as (
  select a.coaster_id as winner, b.coaster_id as loser
  from user_rides a
  join user_rides b
    on a.user_id = b.user_id
   and a.coaster_id <> b.coaster_id
   and a.rank is not null and b.rank is not null
   and a.rank < b.rank
)
select winner, loser, count(*) as wins
from pairs
group by winner, loser;
```

**Per-user normalization**: scale each user's pairwise contributions so that a user's **total win contribution** sums to a fixed constant (e.g. 1.0). With `n` ranked coasters, a user contributes `n*(n-1)/2` ordered pairs; each pair is weighted `1 / (n*(n-1)/2)` for that user. Effect: one user ≈ one unit of influence regardless of list length.

### 5.2 The MM algorithm (Hunter 2004)

Implemented in `packages/bt` (pure TS, Deno-compatible), unit-tested with Vitest.

Iterative update, for each coaster `i`:

```
score_i ← score_i * ( Σ_j wins(i,j) ) / ( Σ_j n(i,j) * score_j / (score_i + score_j) )
```

where `n(i,j)` = total weighted comparisons between `i` and `j`, `wins(i,j)` = weighted wins of `i` over `j`. Iterate until max delta < ε or a max iteration count.

### 5.3 Anti-noise measures

- **L2 regularization** (shrink scores toward 0 / the mean) — keeps undefeated and rarely-compared coasters from running to ±∞.
- **Pseudo-comparison-vs-average baseline** — a small virtual comparison between every coaster and a synthetic "average" anchor so items with sparse or one-sided comparisons don't degenerate. Tune as a config constant.
- **Floor on `comparisons`** for display ("few votes" badge) so the board can signal low-confidence ranks to users.

### 5.4 Triggering

- **Scheduled**: `pg_cron` every 15 minutes calls `pg_net` → HTTP POST to the Edge Function.
- **Manual**: admin "Recompute now" button hits the same function with a service-role key.
- **Output**: the function upserts rows in `coaster_ratings`; the view `v_coaster_rankings` is read-live by the SPA.

### 5.5 Edge function contract

```
POST /functions/v1/recompute-rankings
Authorization: Bearer <SERVICE_ROLE_KEY or pg_cron secret>
→ 200 { updated: <int>, durationMs: <int>, iterations: <int> }
```

Reads aggregated pairwise wins from PostgREST (or pgbouncer), runs MM in memory, upserts scores. Stateless and idempotent.

## 6. SPA routes

| Path | Auth | Purpose |
| --- | --- | --- |
| `/` | Public | Live board — search/filter by park/country/manufacturer/material/status; top-N by BT score; vote/participant counts; "few votes" badges. |
| `/coasters/:slug` | Public | Coaster detail — stats, current rank position, comparisons/participants, links to park and manufacturer. |
| `/parks/:slug` | Public | Park detail — its coasters ordered by rank. |
| `/signup` | Public | Supabase Auth email/password + email-confirmation prompt. |
| `/login` | Public | Login. |
| `/me` | Authed + confirmed | "My Coasters" — search-add/remove ridden coasters, `@dnd-kit` drag-sort of ranked list, save → `user_rides`. |
| `/me/profile` | Authed | Username/display name. |
| `/submit` | Authed + confirmed | Propose a new coaster → moderation queue. |
| `/admin` | Admin | Moderate submissions, add/edit coasters, trigger recompute, dashboard. |

## 7. Repo layout

```
CoasterRank/
├── README.md
├── docs/
│   └── PLAN.md                      # this file
├── app/                              # Vite React TS SPA
│   └── src/{pages,components,lib}
├── supabase/
│   ├── migrations/
│   │   0001_parks_coasters.sql
│   │   0002_profiles_rides.sql
│   │   0003_rls_policies.sql
│   │   0004_rankings_views.sql
│   │   0005_edgemap_pg_cron.sql
│   ├── functions/recompute-rankings/ # Deno index.ts + mm.ts
│   └── seed.sql
├── packages/bt/                      # pure TS Bradley-Terry MM (shared edge fn + tests)
├── scripts/import-coasters.ts       # CC0 CSV → parks + coasters (service-role, idempotent)
├── tests/
├── .env.example
└── AGENTS.md                          # commands, runbooks, conventions for AI agents & humans
```

## 8. Phasing (milestones)

- **Phase 0 — Scaffold**: `git init`; Vite + React + TS + Tailwind; Vitest; ESLint + Prettier; `supabase init` + local Docker; `.env.example`; `AGENTS.md` with verified commands.
- **Phase 1 — Schema + RLS**: every table above, `handle_new_user()` trigger, indexes, RLS policies, `v_coaster_rankings` view, the email-confirmed gate.
- **Phase 2 — Reference import**: download CC0 CSV; write/idempotently-run `import-coasters.ts` → `parks` + `coasters`; verify counts.
- **Phase 3 — Auth + profile**: signup, login, session handling, `handle_new_user`, protected routes, profile page, email-confirmation gate.
- **Phase 4 — Public board + detail pages**: reads `v_coaster_rankings` (with a naive interim rating backfilled so the board isn't empty before BT ships); coaster/park detail pages; filters; pagination.
- **Phase 5 — "My Coasters"**: add/remove ridden, `@dnd-kit` drag-sort, save to `user_rides`; rank renumbering; per-user view of own lists.
- **Phase 6 — BT batch**: `packages/bt` MM + unit tests; Edge Function `recompute-rankings`; pg_cron schedule; admin trigger; backfill `coaster_ratings` once real preferences exist.
- **Phase 7 — Admin & moderation**: admin role/RLS, submission queue UI, add/edit coaster forms, recompute-trigger UI.
- **Phase 8 — Hardening**: pagination everywhere, empty/loading/error states, rate limits/anti-abuse on signup + ranking, docs polish.

## 9. Future considerations (explicitly out of v1 scope)

- OAuth providers (Google, GitHub, etc.).
- Public user profiles + shareable ranked lists.
- "Coaster wiki" evolution (rich detail pages, history, photos) — would likely motivate migrating from SPA to SSR (Next.js/SvelteKit) for SEO.
- Incremental / streaming recompute (Elo or TrueSkill) if batch latency becomes a UX issue.
- Forking to a "parks ranking" and "manufacturer ranking" from the same pairwise data.
- ADR-style decision records in `docs/decisions/` if decision churn warrants it (for now this PLAN.md is the single source).

## 10. Open knobs (to revisit later)

- **Pseudo-comparison baseline weight**: the synthetic "average" anchor's contribution — tuned empirically once we have real pairwise data.
- **L2 regularization strength**: a config constant; tune to avoid ±∞ blow-ups on sparse coasters.
- **Per-user-weighting variant**: pure `1/n` (current), vs. `1/sqrt(n)`, vs. a tunable knob — revisit after seeing effect on a real dataset.
- **"Operating only" filter on the live board**: whether `defunct`/`sbno` coasters appear by default or only behind a toggle.