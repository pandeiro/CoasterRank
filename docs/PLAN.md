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

- **Frontend**: React 19, Vite, TypeScript, React Router, TanStack Query, `@supabase/supabase-js`, Tailwind CSS, `@dnd-kit/sortable`, lucide-react.
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
  - If the signup-metadata username is already taken, the trigger falls back to `NULL` rather than failing the signup; the user claims one later on the profile page.
- **`user_rides`(user_id→auth.users, coaster_id→coasters, ridden bool default true, rank int null, PK(user_id, coaster_id))**
  - `rank = 1` is the **top** of the user's personal list; `null` = ridden but unranked.
  - Drag-sort reorders in batches; ranks renumbered (gapless positive integers) on save.
  - `coaster_id` FK `ON DELETE CASCADE` so defunct/removed coasters cleanly drop out.

### 4.4 Ranking output — RLS: public read, service-role write

- **`coaster_ratings`(coaster_id PK→coasters, score numeric, comparisons int, wins int, participants int, updated_at)**
  - `score` = Bradley-Terry latent strength.
  - `comparisons`/`wins`/`participants` are diagnostics/transparency metrics surfaced on the public board.
- **`v_coaster_rankings`** (view): `coasters.*` + `score`, `comparisons`, `participants`, `rank = row_number() over (order by score desc nulls last)`. **Normalized** — no park/manufacturer columns (the SPA fetches those small reference tables once, caches them, and joins client-side, so names aren't repeated per row in the batch-fetched board). **Not** filtered by status — the SPA defaults to `status = 'operating'` (clean URL `/`) and opts into other statuses via `?status=` (e.g. `?status=all`). The SPA board reads this view.

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
- **Email confirmation**: enabled in the Supabase dashboard (Auth → Email); the SPA enforces a "confirm your email before ranking" gate client-side + RLS denies `user_rides` writes until `email_confirmed_at` is set.

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

- **Scheduled**: `pg_cron` every 15 minutes calls a `recompute_rankings_cron()` SQL function, which reads the Edge Function URL + shared secret from **Supabase Vault** (no environment values in migrations; one-time bootstrap in AGENTS.md) and POSTs via `pg_net`.
- **Manual**: admin "Recompute now" button on `/admin` calls the same function via `supabase.functions.invoke` — the user's JWT travels as the Bearer token and the function checks `profiles.is_admin` server-side. No secret ships to the browser.
- **Aggregation**: the function reads pairwise wins via two security-definer RPCs (`pairwise_wins()`, `ranked_participants()`); `EXECUTE` is revoked from anon/authenticated, so only the service_role (or the cron job, in-database) reaches them.
- **Output**: the function upserts rows in `coaster_ratings`; the view `v_coaster_rankings` is read-live by the SPA. Coasters that drop out of every pair get their rating rows deleted (back to "unrated"), and an all-unranked state clears the table.

### 5.5 Edge function contract

```
POST /functions/v1/recompute-rankings
Authorization: Bearer <RECOMPUTE_AUTH_SECRET | SERVICE_ROLE_KEY | admin user JWT>
→ 200 { updated: <int>, durationMs: <int>, iterations: <int>, converged: <bool> }
```

Admin JWTs are validated against GoTrue (`/auth/v1/user`) and then checked against `profiles.is_admin`. Reads aggregated pairwise wins from PostgREST RPCs, runs MM in memory (`packages/bt`), upserts scores. Stateless and idempotent.

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
│   ├── functions/recompute-rankings/ # Deno index.ts (imports packages/bt/src/mm.ts)
│   └── seed.sql
├── packages/bt/                      # pure TS Bradley-Terry MM (own package.json; shared edge fn + tests)
├── data/
│   └── coaster_db.csv                # Rob Mulla's CC0 seed dataset (committed; ~1,087 coasters)
├── scripts/                          # data-engineering package (own package.json: tsx, pg, csv-parse, dotenv)
│   ├── import-coasters.ts            # CC0 CSV → parks + coasters (direct Postgres, idempotent)
│   ├── package.json
│   └── tsconfig.json
├── tests/
├── .env.example
└── AGENTS.md                          # commands & conventions for AI agents & humans (runbooks live in docs/RUNBOOKS.md)
```

## 8. Environment & credentials

A single `.env` at the repo root (gitignored) holds everything. Vite reads it via `envDir: '..'` in `app/vite.config.ts` so the SPA picks up `VITE_*` vars during `npm run dev`. `.env.example` (committed) documents the keys with empty values.

| Variable | Vite-exposed? | Used by |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | no | Supabase CLI (migrations, function deploy); also a GitHub repo secret in CI |
| `PROJECT_REF` | no | `supabase link` + CI deploy job |
| `SUPABASE_URL` | no | scripts (CSV importer), Edge Function config |
| `SUPABASE_ANON_KEY` | no | scripts |
| `SUPABASE_SERVICE_ROLE_KEY` | no (never) | Edge Function + import script — bypasses RLS |
| `SUPABASE_DB_URL` | no | CSV import script (direct Postgres) |
| `VITE_SUPABASE_URL` | **yes** | SPA client |
| `VITE_SUPABASE_ANON_KEY` | **yes** | SPA client (public by design; protected by RLS) |
| `RECOMPUTE_AUTH_SECRET` | no | shared secret authorizing the pg_cron → Edge Function call |

**Exposure rule (critical):** only `VITE_`-prefixed variables reach the browser bundle. `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ACCESS_TOKEN` must NEVER carry a `VITE_` prefix.

GitHub repo secrets (for CI): `SUPABASE_ACCESS_TOKEN`, `PROJECT_REF`, `RECOMPUTE_AUTH_SECRET`, `BACKUP_PAT`, `COASTER_RANK_EVENTS_BOT_TOKEN`, `COASTER_RANK_ALERTS_BOT_TOKEN`, `TELEGRAM_USER_ID`.
Cloudflare site env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (injected at build time).

## 9. Deployment & CI/CD

### 9.1 Branch policy
`main` is protected. PRs are required to merge (no direct pushes). Required status check: `ci/check`. The Supabase deploy job runs only after merge to `main` (not on PRs). The SPA auto-deploys on push to `main` via Cloudflare Pages.

### 9.2 CI workflow (`.github/workflows/ci.yml`)
- **`check` job** (display name `ci/check`): runs on every PR and on `main`; working directory `app/`. Steps: `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test:run`, `npm run format:check`.

### 9.3 Supabase deploy workflow (`.github/workflows/deploy-supabase.yml`)
- Runs only on `main`, path-filtered on `supabase/**` **and `packages/bt/**`** (the Edge Function bundles `packages/bt/src/mm.ts`, so algorithm changes must redeploy it), gated on `secrets.SUPABASE_ACCESS_TOKEN`. Installs the Supabase CLI, then `supabase link --project-ref $PROJECT_REF`, `supabase db push`, then `supabase functions deploy recompute-rankings`.
- Migrations must always be additive and backwards-compatible with the current frontend.

### 9.4 SPA deploy workflow (Cloudflare Pages auto-deploy)
- **Trigger**: Cloudflare Pages auto-deploys on every push to `main` (no GitHub workflow). Free tier includes 500 builds/mo — no SHA-gate needed.
- **Build**: Cloudflare runs `npm run build` with root directory `app/`; output directory `app/dist` is declared in `app/wrangler.toml` (`assets.directory = "./dist"`) and served via `app/public/_redirects` (`/* /index.html 200`).
- **Env**: `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` set in Cloudflare dashboard (Pages → Settings → Environment variables).
- **Note**: For future Worker integration, extend `app/wrangler.toml` with `main = "..."` — no hosting migration needed.

### 9.5 Database backup workflow (`.github/workflows/backup-database.yml`)
- **Schedule**: runs nightly at 4 AM ET (cron `0 8 * * *` UTC), plus manual `workflow_dispatch`.
- **Action**: runs `pg_dump` against `SUPABASE_DB_URL`, gzips the output, and pushes to the private [`CoasterRankBackups`](https://github.com/pandeiro/CoasterRankBackups) repo.
- **Retention**: 7-day rotation. Old backups (`coasterrank-YYYY-MM-DD.sql.gz`) are automatically deleted before each commit.
- **Prerequisites**: `SUPABASE_DB_URL` (direct Postgres connection, already a repo secret) and `BACKUP_PAT` (PAT with `repo` scope, must be generated manually — see `docs/RUNBOOKS.md`).
- **Failure notifications**: workflow annotations surface the cause (missing secrets, empty dump).

### 9.6 SPA hosting — Cloudflare Pages
- Connect the GitHub repo; build command `npm run build`; base directory `app/`; publish directory `app/dist`.
- SPA fallback: `app/public/_redirects` → `/* /index.html 200` (supported natively by CF Pages).
- Site env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- A free `*.pages.dev` URL works end-to-end before any custom domain.

### 9.7 Custom domain (whenever you go public)
1. Register the domain (~$10–15/yr).
2. Cloudflare Pages → Custom domains → Add custom domain (apex + `www` DNS per Cloudflare's instructions). HTTPS is auto-provisioned.
3. Supabase → Auth → URL Configuration → set Site URL to `https://<your-domain>` and add `https://<your-domain>/**` plus `http://localhost:5173/**` to Redirect URLs.

### 9.8 Go-live checklist

Run once before sharing the site publicly; re-run the **auth-critical** steps whenever the
public URL changes (Pages URL → custom domain, §9.7). If these are missed, signup and
confirmation emails point at the wrong host and new accounts can never confirm on prod.

- [ ] **Cloudflare deploy green** — site connected per the `docs/RUNBOOKS.md` runbook; `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` set in Cloudflare dashboard.
- **Auth-critical:** Supabase → Auth → URL Configuration — Site URL = prod URL (`https://<site>.pages.dev` at first; custom domain later) and Redirect URLs include `https://<prod-url>/**` **plus** `http://localhost:5173/**` (keep localhost for dev).
- [ ] **Auth-critical:** Supabase → Auth → Email — "Confirm email" enabled (already set; double-check it hasn't been turned off, §4.6).
- [ ] **Admin bootstrapped** — SQL runbook in `docs/RUNBOOKS.md`; verify the admin badge shows on `/me/profile` on prod.
- [ ] **End-to-end smoke on prod** — sign up with a real inbox → confirmation link lands on the prod URL → log in → `/me` renders behind the confirmed gate.
- [ ] **Reference data present** — `cd scripts && npm run import-coasters -- --apply` has been run; the board lists coasters.

## 10. Phasing (milestones)

- **Phase 0 — Scaffold** ✅: git repo + branch protection (PRs required); Vite + React 19 + TS (strict); Tailwind; Vitest; **oxlint** + Prettier; `supabase init` (config only — no local Docker; develop against prod); `.env.example` + `AGENTS.md` with verified commands; SPA fallback `_redirects` (`/* /index.html 200`); GitHub Actions CI (`check` + gated `deploy`).
- **Phase 1 — Schema + RLS** ✅: every table above, `handle_new_user()` trigger, indexes, RLS policies (incl. `is_admin()`-gated reference-table writes and column-grant protection of `profiles.is_admin`), `v_coaster_rankings` view, the email-confirmed gate.
- **Phase 2 — Reference import** ✅: downloaded CC0 `coaster_db.csv` (committed at `data/`); wrote `scripts/import-coasters.ts` (direct Postgres via `SUPABASE_DB_URL`, idempotent `ON CONFLICT … WHERE source = 'open-csv'`, dry-run by default / `--apply` to write); seeded prod → **101 manufacturers, 279 parks, 1,087 coasters** (status: 668 operating / 213 unknown / 146 defunct / 34 sbno / 26 under-construction). Maps `Type_Main`→`material` and `Status`→`coaster_status` with a documented bucket map; deterministic intra-park slug disambiguation via `year_introduced`. **250 coasters** with source `Location = "Other"` land in a single synthetic `Other (unknown location)` park (no geo) — admin-re-homeable in Phase 7. Re-run is safe and reconciles the catalog to the CSV.
- **Phase 3 — Auth + profile** ✅: signup (username via `raw_user_meta_data` → `handle_new_user()`, with taken-username fallback to `NULL`), login with resend-confirmation affordance, session handling (`AuthProvider`), `RequireAuth`/`RequireAdmin` route guards, profile page (username/display name, unique-violation → "taken" message, admin badge), email-confirmation gate (`ConfirmEmailGate` + RLS `user_email_verified()`).
- **Phase 4 — Public board + detail pages** ✅: board batch-fetches the full `v_coaster_rankings` view once and filters/paginates **client-side** (unrated coasters sort last with a `—` score — no naive interim backfill); parks/manufacturers/countries are fetched in parallel, cached by TanStack Query, and joined client-side (view stays normalized); incremental rendering in 250-row slices (vanilla `IntersectionObserver` sentinel); search/park/country/manufacturer/material/status filters mirrored to URL search params; operating-only is the default with a clean `/` URL and `?status=` reveals defunct/sbno/etc.; coaster + park detail pages.
- **Phase 5 — "My Coasters"** ✅: search/autocomplete to add coasters from the catalog via a two-step flow (pick coaster → pick position: top / bottom / any index via inline insert dividers); single atomic upsert inserts the new row + shifts ranks; `@dnd-kit` drag-sort with auto-save on drop; gapless 1-indexed renumbering on every change (including after remove); optimistic updates with error toasts and state reversion; local order resyncs from server data; per-user view with ranked count summary; legacy unranked rows can be ranked via an inline action.
- **Phase 6 — BT batch** ✅: `packages/bt` MM (Hunter 2004) with anchor + pseudo-count (L2-equivalent) regularization, 12 Vitest tests; Edge Function `recompute-rankings` accepting three Bearer auths (cron shared secret / service-role key / admin JWT checked server-side via `is_admin`); `pairwise_wins()` + `ranked_participants()` security-definer RPCs (execute revoked from anon/authenticated) with per-user normalization (PLAN §5.1); pg_cron every 15 min via a Vault-backed `recompute_rankings_cron()` (URL + secret in Supabase Vault, no env values in migrations; one-time bootstrap runbook in `docs/RUNBOOKS.md`); `/admin` page with "Recompute now" (JWT via `functions.invoke`) + admin-gated route/nav; stale-rating cleanup (coasters leaving all pairs drop back to unrated). Backfill happens on the first scheduled run once real preferences exist.
- **Phase 7 — Admin & moderation** ✅: `/submit` page (confirmed users propose a coaster with park autocomplete + optional suggested stats → `coaster_submissions`); `/admin` tabs — **Submissions** queue (approve → creates the park row if new + the coaster from `suggested_fields`; reject with reviewer note), **Coasters** management (search across all coasters, add/edit form for stats/status/material), **Re-home** (move coasters out of the synthetic `Other (unknown location)` park into their real park). Admin role/RLS (`is_admin()` policies) already shipped in Phase 1; the recompute button shipped in Phase 6.
- **Phase 8 — Hardening** ✅: pending-submission cap enforced in RLS (`submission_within_cap()`, migration `submission_cap`) + client pre-check; `/submit` gains the email-confirmed gate, a "your submissions" status list, and typed `suggested_fields`; `/admin` gains error states on every query, success/error toasts on every mutation, incremental coaster-table rendering, a park picker (replacing the raw park-ID field), and no `any` casts; `approveSubmission` maps slug-collision `23505`s to friendly messages via a shared `slugify`; 404 catch-all route; RUNBOOKS documents the anti-abuse posture (Supabase Auth rate limits + the cap); tests for the submit/admin/404 surfaces and the collision paths.

## 11. Future considerations (explicitly out of v1 scope)

- OAuth providers (Google, GitHub, etc.).
- Public user profiles + shareable ranked lists.
- "Coaster wiki" evolution (rich detail pages, history, photos) — would likely motivate migrating from SPA to SSR (Next.js/SvelteKit) for SEO.
- Incremental / streaming recompute (Elo or TrueSkill) if batch latency becomes a UX issue.
- Forking to a "parks ranking" and "manufacturer ranking" from the same pairwise data.
- ADR-style decision records in `docs/decisions/` if decision churn warrants it (for now this PLAN.md is the single source).

## 12. Open knobs (to revisit later)

- **Pseudo-comparison baseline weight**: the synthetic "average" anchor's contribution — tuned empirically once we have real pairwise data.
- **L2 regularization strength**: a config constant; tune to avoid ±∞ blow-ups on sparse coasters.
- **Per-user-weighting variant**: pure `1/n` (current), vs. `1/sqrt(n)`, vs. a tunable knob — revisit after seeing effect on a real dataset.
- **"Operating only" filter on the live board**: resolved in Phase 4 — the board defaults to `status = 'operating'` (clean `/` URL); `?status=all` or `?status=<specific>` reveals other statuses. No toggle persists in the UI beyond the status filter.