# Runbooks

Operational runbooks for one-time and rare CoasterRank tasks. For the everyday command reference
see `AGENTS.md`; for architecture and decisions see `docs/PLAN.md`.

## Create the Supabase project (just-in-time, before Phase 1)

1. Create a new project in the CoasterRank Supabase account (dashboard).
2. Copy the project ref, API URL, anon key, service-role key, and Database connection string.
3. Fill in the corresponding values in your local `.env`.
4. Set GitHub repo secrets: `SUPABASE_ACCESS_TOKEN`, `PROJECT_REF`, `RECOMPUTE_AUTH_SECRET`.
5. Run `supabase link --project-ref <ref>` from the repo root to bind this directory.

## Connect Cloudflare (just-in-time, before Phase 4)

1. Create a Cloudflare account and create a new Workers project by importing the CoasterRank GitHub repo.
2. Build command: `npm run build`. Root directory: `app/`. (The `app/wrangler.toml` handles the output directory `dist`).
3. Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Cloudflare Workers settings.
4. Add the Cloudflare URL (`https://<site>.workers.dev`) plus `http://localhost:5173` to Supabase Auth
   → Redirect URLs.

Once connected, run the **go-live checklist** (`docs/PLAN.md` §9.5) before sharing the URL.

## Point a custom domain at Cloudflare (whenever you go public)

Prerequisite: you own the domain (any registrar). **Cloudflare handles the TLS certificate for you** —
it automatically provisions, issues, and renews a free Let's Encrypt cert once DNS points at
Cloudflare, for both DNS options below. No cert tooling on your side.

### Option A — Cloudflare DNS (recommended; less to configure)

1. Cloudflare: Site → Custom domains → Add custom domain → enter the apex domain; accept the
   `www.<your-domain>` alias when offered.
2. Cloudflare shows nameservers. Set them as the domain's nameservers
   at your registrar.
3. **Disable DNSSEC at the registrar first** if it's enabled — Cloudflare DNS handles its own
   security; verify registrar settings. (If you require external DNSSEC, use Option B.)

### Option B — External DNS (keep your registrar's DNS)

1. At your registrar / DNS provider:
   - Apex: `CNAME` or `A` record per Cloudflare's provided setup (usually a CNAME to `your-site.workers.dev`).
   - `www`: `CNAME` → `<site>.workers.dev`.
2. Cloudflare: Site → Custom domains → Add custom domain → enter the apex; add the `www` alias.

Don't mix the two options: either the registrar's nameservers point at Cloudflare (A) **or** you
keep external DNS and add the records yourself (B).

### After DNS (both options)

1. Wait for propagation — usually minutes, up to 24–48 h. Cloudflare retries cert provisioning.
2. Once the certificate shows active, enable **Force HTTPS**.
3. In Supabase: Auth → URL Configuration → set Site URL to `https://<your-domain>` and add
   `https://<your-domain>/**` (plus `http://localhost:5173/**`) to Redirect URLs.
4. Verify: `https://<your-domain>` loads the board over HTTPS, and a fresh signup's confirmation
   email links back to the custom domain.
5. Re-run the **auth-critical** steps of the go-live checklist (`docs/PLAN.md` §9.5).

## Bootstrap the first admin account

After creating your user via the SPA signup (and confirming email), run once in the Supabase SQL
editor, replacing the email with yours:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

## Test & mock data: the `testride` CLI

`scripts/src/testride/` manages synthetic users and their data. Synthetic users carry **two
markers** (either suffices):

1. email on the `@test.coasterrank.dev` domain — **adopt this convention when signing up manual
   test users through the UI**;
2. `raw_user_meta_data.synthetic = true` (set automatically by `testride:seed`).

Seeded users are **login-ready with no email verification** (inserted with `email_confirmed_at`
set) and share the password `testride-password`.

All commands target prod (`.env`) by default; any other project (e.g. a throwaway) via
`--db-url / --supabase-url / --service-key`. Destructive/data commands are preview-only until
`--apply` / `--yes`.

```bash
cd scripts
npm run testride:seed -- --profile ux --apply                  # 3 test users + rides (+ --with-submissions for admin-queue testing)
npm run testride:seed -- --profile benchmark --users 500 --apply  # BT benchmark dataset (~17k ranked rides; skewed casual/mid/power)
npm run testride:report                                        # synthetic users + recent users + what each owns
npm run testride:cleanup -- --synthetic                        # preview; add --yes to delete
npm run testride:cleanup -- --emails someone@test.coasterrank.dev --yes
npm run testride:confirm -- --email someone@test.coasterrank.dev --apply  # email-verification workaround
npm run testride:recompute                                     # refresh derived ratings after seed/cleanup
```

Cleanup deletes `auth.users` rows; `profiles`, `user_rides`, and their submissions cascade. Avatar
storage files are removed first via the service-role API (they do NOT cascade); `coaster_ratings`
are derived and restored by `testride:recompute`. `cleanup --synthetic` matches only the exact
markers above — never a fuzzy pattern. Benchmark-scale seeding of prod is refused without
`--i-know-this-is-prod`.

**Assume identity (impersonation):** the admin page's *Assume identity* tab lists synthetic users
and logs you in as one (one-time magiclink via the `assume-identity` Edge Function — no password
needed, works even for manual test signups whose password you don't know). The admin session is
backed up before switching; **"Return to admin"** in the bottom banner restores it. Server-side,
the function only ever impersonates marker-matched synthetic users — real users are unreachable
by design.

Fallback (no tooling available): `delete from auth.users where email = '…';` in the SQL editor
cascades profiles/rides/submissions, then recompute.

## Bootstrap the rankings recompute (one-time, after the Phase 6 deploy)

The 15-minute pg_cron → Edge Function pipeline reads its URL + shared secret from Supabase Vault
(no environment values live in migrations), and the Edge Function reads the same secret from its
own env. After the Phase 6 migration + function deploy land on prod:

1. Generate a strong secret and put it in `.env` as `RECOMPUTE_AUTH_SECRET=...` (and in the
   GitHub repo secret of the same name, if you want CI parity).
2. Set it as an Edge Function secret (from the repo root; CLI uses `SUPABASE_ACCESS_TOKEN`):

   ```bash
   source .env && supabase secrets set RECOMPUTE_AUTH_SECRET="$RECOMPUTE_AUTH_SECRET"
   ```

3. Store the two Vault secrets in the Supabase SQL editor. **Copy the function URL from the
   dashboard** (Edge Functions → recompute-rankings) — newer projects use a region-qualified
   host (`https://<PROJECT_REF>.<REGION>.supabase.co/functions/v1/recompute-rankings`), not the
   legacy `https://<PROJECT_REF>.supabase.co/...` form:

   ```sql
   select vault.create_secret(
     'https://<PROJECT_REF>.<REGION>.supabase.co/functions/v1/recompute-rankings',
     'recompute_function_url'
   );
   select vault.create_secret('<RECOMPUTE_AUTH_SECRET>', 'recompute_auth_secret');
   ```

4. Verify: call `select public.recompute_rankings_cron();` in the SQL editor, then check
   `coaster_ratings` rows / the board. Until step 3 runs, the cron job warns + skips (harmless).

## Trigger a rankings recompute manually

Admins can click "Recompute now" on `/admin` (JWT-authenticated; the function checks `is_admin`
server-side). For ops debugging with the service-role key:

```bash
source .env && curl -s -X POST \
  "$SUPABASE_URL/functions/v1/recompute-rankings" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```

## Anti-abuse & rate limits (what's already in place)

Most abuse protection is delegated to Supabase's built-in, server-side limits rather than custom
code; this section records what that is and where the app adds its own guards.

- **Signup / login / email sends**: Supabase Auth applies per-IP rate limits on signups, sign-ins,
  and confirmation-email sends by default (tunable in the dashboard under Auth → Rate Limits). No
  client code is needed for these; tune the dashboard thresholds if the defaults prove too loose or
  too tight.
- **Ranking writes (`user_rides`)**: gated behind a confirmed email (RLS `user_email_verified()`),
  which is the main barrier to throwaway-account spam.
- **Coaster submissions**: capped at `SUBMISSION_PENDING_CAP` (5) *pending* submissions per user,
  enforced in the RLS insert policy (`submission_within_cap()`, migration `submission_cap`) and
  pre-checked in the SPA for a friendlier message. Reviewed submissions stop counting, so a
  responsive moderation queue unblocks users.
- **Reference-table writes** (`parks`/`coasters`/`manufacturers`): admin-only via RLS `is_admin()`,
  so they are not a public abuse surface.

If spam appears despite the above, the first knobs to reach for are the Supabase Auth rate-limit
settings and tightening `SUBMISSION_PENDING_CAP`; only add custom server-side throttling if those
prove insufficient.

## Nightly database backups

The `backup-database` GitHub Actions workflow runs nightly at 4 AM ET (cron `0 8 * * * UTC`).
It dumps the Supabase Postgres database via `pg_dump`, gzips it, and pushes the file to the
private [`CoasterRankBackups`](https://github.com/pandeiro/CoasterRankBackups) repo.

### Retention policy

Backups are named `coasterrank-YYYY-MM-DD.sql.gz` and retained for **7 days**. The cleanup step
runs automatically after each new backup is pushed.

### Prerequisites

Five GitHub repo secrets must be set in **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Session pooler Postgres URL `postgresql://postgres.<PROJECT_REF>:<PW>@aws-0-us-west-2.pooler.supabase.com:5432/postgres` (Dashboard → Database → Connect → Session pooler; direct `db.<ref>.supabase.co` is IPv6-only and fails on GH runners — also used by `deploy-supabase.yml` for `generate-schema-doc.sh`) |
| `BACKUP_PAT` | A personal access token (classic) with `repo` scope, used to push to the backup repo |
| `BACKUP_REPO` | Target repo in `owner/repo` format |
| `COASTER_RANK_EVENTS_BOT_TOKEN` | Telegram bot token for success event notifications |
| `COASTER_RANK_ALERTS_BOT_TOKEN` | Telegram bot token for failure alert notifications |

To generate `BACKUP_PAT`:

1. Go to <https://github.com/settings/tokens>.
2. Click **Generate new token (classic)**.
3. Name: `CoasterRank backup push`. Expiration: 90 days (rotate before expiry).
4. Scope: check **repo** (full control of private repositories).
5. Generate, copy the token, and paste it into the `BACKUP_PAT` repo secret.

### Manual trigger

From the Actions tab, select **backup-database** → **Run workflow**. The backup will appear in
`CoasterRankBackups` within minutes.

### Verifying a backup

```bash
gh repo clone pandeiro/CoasterRankBackups /tmp/backup-repo
ls -lh /tmp/backup-repo/coasterrank-*.sql.gz
```

To restore a backup locally:

```bash
gunzip -c coasterrank-YYYY-MM-DD.sql.gz | psql "postgresql://localhost:5432/your_local_db"
```

## Restore drill (scratch Supabase project)

Validates that nightly backups are actually restorable, and rehearses the DR path (a real disaster
may require creating a fresh project and restoring into it). Performed against a **throwaway**
project, deleted afterwards — no standing staging environment. Also completes the §1.1
verification item of the go-live plan.

1. **Fresh backup**: GitHub Actions → `backup-database` → **Run workflow** (don't wait for the
   nightly).
2. **Throwaway project**: create in the dashboard (free tier; same Postgres major version as
   `supabase/config.toml`). Copy its DB URL (Session pooler), project URL, and service-role key.
3. **Restore**:
   ```bash
   gh repo clone pandeiro/CoasterRankBackups /tmp/backup-repo   # or fetch the single file
   gunzip -c /tmp/backup-repo/coasterrank-YYYY-MM-DD.sql.gz | \
     psql "<THROWAWAY_SESSION_POOLER_URL>"
   ```
   **Status: pending first run.** Record the exact working invocation + expected benign errors
   (role/extension grant noise is normal on a full-dump restore into a fresh Supabase project)
   here after the first drill, so the final command becomes the forever DR path.
4. **Verify**: row counts (`auth.users`, `profiles`, `parks`, `coasters`, `user_rides`,
   `coaster_ratings`); log in on the SPA with real prod creds (password hashes restore); board
   renders; `select jobname from cron.job;` shows `recompute-rankings`.
5. **Machinery** (needed for full function, optional for pure restore validation):
   ```bash
   source .env
   supabase db push --db-url "$THROWAWAY_DB_URL"       # migrations (idempotent)
   supabase functions deploy recompute-rankings --project-ref "$THROWAWAY_REF"
   supabase functions deploy assume-identity --project-ref "$THROWAWAY_REF"
   supabase secrets set APP_ENV=staging RECOMPUTE_AUTH_SECRET="<new secret>" --project-ref "$THROWAWAY_REF"
   # No Telegram tokens on non-prod: alert/event sends no-op silently.
   ```
   Then Vault bootstrap (see the recompute runbook above) with the throwaway's function URL and
   secret — after deleting any restored-but-undecryptable vault rows:
   `delete from vault.secrets where name in ('recompute_function_url','recompute_auth_secret');`
6. **Teardown**: delete the throwaway project in the dashboard. Cleanup by construction.

## Clone inventory (spec seed for a future `supabase clone`)

The eventual `supabase clone` tool provisions a full copy of the current system into a new
project (DR or testing). Each item below must be handled per-clone; this list is the tool's
checklist. Items marked ✅ are covered automatically by the dump restore; the rest are manual
steps today (see the restore drill).

| # | Item | Covered by dump? | Per-clone action |
| --- | --- | --- | --- |
| 1 | Schema (tables, RLS, functions, triggers, views) | ✅ | — (or `db push` for migration parity) |
| 2 | Data (incl. `auth.users` password hashes) | ✅ | — |
| 3 | Migration history (`supabase_migrations`) | ✅ | — |
| 4 | Storage bucket rows | ✅ | — |
| 5 | **Storage object files** (avatars, OG cards) | ❌ | re-upload or accept 404s |
| 6 | **Vault secrets** | ❌ (encrypted per-project) | delete restored rows; create with new function URL + new `RECOMPUTE_AUTH_SECRET` |
| 7 | **Edge Functions** (recompute-rankings, assume-identity) | ❌ | `functions deploy --project-ref` |
| 8 | **Function secrets** (`APP_ENV`, `RECOMPUTE_AUTH_SECRET`) | ❌ | `secrets set` (new secret; no Telegram tokens on non-prod) |
| 9 | **pg_cron schedule** | verify | re-push the pg_cron migration if missing (idempotent) |
| 10 | **Auth URL config** (Site URL, redirect URLs) + SMTP | ❌ | dashboard per project |
| 11 | Downstream consumers | ❌ | GitHub secrets (`SUPABASE_DB_URL`, `PROJECT_REF`), Cloudflare `VITE_*`, local `.env` |
| 12 | Free-tier pause guard target (if §1.5 lands) | ❌ | repoint |

Frontend decoupling already exists: swapping `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`
retargets the SPA instantly (locally via `.env` overrides; hosted via Cloudflare env vars).
