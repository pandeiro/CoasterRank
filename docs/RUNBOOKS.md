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

The `testride` CLI (`scripts/src/testride/`) creates, inspects, impersonates, and removes
synthetic test users. **Full guide + scenarios: [`docs/TEST_DATA.md`](TEST_DATA.md).** Quick
reference:

- **Markers** (either suffices): email on the `@test.coasterrank.dev` domain — adopt this when
  signing up manual test users through the UI — and `raw_user_meta_data.synthetic = true` (set by
  `testride:seed`). Seeded users are login-ready with no email verification (shared password
  `testride-password`).
- **Commands**: `testride:seed` (dry-run unless `--apply`), `testride:report`, `testride:cleanup`
  (preview unless `--yes`), `testride:confirm`, `testride:recompute`. All target prod (`.env`) by
  default; other projects via `--db-url / --supabase-url / --service-key`.
- **Cleanup inverse map**: `profiles`/`user_rides`/their submissions FK-cascade from `auth.users`;
  avatar storage files are removed first via the service-role API (no cascade); derived
  `coaster_ratings` are restored by the next recompute. Un-undoable residue: Telegram pings and
  `cron_execution_logs` rows. Don't approve mock submissions (created coasters survive cleanup).
- **Assume identity (impersonation):** the admin page's *Assume identity* tab lists synthetic
  users and logs you in as one (one-time magiclink via the `assume-identity` Edge Function — no
  password needed, works even for manual test signups whose password you don't know). The admin
  session is backed up before switching; **"Return to admin"** in the bottom banner restores it.
  Server-side, the function only ever impersonates marker-matched synthetic users — real users
  are unreachable by design.
- **Pre-launch gate**: `testride:report` must show 0 synthetic users before public launch (the
  shared test password must not survive to launch).

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

## Debug the `/api/ranking` edge cache

The board payload is served by the Worker from the Cloudflare Cache API (15-min edge TTL,
mirroring the recompute cadence; ≤30-min display staleness is **by design** — see PLAN §10,
Phase 4.2, for why and for the only acceptable fix, purge-on-recompute). When it looks off:

```bash
# Is the cache working? First request after a TTL window: MISS, then HIT.
curl -s -D - -o /dev/null https://coasterrank.app/api/ranking | grep -iE "x-ranking-cache|cache-control"
```

- **Logs**: cache fills log one line each (`[ranking] cache fill: N rankings / M parks in Xms`),
  visible in the dashboard (Workers → coasterrank → Logs — enabled via `[observability]` in
  `wrangler.toml`) or locally via `npx wrangler tail`. Missing fill lines for >15 min = cache
  is broken or upstream is failing (fills log AFTER a successful Supabase read).
- **Trap**: Cloudflare's standard CDN cache analytics do NOT cover Cache API operations
  (`cf-cache-status` is always absent here) — the `X-Ranking-Cache` header and worker logs are
  the only observability. Don't conclude "cache isn't working" from the analytics dashboard.
- **Worker failures are silent by design**: the SPA falls back to direct Supabase queries on
  any non-OK/parse failure, so a broken worker shows up as slightly heavier Supabase load /
  slower board loads, never as user-visible errors. If Supabase metrics show unexplained
  read spikes, check the worker first (502s in Workers Logs, deploy state in Cloudflare).
- The endpoint is GET-only (405 otherwise), and has no purge/bypass param on purpose — see
  PLAN §10 Phase 4.2 before adding one. CORS: the worker's own origin is always reflected;
  extra cross-origin consumers (staging, local dev against prod) via the
  `RANKING_ALLOWED_ORIGINS` Worker var (comma-separated, dashboard Settings → Variables —
  takes effect without a code deploy). No domains are hard-coded in the worker source.

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

To restore a backup locally, follow the restore drill procedure below.

### Restore drill & disaster recovery

*Verified end-to-end on 2026-08-30 against `coasterrank-2026-08-30.sql.gz` (workflow_dispatch run
[33323232098](https://github.com/pandeiro/CoasterRank/actions/runs/33323232098)): all public/auth/
storage rows restored byte-identical (count + content checksums vs prod); every restore error was
accounted for and platform-internal (see error triage table).*

The dump is **plain-text SQL** (pg_dump default, gzipped — not custom format), so it is applied with
`psql`, not `pg_restore`. It contains every non-system schema: `public`, `auth`, `storage`,
`realtime`, `supabase_migrations`, `extensions`, `graphql`/`graphql_public`, `pgbouncer`, `vault`,
plus data for `cron.job` / `cron.job_run_details` (pg_cron schedules **are** in the backup).
Extension *internals* (objects created by `pg_cron`, `pg_net`, `supabase_vault` themselves) are
not dumped — they come back by installing the extension.

#### Step 0 — Prerequisites

- **psql client ≥ 17.6.** pg_dump 17.6 emits `\restrict` / `\unrestrict` psql guards at the
  top/bottom of the dump; psql 17.5 and older print `invalid command \restrict` and skip the guard
  (the dump still restores, but the anti-tamper guard is inactive). Homebrew psql 17.5 was fine for
  the drill but upgrade before relying on it.
- Docker (OrbStack) for the scratch instance.
- Repo `.env` for read-only comparison queries against prod.

#### Step 1 — Fetch and verify the backup

```bash
git -C ../CoasterRankBackups pull --ff-only   # or: gh repo clone pandeiro/CoasterRankBackups
D=../CoasterRankBackups/coasterrank-YYYY-MM-DD.sql.gz
gunzip -t "$D"                                # gzip integrity
gunzip -c "$D" | head  | grep -a "PostgreSQL database dump"            # header
gunzip -c "$D" | tail -4 | grep -a "PostgreSQL database dump complete" # footer (pg17 dumps end with \unrestrict line)
```

#### Step 2 — Scratch Postgres (OrbStack)

```bash
docker run -d --name coasterrank-restore-drill \
  -e POSTGRES_PASSWORD=restore-drill -p 5433:5432 \
  postgres:17-alpine -c shared_preload_libraries=pg_stat_statements
docker exec coasterrank-restore-drill psql -U postgres -c "CREATE DATABASE restore_drill;"
```

Port 5433 avoids colliding with any local Postgres. The preload flag lets the dump's
`pg_stat_statements` extension pre-create cleanly.

#### Step 3 — Pre-create Supabase roles + available extensions

The dump references Supabase roles in GRANTs and object ownership; without them those statements
error and cascade. RLS policies on this schema use `public.is_admin()` / `true`, so policies
themselves have no role deps.

```bash
psql "postgresql://postgres:restore-drill@localhost:5433/restore_drill" -v ON_ERROR_STOP=1 <<'EOF'
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE dashboard_user NOLOGIN;
CREATE ROLE pgbouncer NOLOGIN;
CREATE ROLE supabase_admin NOLOGIN;
CREATE ROLE supabase_auth_admin NOLOGIN;
CREATE ROLE supabase_realtime_admin NOLOGIN;
CREATE ROLE supabase_storage_admin NOLOGIN;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;
EOF
```

(For a general-purpose script, derive the role list from the dump:
`grep -aoE "OWNER TO [a-z_0-9]+" dump.sql | sort -u` plus the `TO <role>` GRANT targets.)

#### Step 4 — Apply the dump (tolerant mode)

```bash
gunzip -c "$D" | psql "postgresql://postgres:restore-drill@localhost:5433/restore_drill" \
  -X -v VERBOSITY=verbose -v ON_ERROR_STOP=0 > /tmp/restore-stdout.log 2> /tmp/restore-errors.log
echo "exit=$?"   # 0 = whole stream processed (errors don't abort in tolerant mode)
```

Do **not** use `psql -1` (single transaction): the first Supabase-only failure would abort
everything. Tolerant mode + full error triage is the correct pattern.

#### Step 5 — Triage the error log

Expected errors on vanilla Postgres (2026-08-30 drill: ~5,160 error lines, **all** in these
categories; zero app-data failures):

| Error (SQLSTATE) | Cause | Concern? |
| --- | --- | --- |
| `invalid command \restrict` / `\unrestrict` | psql client < 17.6 (see Step 0) | No — upgrade client |
| `extension "pg_cron" is not available` / `does not exist` (0A000/42704) | Supabase-only extension | No |
| `extension "pg_net" is not available` / `does not exist` | Supabase-only extension | No |
| `extension "supabase_vault" is not available` / `does not exist` | Supabase-only extension | No |
| `schema "cron" does not exist` (3F000) ×~14 | pg_cron owns that schema; absent on vanilla | No |
| `schema "net" does not exist` ×~5 | pg_net owns that schema | No |
| `relation "cron.jobid_seq"/"cron.runid_seq"/"vault.secrets"/"vault.decrypted_secrets" does not exist` (42P01) | Extension-member objects aren't dumped as DDL | No |
| `function vault.create_secret/... does not exist` (42883) | Vault triggers → member functions absent | No |
| `permission denied to change owner of event trigger` (42501) | Owner must be superuser; `supabase_admin` is superuser on Supabase, not on vanilla | No |
| `syntax error at or near "…"` (42601) ×1260 | **Cascade**: data lines of failed COPYs (`cron.job` 3 rows + `cron.job_run_details` 1256 rows) spill as SQL. If the count ≈ those row counts, nothing else spilled | No |
| `schema "extensions" already exists` (42P06) ×1 | We pre-created it in Step 3 | No |

**Anything not matching this table = a real failure. Investigate before trusting the restore.**

#### Step 6 — Validate the restored data

All prod queries are read-only (source `.env` first). Compare against the scratch DB:

```bash
R="postgresql://postgres:restore-drill@localhost:5433/restore_drill"
# 1. Row counts: all public tables + auth.users/refresh_tokens/sessions/identities + storage.buckets/objects/migrations
for T in coasters parks manufacturers profiles coaster_ratings coaster_aliases coaster_submissions \
         user_rides user_number_ones cron_execution_logs; do
  P=$(psql "$SUPABASE_DB_URL" -tAc "SELECT count(*) FROM public.$T")
  X=$(psql "$R" -tAc "SELECT count(*) FROM public.$T"); echo "$T prod=$P restored=$X"
done
# 2. Content checksum (any core table; columns must exist on both sides)
P=$(psql "$SUPABASE_DB_URL" -tAc "SELECT md5(array_agg(h ORDER BY h)::text) FROM (SELECT md5(concat_ws('|', co.id, co.name, co.slug, co.park_id)) h FROM public.coasters co) s")
X=$(psql "$R" -tAc "…same query…"); echo "$P vs $X"
# 3. Recency: newest restored row == last row before backup time (prod may have drifted past it since)
psql "$R" -tAc "SELECT max(created_at) FROM public.cron_execution_logs"
# 4. RLS parity: relrowsecurity flags + `SELECT count(*) FROM pg_policies WHERE schemaname='public'`
# 5. Join sanity on the restored DB (FK graph intact):
psql "$R" -tAc "SELECT count(*) FROM public.coasters c JOIN public.parks p ON c.park_id=p.id
                JOIN public.manufacturers m ON c.manufacturer_id=m.id"
```

Accepted variance: prod row counts may be *higher* than restored for append-heavy tables
(`cron_execution_logs`) — the recompute cron keeps writing after the backup moment. Verify via
check 3 that the restored max `created_at` ≤ backup time and that prod's count of rows
`created_at <= restored_max` equals the restored count.

#### True DR: restoring onto a fresh Supabase project

The scratch drill proves the *data*; a real DR restore targets a **new Supabase project**, which
removes most of Step 5's friction (all roles exist, extensions including `pg_cron`/`pg_net`/
`supabase_vault` are preinstalled — `cron.job` schedules and data restore from the dump):

1. Create the new Supabase project (same region; Postgres major version must be ≥ dump's, ideally same).
2. Apply the dump as-is over the pooler connection string, tolerant mode (Step 4) — as `postgres`,
   which can `ALTER OWNER` to the platform roles. Expect a much shorter error log; still triage it.
3. Rebind everything that pointed at the old project (new ref = new host + new keys):
   - App: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (new project's keys) → redeploy Workers.
   - GitHub secrets: `SUPABASE_DB_URL` (backup + deploy workflows), `PROJECT_REF`,
     `SUPABASE_SERVICE_ROLE_KEY`; re-run `supabase link --project-ref <new-ref>` locally with a
     fresh `SUPABASE_ACCESS_TOKEN`.
   - External services keyed to the old project (Sentry, Telegram bots keep working — they're repo-side).
4. Post-restore checks: `cron.job` has the 3 schedules; trigger a manual recompute; confirm
   `cron_execution_logs` and `coaster_ratings` start filling; sign in through the app (auth.users
   came across, but Supabase Auth service config is project-level — verify SMTP/rate-limit settings
   in the dashboard).
5. Note the **RPO**: nightly dumps ⇒ up to 24h of data loss. If that ever becomes unacceptable,
   enable Supabase PITR (WAL add-on) — the dump drill remains the last-resort path.

#### Cleanup after a drill

```bash
docker rm -f coasterrank-restore-drill   # scratch instance
# keep the dump + logs as long as useful; /tmp is ephemeral anyway
```


## Data curation: coaster identity & status rubric

How to decide one-row-vs-two and which `status` to set when a ride closes, rebrands, or gets
rebuilt. Every transition needs a **current news citation** — DB self-consistency is not
evidence, because the CSV seed's statuses are a 2023 snapshot (the Superman: Escape from
Krypton lesson: closed Mar 2025, still `operating` in our data until news-checked). Worked
examples: `data/coverage/park-audit-2026-08-30.md`.

### Identity: one coaster row or two?

| Situation | Modeling |
| --- | --- |
| Cosmetic rename / rebrand, same track (Mulholland→Goofy's Sky School, Intimidator 305→Pantherian) | One row: current name on the row, former name(s) → `coaster_aliases`. Never put the *new* name in the alias of an old-name row. |
| Track replaced / structural transformation (Colossus→Twisted Colossus, Hurler→Twisted Timbers) | Two rows: historic ride → `defunct` with its true opening date; the new ride gets its own row and dates. Preserves "rode the original" credits. |
| Same-layout restoration / re-engineering (Montezooma's Revenge→MonteZOOMa: KumbaK LSM rebuild, original spikes/station kept) | One row: current name, model/manufacturer updated to the current build, former name aliased, original opening date kept. |
| Generational namesakes — different rides sharing a name (The Bat '81/'93, Big Dipper '35/'21 at one park) | Two rows; disambiguate names when both would render identically on the board. |
| Relocation to another park | Edit `park_id`, keep `operating`. The `relocated` status is reserved for rides standing at their old site awaiting a move. |

### Status transitions

| Situation | Status |
| --- | --- |
| Temporary shutdown ≤ 3 months (routine refit) | Keep `operating`. |
| Closed for announced repairs / remodel / rebuild, any duration (MonteZOOMa, Tokyo Space Mountain) | `under_construction`. |
| Closed > 3 months, cause or fate unclear | `sbno` (El Toro). |
| Removal announced / demolished | `defunct`. |
| Parent park closes permanently (Six Flags America, Nov 2025) | All the park's rows → `defunct`. |

### Procedure

1. Verify with a current news citation (brave / press / official site), then classify with the
   tables above. When genuinely ambiguous between generations or parks, prefer two
   disambiguated rows over merging (Journey to Atlantis and Big Dipper lessons).
2. Apply via guarded ad-hoc psql (slug+park guards, one transaction; backup first for batches)
   or a crafted `decisions.json` item through the applier.
3. Add former names as aliases, keep the current name on the row, and re-run
   `npm run coverage:doc`-style checks where applicable.
