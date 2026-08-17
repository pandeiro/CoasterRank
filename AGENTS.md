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
  `supabase functions deploy recompute-rankings` (path-filtered on `supabase/**`).
  **Never run `supabase db push` or `supabase functions deploy` manually for routine changes.**
  Migrations and edge-function changes go through a PR → merge → CI deploy. The deploy job
  authenticates with the `SUPABASE_ACCESS_TOKEN` and `PROJECT_REF` repo secrets (no direct DB
  connection string in CI); it is a silent no-op if those secrets are missing.
- **Branch policy**: PRs required to merge into `main`. CI runs the quality gates on every PR; the
  deploy job only runs after merge.

## Runbooks

### Bootstrap the first admin account

After creating your user via the SPA signup (and confirming email), run once in the Supabase SQL
editor, replacing the email with yours:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

### Create the Supabase project (just-in-time, before Phase 1)

1. Create a new project in the CoasterRank Supabase account (dashboard).
2. Copy the project ref, API URL, anon key, service-role key, and Database connection string.
3. Fill in the corresponding values in your local `.env`.
4. Set GitHub repo secrets: `SUPABASE_ACCESS_TOKEN`, `PROJECT_REF`, `RECOMPUTE_AUTH_SECRET`.
5. Run `supabase link --project-ref <ref>` from the repo root to bind this directory.

### Cleanup a test user created in prod

Because we develop against prod Supabase, test users created during local dev land in the prod auth
table. To remove one:

```sql
-- in the Supabase SQL editor
delete from auth.users where email = 'test@example.com';
-- user_rides/profiles rows cascade or are cleaned by the handle_new_user trigger relationship
```

### Bootstrap the rankings recompute (one-time, after the Phase 6 deploy)

The 15-minute pg_cron → Edge Function pipeline reads its URL + shared secret from Supabase Vault
(no environment values live in migrations), and the Edge Function reads the same secret from its
own env. After the Phase 6 migration + function deploy land on prod:

1. Generate a strong secret and put it in `.env` as `RECOMPUTE_AUTH_SECRET=...` (and in the
   GitHub repo secret of the same name, if you want CI parity).
2. Set it as an Edge Function secret (from the repo root; CLI uses `SUPABASE_ACCESS_TOKEN`):

   ```bash
   source .env && supabase secrets set RECOMPUTE_AUTH_SECRET="$RECOMPUTE_AUTH_SECRET"
   ```

3. Store the two Vault secrets in the Supabase SQL editor:

   ```sql
   select vault.create_secret(
     'https://<PROJECT_REF>.supabase.co/functions/v1/recompute-rankings',
     'recompute_function_url'
   );
   select vault.create_secret('<RECOMPUTE_AUTH_SECRET>', 'recompute_auth_secret');
   ```

4. Verify: call `select public.recompute_rankings_cron();` in the SQL editor, then check
   `coaster_ratings` rows / the board. Until step 3 runs, the cron job warns + skips (harmless).

### Trigger a rankings recompute manually

Admins can click "Recompute now" on `/admin` (JWT-authenticated; the function checks `is_admin`
server-side). For ops debugging with the service-role key:

```bash
source .env && curl -s -X POST \
  "$SUPABASE_URL/functions/v1/recompute-rankings" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

### Connect Netlify (just-in-time, before Phase 4)

1. Create a Netlify account and "Add new site" → import the CoasterRank GitHub repo.
2. Build command: `npm run build`. Base directory: `app/`. Publish directory: `app/dist`.
3. Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify site settings.
4. Add the Netlify URL (`https://<site>.netlify.app`) plus `http://localhost:5173` to Supabase Auth
   → Redirect URLs.

Once connected, run the **go-live checklist** (`docs/PLAN.md` §9.5) before sharing the URL.

### Point a custom domain at Netlify (whenever you go public)

1. Buy the domain (~$10-15/yr) from any registrar.
2. In Netlify: Site → Domain settings → Add custom domain; follow DNS instructions
   (apex + www CNAME/A records). HTTPS (Let's Encrypt) is provisioned automatically.
3. In Supabase: Auth → URL Configuration → set Site URL to `https://<your-domain>` and add
   `https://<your-domain>/**` (plus `http://localhost:5173/**`) to Redirect URLs.
4. Re-run the **auth-critical** steps of the go-live checklist (`docs/PLAN.md` §9.5).

## Conventions

- TypeScript strict mode is on. No `any` without justification.
- Linter is **oxlint** (not ESLint) per the Vite template; formatter is Prettier.
- Run `npm run format` before committing; CI enforces `format:check`.
- No secrets in code. Secrets live in `.env` (local) or GitHub/Netlify secrets (CI/hosting).
- Update `docs/PLAN.md` when a decision changes — it is the source of truth.