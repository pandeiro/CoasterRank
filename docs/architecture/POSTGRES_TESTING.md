# Postgres Testing (Job A)

Blocking per-PR database tests: full migration preflight + pgTAP suites against a pinned `supabase/postgres` container. No Supabase CLI, no GoTrue/PostgREST/Kong. Decisions behind this shape: [`decisions/2026-09-postgres-testing.md`](decisions/2026-09-postgres-testing.md).

## What runs in CI

`.github/workflows/db-tests.yml` (`db-tests/postgres`, every PR + main), ~53s total:

1. Boot `supabase/postgres:17.6.1.175` as a service container; install `postgresql-client` + `pgtap` (apt).
2. **Platform shim** as `supabase_admin` (`supabase/tests/setup/00_platform_shim.sql`) — test-only compat, never shipped (see below).
3. **Crash probe** (`supabase/postgres#2377`): revoked-`EXECUTE` call as `authenticated` must raise a clean `42501` with the server still up, or the job fails.
4. **Migration preflight**: all `supabase/migrations/*.sql` applied in order as `postgres` with `ON_ERROR_STOP=1` — any failure fails the job.
5. **pgTAP**: `pg_prove` as `postgres` over `supabase/tests/rls/*.test.sql` + `supabase/tests/pairs/*.test.sql` (14 tests, <1s).

The job holds no production credentials; every connection targets the ephemeral localhost container.

## File map

```
supabase/tests/
├── setup/00_platform_shim.sql        # supabase_admin, once per DB. Excluded from pg_prove glob.
├── rls/user_rides_rls.test.sql       # P0 smoke (7): owner allow, cross-user deny, email gate, anon filter
└── pairs/pair_delta_deletion.test.sql# P0 characterization (7): profile-delete delta invariant
```

## How it works (facts that bite)

- **Two connections.** `postgres` is not superuser in this image (`supabase_admin` is), and `supabase_*_admin` memberships can't be self-granted — so the shim runs as `supabase_admin`, while migrations and tests run as `postgres` to preserve prod's ownership/privilege topology.
- **Shim contents.** (a) `CREATE EXTENSION pgtap` (1.3.3, ships available-but-not-enabled); (b) `auth.users.email_confirmed_at` — the bare image bootstraps ancient GoTrue without it, prod has it, and it's the only non-`id` `auth.users` column migrations reference; (c) minimal `storage.buckets`/`objects`/`foldername()` — the image ships an empty storage schema and our one storage migration needs them to exist. Drift in any of these fails loud at apply time.
- **Impersonation.** `auth.uid()` reads `request.jwt.claim.sub` (singular — GoTrue sets it per request in prod); tests set it via `set_config(..., true)` next to `SET LOCAL ROLE`. `postgres` is a member of `authenticated`/`anon`, so role switching works.
- **Self-contained files.** Every `*.test.sql` is `BEGIN; SELECT plan(N); …; SELECT * FROM finish(); ROLLBACK;` — pgTAP's `throws_ok`/`lives_ok` use savepoints inside the file's transaction, and nothing persists between files.
- **Negatives assert RLS, not missing privileges.** The image auto-grants default table privileges (prod doesn't, but our migrations carry explicit grants for client tables), so the suite pins RLS evaluation — e.g. anon INSERTs into `user_rides` die at the revoked email-gate helper, still `42501`.

## Local loop

```bash
docker run -d --name crank-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 \
  supabase/postgres:17.6.1.175
psql -h localhost -U supabase_admin -d postgres -f supabase/tests/setup/00_platform_shim.sql
for f in $(ls supabase/migrations/*.sql | sort); do
  psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f"
done
pg_prove -h localhost -U postgres -D postgres supabase/tests/rls/*.test.sql supabase/tests/pairs/*.test.sql
```

## Adding a test

1. Create `supabase/tests/<area>/<name>.test.sql` with the `BEGIN/plan/finish/ROLLBACK` wrapper; fixtures inside the transaction.
2. Extend the `pg_prove` glob in `db-tests.yml` if you add a new directory.
3. Keep the smoke floor: one positive + one negative per operation. Characterization tests assert outcomes/invariants, never mechanics (binding rule for the mega-user refactor — its design PR must link the suites it preserves).

## Pin upgrades

The image tag in `db-tests.yml` is exact on purpose. To upgrade: pull the candidate, re-run the local loop above plus the crash probe (`SET ROLE authenticated` + revoked-`EXECUTE` → clean `42501`, server stays up) on the registry CI pulls from, then bump the tag. Re-check pgTAP availability at pin time.

## Future work

- **P1**: guest rank-conflict merge, `handle_new_user()` NULL-downstream, `submission_payload_valid()`.
- **P2/P3** (only while green and cheap): recompute representatives, admin grant boundaries, pair-state batch/sweep.
- **TBD (pre-registered)**: mega-user refactor invariants (per-user caps, chunked rewrites) — specified by that design PR.
- **Job B (deferred)**: non-blocking full-stack signature-drift checks; never a gate until fast and stable.
