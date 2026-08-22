# AGENTS.md

Operating guide for AI agents and humans working on CoasterRank. Read this before running commands.

## Project layout

```
app/                 # Vite + React + TypeScript SPA (all app code lives here)
supabase/            # Supabase CLI config + migrations + edge functions
  config.toml        # CLI config (committed)
  migrations/        # SQL migrations (created via `supabase migration new`)
  functions/         # Deno Edge Functions
docs/PLAN.md         # authoritative project plan & decision log
docs/RUNBOOKS.md     # one-time / rare ops runbooks (admin bootstrap, recompute, Netlify, ...)
packages/bt/         # pure TS Bradley-Terry MM (own package.json; shared by Edge Function + tests)
  src/mm.ts          # MM fitting (Hunter 2004) with anchor + L2 regularization
supabase/functions/recompute-rankings/  # Deno Edge Function: pairwise RPCs -> MM -> upsert coaster_ratings
data/                # (Phase 2) reference datasets (CC0 coaster_db.csv committed here)
scripts/             # (Phase 2) data-engineering package — own package.json (tsx, pg, csv-parse, dotenv)
  import-coasters.ts # CC0 CSV → parks + coasters, idempotent, direct Postgres via SUPABASE_DB_URL
```

## Commands

All app commands run from `app/`:

```bash
cd app
npm run dev          # Vite dev server on http://localhost:5173
npm run build        # typecheck + production build to app/dist
npm run typecheck    # tsc -b (project-references typecheck)
npm run lint         # oxlint
npm run test         # vitest (watch)
npm run test:run     # vitest run (CI mode, single pass)
npm run format       # prettier --write .
npm run format:check # prettier --check .
```

Supabase CLI commands run from the repo root:

```bash
supabase migration new <name>   # create supabase/migrations/<timestamp>_<name>.sql
supabase link --project-ref <ref>  # bind this dir to the remote project (one-time)
supabase db push                # CI runs this on merge to main — do NOT run manually
supabase functions deploy <fn>  # CI runs this on merge to main — do NOT run manually
supabase functions serve <fn>   # (not used — we develop against prod)
```

Scripts (data-engineering) commands run from `scripts/` — it has its **own** `package.json` (separate from `app/`):

```bash
cd scripts
npm install                       # one-time, after cloning / after deps change
npm run import-coasters           # dry-run: parse + report counts, no DB connection
npm run import-coasters -- --apply  # write/refresh prod via SUPABASE_DB_URL (idempotent)
npm run import-coasters -- data/coaster_db.csv      # optional: explicit CSV path (positional)
npm run typecheck                 # tsc --noEmit for the scripts package
```

The Bradley-Terry package (`packages/bt`) also has its **own** `package.json` (same standalone-package pattern as `scripts/` — no root workspace):

```bash
cd packages/bt
npm install                       # one-time, after cloning / after deps change
npm run typecheck                 # tsc --noEmit
npm test                          # vitest run (single pass)
```

The importer is idempotent: re-runs upsert by `(park_id, slug)` and only refresh rows whose
`source = 'open-csv'`, so admin-created/community rows are never clobbered. It maps `Status`→
`coaster_status` and `Type_Main`→`coaster_material`; 250 coasters with source `Location = "Other"`
land in a synthetic `Other (unknown location)` park. Run from repo root also works as
`cd scripts && npm run import-coasters` (the CSV defaults to `../data/coaster_db.csv`).

## Required quality gates (run before every commit)

```bash
cd app && npm run typecheck && npm run lint && npm run test:run && npm run format:check
```

All must pass. CI runs the same set on every PR. If you changed `scripts/`, also run
`cd scripts && npm run typecheck` (the scripts package has its own `tsc` setup; not yet in CI).
If you changed `packages/bt/` or the Edge Function, also run
`cd packages/bt && npm run typecheck && npm test` (Edge Function imports `packages/bt/src/mm.ts`
via relative path; Deno type-checks it at deploy time).

## Environment

One `.env` file at the repo root holds everything (gitignored). Vite reads it via
`envDir: '..'` in `app/vite.config.ts`. See `.env.example` for the full list and exposure rules.

**Critical rule:** only `VITE_`-prefixed variables reach the browser bundle. `SUPABASE_SERVICE_ROLE_KEY`
and `SUPABASE_ACCESS_TOKEN` must NEVER have a `VITE_` prefix.

## Multi-account Supabase CLI auth

The CoasterRank Supabase account is one of several on this machine. Do NOT run `supabase login`
(global state). Instead:

1. Generate a personal access token in the CoasterRank Supabase dashboard (Account → Access Tokens).
2. Put it in `.env` as `SUPABASE_ACCESS_TOKEN=...`. The CLI reads it automatically per-invocation
   and it overrides any global login state.
3. One-time: `supabase link --project-ref <PROJECT_REF>` (uses the token) binds this directory.

No login/logout dance; no cross-account contamination. The same `SUPABASE_ACCESS_TOKEN` pattern is
used in CI (as a GitHub repo secret).

## Deployment (summary; full detail in docs/PLAN.md §11)

- **SPA**: Netlify, auto-deploys on push to `main`. Build `npm run build` in `app/`; publish `app/dist`.
  SPA fallback via `app/public/_redirects` (`/* /index.html 200`). Custom domain + HTTPS added later.
- **Schema + functions**: GitHub Actions on merge to `main` runs `supabase db push` then
  `supabase functions deploy recompute-rankings` (path-filtered on `supabase/**` **and
  `packages/bt/**`** — the Edge Function bundles `packages/bt/src/mm.ts` at deploy time, so
  algorithm changes must redeploy it).
  **Never run `supabase db push` or `supabase functions deploy` manually for routine changes.**
  Migrations and edge-function changes go through a PR → merge → CI deploy. The deploy job
  authenticates with the `SUPABASE_ACCESS_TOKEN` and `PROJECT_REF` repo secrets (no direct DB
  connection string in CI); it is a silent no-op if those secrets are missing.
- **Branch policy**: PRs required to merge into `main`. CI runs the quality gates on every PR; the
  deploy job only runs after merge.

## Runbooks

One-time / rare operational tasks (admin bootstrap, Supabase project creation, recompute bootstrap
+ manual trigger, Netlify connect, custom domain, test-user cleanup) live in
**[`docs/RUNBOOKS.md`](docs/RUNBOOKS.md)** — read it on demand when the task arises.

## Conventions

- TypeScript strict mode is on. No `any` without justification.
- Linter is **oxlint** (not ESLint) per the Vite template; formatter is Prettier.
- Run `npm run format` before committing; CI enforces `format:check`.
- No secrets in code. Secrets live in `.env` (local) or GitHub/Netlify secrets (CI/hosting).
- Update `docs/PLAN.md` when a decision changes — it is the source of truth.
- **Supabase JS client defaults to 1000 rows per query.** Always paginate with `.range()` when fetching rows — the row count may be unknown at query time.

## PR workflow

- **Always write PR descriptions and comments to a temp file first** (`/tmp/pr-comment.md`), then
  use `gh pr comment <PR> --body-file /tmp/pr-comment.md` or `gh pr create --body-file /tmp/pr-comment.md`.
  Backticks in shell arguments get mangled by zsh — writing to a file avoids this entirely.

## Data Engineering Guardrails

- **Always do exploratory data analysis before building pipelines.** Verify assumptions about data completeness, field populations, and distributions *before* writing candidate generation logic.
  - Example: The park dedup pipeline assumed `country` was populated (it was 100% NULL), causing 0 candidates.
  - Run quick `psql` queries to profile key columns (`select count(*), count(country) from parks;`) before implementing blocking/filtering logic.
  - Test similarity thresholds against real data samples to calibrate precision/recall.
- **Prefer relaxed constraints initially** (e.g., global self-join on small datasets) and add blocking filters only after confirming they don't eliminate valid matches.
- **Dry-run mode must report real metrics** (exact candidate counts), not estimates or proxy metrics.
- **Never run commands that mutate data (DB writes, migrations, `--apply` flags) without explicit user permission.** Dry-run is the default; `--apply` requires a clear go-ahead.
- **Strictly adhere to the PR-only migration flow.** Never apply migrations or schema changes directly to the database via `psql` or similar tools, even when fixing a bug, without explicit user instruction to override the standard pipeline.