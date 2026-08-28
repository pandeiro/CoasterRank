# Runbooks

Operational runbooks for one-time and rare CoasterRank tasks. For the everyday command reference
see `AGENTS.md`; for architecture and decisions see `docs/PLAN.md`.

## Create the Supabase project (just-in-time, before Phase 1)

1. Create a new project in the CoasterRank Supabase account (dashboard).
2. Copy the project ref, API URL, anon key, service-role key, and Database connection string.
3. Fill in the corresponding values in your local `.env`.
4. Set GitHub repo secrets: `SUPABASE_ACCESS_TOKEN`, `PROJECT_REF`, `RECOMPUTE_AUTH_SECRET`.
5. Run `supabase link --project-ref <ref>` from the repo root to bind this directory.

## Connect Netlify (just-in-time, before Phase 4)

1. Create a Netlify account and "Add new site" → import the CoasterRank GitHub repo.
2. Build command: `npm run build`. Base directory: `app/`. Publish directory: `app/dist`.
3. Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify site settings.
4. Add the Netlify URL (`https://<site>.netlify.app`) plus `http://localhost:5173` to Supabase Auth
   → Redirect URLs.

Once connected, run the **go-live checklist** (`docs/PLAN.md` §9.5) before sharing the URL.

## Point a custom domain at Netlify (whenever you go public)

Prerequisite: you own the domain (any registrar). **Netlify handles the TLS certificate for you** —
it automatically provisions, issues, and renews a free Let's Encrypt cert once DNS points at
Netlify, for both DNS options below. No cert tooling on your side.

### Option A — Netlify DNS (recommended; less to configure)

1. Netlify: Site → Domain settings → Add custom domain → enter the apex domain; accept the
   `www.<your-domain>` alias when offered.
2. Netlify shows 4 nameservers (`dns1.p0x.nsone.net`-style). Set them as the domain's nameservers
   at your registrar.
3. **Disable DNSSEC at the registrar first** if it's enabled — Netlify DNS does not support
   DNSSEC, and resolution breaks if it stays on. (If you require DNSSEC, use Option B.)

### Option B — External DNS (keep your registrar's DNS)

1. At your registrar / DNS provider:
   - Apex: `A` record → `75.2.60.5` (Netlify's load balancer). An `ALIAS`/`ANAME` record works
     too if the provider supports it.
   - `www`: `CNAME` → `<site>.netlify.app`.
2. Netlify: Site → Domain settings → Add custom domain → enter the apex; add the `www` alias.

Don't mix the two options: either the registrar's nameservers point at Netlify (A) **or** you
keep external DNS and add the records yourself (B).

### After DNS (both options)

1. Wait for propagation — usually minutes, up to 24–48 h. Netlify retries cert provisioning every
   ~10 min for the first 24 h, then hourly. Status: Domain settings → HTTPS.
2. Once the certificate shows active, enable **Force HTTPS** (Domain settings → HTTPS).
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

## Cleanup a test user created in prod

Because we develop against prod Supabase, test users created during local dev land in the prod auth
table. To remove one:

```sql
-- in the Supabase SQL editor
delete from auth.users where email = 'test@example.com';
-- user_rides/profiles rows cascade or are cleaned by the handle_new_user trigger relationship
```

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

Four GitHub repo secrets must be set in **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `SUPABASE_DB_URL` | Direct Postgres connection string (already used by `deploy-supabase.yml`) |
| `BACKUP_PAT` | A personal access token (classic) with `repo` scope, used to push to `CoasterRankBackups` |
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
