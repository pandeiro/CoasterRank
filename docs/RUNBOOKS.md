# Runbooks

Operational runbooks for one-time and rare CoasterRank tasks. For the everyday command reference
see `AGENTS.md`; for architecture and decisions see `docs/PLAN.md`.

## Bootstrap the first admin account

After creating your user via the SPA signup (and confirming email), run once in the Supabase SQL
editor, replacing the email with yours:

```sql
update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'you@example.com');
```

## Create the Supabase project (just-in-time, before Phase 1)

1. Create a new project in the CoasterRank Supabase account (dashboard).
2. Copy the project ref, API URL, anon key, service-role key, and Database connection string.
3. Fill in the corresponding values in your local `.env`.
4. Set GitHub repo secrets: `SUPABASE_ACCESS_TOKEN`, `PROJECT_REF`, `RECOMPUTE_AUTH_SECRET`.
5. Run `supabase link --project-ref <ref>` from the repo root to bind this directory.

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

## Connect Netlify (just-in-time, before Phase 4)

1. Create a Netlify account and "Add new site" → import the CoasterRank GitHub repo.
2. Build command: `npm run build`. Base directory: `app/`. Publish directory: `app/dist`.
3. Add env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Netlify site settings.
4. Add the Netlify URL (`https://<site>.netlify.app`) plus `http://localhost:5173` to Supabase Auth
   → Redirect URLs.

Once connected, run the **go-live checklist** (`docs/PLAN.md` §9.5) before sharing the URL.

## Point a custom domain at Netlify (whenever you go public)

1. Buy the domain (~$10-15/yr) from any registrar.
2. In Netlify: Site → Domain settings → Add custom domain; follow DNS instructions
   (apex + www CNAME/A records). HTTPS (Let's Encrypt) is provisioned automatically.
3. In Supabase: Auth → URL Configuration → set Site URL to `https://<your-domain>` and add
   `https://<your-domain>/**` (plus `http://localhost:5173/**`) to Redirect URLs.
4. Re-run the **auth-critical** steps of the go-live checklist (`docs/PLAN.md` §9.5).
