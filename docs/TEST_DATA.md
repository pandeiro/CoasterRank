# Test & mock data (`testride`)

How to create, use, impersonate, and remove synthetic test users — for exercising the UI,
observing the Bradley-Terry pipeline, and admin-queue testing. The CLI lives in
`scripts/src/testride/`; this doc is the scenario guide.

## Overview

- **Targets prod (`.env`) by default.** Any other project via
  `--db-url / --supabase-url / --service-key`. The banner on every run shows exactly which
  project it is touching (prod is flagged ⚠️).
- **Synthetic users carry two markers** (either suffices):
  1. email on the `@test.coasterrank.dev` domain — **use this convention when signing up manual
     test users through the UI**;
  2. `raw_user_meta_data.synthetic = true` — set automatically by `testride:seed`.
- **Seeded users are login-ready with no email verification**: inserted with
  `email_confirmed_at` set, shared password `testride-password`. No SMTP involved.
- **Safety model**: dry-run by default (`--apply`/`--yes` to write), preview lists every target
  user before deletion, cleanup matches only the exact markers (never a fuzzy pattern), and the
  whole thing is reversible — see "Getting back to the pre-mock state" below.

## Command cheatsheet

```bash
cd scripts

npm run testride:seed -- --users 20 --rides 10-25 --apply   # users ranked M random coasters each
npm run testride:seed -- --users 5 --apply                  # users with no rides (impersonation-only)
npm run testride:seed -- --users 500 --rides 30 --apply     # heavy run
npm run testride:seed -- --users 3 --rides 10 --unranked 2 --with-submissions --apply

npm run testride:report                                     # synthetic + recent users, what each owns
npm run testride:cleanup -- --synthetic                     # preview; add --yes to delete
npm run testride:confirm -- --email x@test.coasterrank.dev --apply
npm run testride:recompute                                  # on-demand recompute (service-role invoke)
```

Seed flags: `--users` (required; creates N _additional_ synthetic users, continuing numbering after the highest existing mock-XXXX user), `--rides <n|min-max>` (random distinct coasters per user,
ranked `1..M`; omit = no rides), `--unranked <n>` (ridden-but-unranked extras), `--with-submissions`
(one pending submission per user), `--seed <n>` (deterministic per batch; rides are
`ON CONFLICT DO NOTHING`).

## Scenarios

### 1. Populate the board at a chosen scale (watch BT work)

```bash
npm run testride:seed -- --users 20 --rides 10-25 --apply
npm run testride:recompute        # or wait ≤15 min for the cron, or click "Recompute now" on /admin
```

Examine the results on the board (ordering, "few votes" badges), coaster detail pages
(comparisons / participants / wins), and the `/admin` rankings widget, which shows the last
run's `durationMs`, pairs, iterations, and convergence. Every 15-minute cron run logs the same
numbers to `cron_execution_logs`, so the "benchmark" is ambient: seed whatever scale you want
and watch the scheduled runs. For deeper looks:

```sql
-- in the Supabase SQL editor
select c.name, r.score, r.comparisons, r.participants
from coaster_ratings r join coasters c on c.id = r.coaster_id
order by r.score desc limit 20;
```

Note: aggregation cost grows ~quadratically with rides-per-user, so to stress the pipeline,
crank `--rides`, not just `--users`.

### 2. Exercise the UI as a mock user (impersonation)

```bash
npm run testride:seed -- --users 5 --apply     # or with rides for ranking flows
```

Then in the app: `/admin` → **Assume identity** → "Assume" on a user. You are now that user
(one-time magiclink via the `assume-identity` Edge Function — no password needed, and it works
for manual `@test.coasterrank.dev` signups whose password you don't know). A bottom banner shows
the impersonation state; **"Return to admin"** restores your admin session.

Things to exercise: drag-sort ranking on `/me`, submissions on `/submit`, profile editing,
`/riders/<username>` share pages (avatar upload generates the OG share card), board filtering.
Everything written lands on the marked user and is cleanup-able.

### 3. Manual test signups without email access

Sign up through the UI as `anything@test.coasterrank.dev`, then:

```bash
npm run testride:confirm -- --email anything@test.coasterrank.dev --apply
```

(Confirming a _non_-synthetic email requires `--any-email` — it would verify an account you may
not own.) These users carry marker 1, so bulk cleanup finds them too.

### 4. Admin-queue testing

```bash
npm run testride:seed -- --users 3 --rides 10 --with-submissions --apply
```

Each seeded user gets a pending submission → work the queue on `/admin` → **Submissions**.
**Reject them when done** (or just let cleanup delete them): approving creates a real coaster
row that survives user cleanup.

### 5. Getting back to the pre-mock state

```bash
npm run testride:cleanup -- --synthetic     # preview: targets, cascade counts, storage files
npm run testride:cleanup -- --synthetic --yes
npm run testride:recompute
npm run testride:report                     # verify: synthetic (either marker): 0
```

Inverse map — what deleting the `auth.users` rows does:

| Data                                        | Mechanism                                                                                                                   |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `profiles`, `user_rides`, their submissions | FK cascade from `auth.users`                                                                                                |
| Submissions they **reviewed**               | kept; `reviewed_by` set to NULL (preview warns)                                                                             |
| Avatar / OG-card storage files              | deleted first via the service-role storage API (no cascade)                                                                 |
| `coaster_ratings` (derived)                 | next recompute; with no real ranked rides left, the all-unranked path clears the table — the board is back to fully unrated |
| `cron_execution_logs` rows, Telegram pings  | residue that cannot be undone (harmless; mute the events bot during testing if pings annoy you)                             |

With real ranked rides in the system, cleanup re-derives rankings from whatever real data
remains — synthetic influence simply disappears.

### 6. Before launch: verify zero synthetic users

```bash
npm run testride:report
```

The shared test password means no synthetic user may survive to public launch. `report` showing
`0` synthetic (with no marker-drift warnings) is the gate. Surgical stragglers:
`testride:cleanup -- --emails <address> --yes`.
