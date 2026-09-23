# RFC: Automated Testing Strategy for Supabase Migrations & Postgres RPC Logic

**Author:** CoasterRank Engineering
**Status:** Proposed / Draft (v2 — incorporates `docs/RFC_POSTGRES_TESTING_REVIEW.md`)
**Date:** September 22, 2026 (rev. September 23, 2026)

---

## Executive Summary

CoasterRank relies heavily on Supabase PostgreSQL for core domain logic, security constraints, analytical views, and batch algorithms. Key logic lives directly in Postgres functions and triggers — including:
- `handle_new_user()` (auth trigger, profile fallback, reserved usernames)
- `submission_payload_valid()` (complex JSON schema & state validation for data moderation)
- `materialize_guest_rides()` (guest list promotion, conflict resolution, atomic merges)
- `pair_maintain_step()`, `pair_fit_step()`, `pair_fit_agg()` (incremental Bradley-Terry pair graph state machine)
- Recompute calculation RPCs (`pairwise_wins`, `pairwise_wins_custom`, `ranked_participants`, `recompute_idle_fingerprint`)
- `share_nudge_eligibility()`, `public_rider_page()`, `admin_sharing_funnel()`, `admin_user_overview()` (security-definer RPCs & permissions)
- RLS policies on `user_rides`, `submissions`, `profiles`, `user_feedback`, etc.

Our TypeScript layer (`app/`, `packages/bt/`, `packages/match/`) has extensive Vitest coverage. Those 71 test files mock `supabase.rpc()` — and that is **correct test design, not a deficit**: the mocks encode the client↔server interface contract and let us test client behavior, error handling, and optimistic updates decoupled from the database. This RFC does not propose replacing them.

The investment filter for new database tests is narrower: **silent, non-surfacing, hard-to-recover-from harm** — bugs that produce no error, no failed job, and no alert, and whose damage window is indefinite. That means RLS bypasses and Bradley-Terry state corruption first; loud failures (validation errors, failed RPCs, Sentry-visible errors) last.

This v2 revision accepts the staff review's core corrections:

1. **Migration preflight is Phase 0** — the highest-value, lowest-cost item, gated as a CI blocker independently of any pgTAP tests.
2. **Primary CI path is a plain Postgres service container**, not `supabase start`. Full-stack boot is deferred to an optional, non-blocking job.
3. **Priorities are reordered by failure consequence**, not by code complexity: RLS policy drift and the pair delta-deletion invariant move up; the already-well-covered pair fit moves down.
4. **The pair-maintenance / delta-deletion invariant gets its own coverage row**, scoped explicitly as pre-refactor characterization tests for the upcoming mega-user queue work — not folded into the general pair-state line.
5. **The PostgREST integration layer is deferred** until the pgTAP suite is green and stable.

### Why this matters now: the mega-user refactor

We are considering changes to the pair-maintenance machinery to handle very large users without them plugging the `pair_dirty_users` queue (batching, per-user caps, or chunked slice rewrites — design TBD). That refactor will increase the complexity of exactly the delta-maintenance code whose invariants are currently untested. The harness proposed here must therefore be able to **prove correctness of the current behavior first** (characterization tests), so the refactor has something to preserve. The delta-deletion row in §3 exists for that purpose.

---

## Failure-mode calibration: what actually hurt us

Our real production incidents have been behavioral, systemic, and emergent — not "the SQL function has a logic error":

- The **pair-payload truncation bug** (board fitted on ~20% of pair data) was a silent contract between PostgREST's row cap and the Edge Function. A pgTAP test on `pairwise_wins()` would not have caught it.
- The **O(n²) trigger write-amplification trap** was discovered by empirical benchmarking (see `docs/research/benchmarks/2026-09-pairwise/`), not SQL logic testing.
- The **06:30 gateway 504** was a latency/scale failure, not pgTAP-testable.
- The **recompute cron silently skipping via the queue-aware idle-skip interaction** was caught in the shadow soak.
- The **`pairwise_wins_custom` weighting distortion** (5-ride user supplying ~99.5% of edge weight) was caught by simulation and analysis.

The pattern: pgTAP catches **state-invariant and permission-drift** bugs. It does not catch systemic/emergent bugs — those remain the job of the bench harness, the shadow soak, parity gates, and `cron_execution_logs` observability. This RFC scopes pgTAP to what it is best at and does not claim broader coverage.

---

## Core Testing Philosophy & Constraints

1. **Local developer workflow unchanged**: no persistent `supabase start` daemon required for SPA work. Database tests run in CI on every PR; locally they run on demand against an ephemeral container.
2. **Zero production risk**: all test execution happens in ephemeral CI/local containers. No test job ever receives production credentials or connection strings. Guardrail: the DB-test workflow must not read `SUPABASE_DB_URL` / `SUPABASE_SERVICE_ROLE_KEY` secrets at all — if a test needs a connection string, it targets `localhost` only.
3. **Two-layer CI, hot path under ~90s**: the blocking per-PR job is Postgres-only (migration preflight + pgTAP) with a hot-path budget of **~90 seconds**. Anything needing GoTrue/PostgREST/Kong (`supabase start`) lives in a separate **optional, non-blocking** job until proven fast and stable. Rationale: slow blocking CI discourages iterating on migrations — the opposite of this initiative's goal.
4. **Migration preflight is the blocker; pgTAP is incremental**: the `db reset` gate blocks merges on migration breakage from day one. Individual pgTAP files can land incrementally without holding up unrelated PRs (only the preflight gate + the tests themselves must pass).
5. **Preserve existing test boundaries**: `app/src/lib/validation.test.ts` keeps the `RESERVED_USERNAMES` list-parity check. Postgres tests assert database consequences only (e.g. `handle_new_user()` falls back to `username = NULL` without throwing, and the resulting row doesn't break downstream queries).
6. **Defense in depth, in priority order**:
   - **Migration preflight (Phase 0)**: full 65+ migration history applies cleanly.
   - **RLS policy-drift smoke (P0)**: `SET ROLE` + `request.jwt.claims` impersonation proves policies enforce what migration comments claim. Scoped — see open question below on escalation depth.
   - **Silent-corruption invariants (P0/P1)**: pair delta-deletion, guest rank-gapless merge, `handle_new_user()` NULL-username downstream validity.
   - **Recompute/pair math + admin grants (P2/P3)**: already covered by bench parity, shadow soak, and logs; additive pgTAP only.
   - **PostgREST HTTP contracts (deferred)**: only the class pgTAP cannot see (SQL↔JS signature drift through PostgREST casting).

---

## Proposed Architecture

Two jobs from the start — not one job with a fallback:

```
  ┌─────────────────────────────────────────────────┐
  │  Job A (blocking, every PR): postgres-only      │
  │  ─────────────────────────────────────────────  │
  │  postgres service container                     │
  │    → apply all migrations (preflight gate)      │
  │    → pg_prove supabase/tests/*.test.sql         │
  │  No Docker Compose. No GoTrue/PostgREST/Kong.   │
  │  Budget: ~90s hot path.                         │
  └─────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────┐
  │  Job B (non-blocking, manual/weekly): full stack│
  │  ─────────────────────────────────────────────  │
  │  supabase start (PostgREST + GoTrue present)    │
  │    → tiny supabase-js contract checks           │
  │  Not a merge gate until fast + stable.          │
  └─────────────────────────────────────────────────┘
```

Job A needs one answered spike before implementation (see Open Questions): which Postgres image bootstraps enough of the Supabase platform (`auth.users`, required extensions including pgTAP) for our 65+ migrations to apply without the full stack. Candidates: `supabase/postgres:17.*` image vs. vanilla `postgres:17` + minimal `auth.users` stub + explicit `CREATE EXTENSION`. The spike decides; the RFC does not assume.

---

## 1. Unit Testing Harness (pgTAP & Role Impersonation)

### Directory Structure

```
supabase/tests/
├── 00000_db_setup.sql                  # CREATE EXTENSION pgtap (service Job A); helper fns
├── auth/
│   └── handle_new_user.test.sql        # collision → NULL username; NULL row stays valid downstream
├── rpc/
│   ├── materialize_guest_rides.test.sql # guest [1,2,3] onto owned [1,2] w/ overlap → gapless ranks
│   ├── submission_payload_valid.test.sql
│   └── share_nudge_eligibility.test.sql
├── pairs/
│   ├── pair_delta_deletion.test.sql    # PRE-REFACTOR CHARACTERIZATION (see §3, mega-user row)
│   └── pair_fit_state_machine.test.sql # dirty flags, batch steps, sweep (P3, additive only)
├── rls/
│   ├── user_rides_rls.test.sql         # owner R/W, cross-user deny, anon deny (P0 smoke)
│   ├── submissions_rls.test.sql
│   └── profiles_rls.test.sql
├── recompute/
│   └── recompute_rpcs.test.sql         # pairwise_wins_custom, ranked_participants, fingerprint (P2)
└── admin/
    └── admin_grants.test.sql           # service_role-only RPCs reject authenticated/anon (P2)
```

### Role Impersonation & RLS Testing

No new production dependencies for tests (no Basejump in the shipped schema). Tests impersonate via native session settings:

```sql
BEGIN;
SELECT plan(4);

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'rider1@example.com');
INSERT INTO public.profiles (id, username, display_name) VALUES ('00000000-0000-0000-0000-000000000001', 'rider1', 'Rider One');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);

SELECT lives_ok(
  $$ INSERT INTO public.user_rides (user_id, coaster_id, rank) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 1) $$,
  'User can insert their own ride'
);

SELECT throws_ok(
  $$ INSERT INTO public.user_rides (user_id, coaster_id, rank) VALUES ('00000000-0000-0000-0000-000000000002', gen_random_uuid(), 1) $$,
  '42501',
  'User cannot insert ride for another user'
);

SELECT * FROM finish();
ROLLBACK;
```

Scope note: the P0 RLS suite proves **policy drift** (policies enforce what we claim for the owner/anon/authenticated matrix on `user_rides`, `submissions`, `profiles`). Full privilege-escalation matrices (admin-impersonation, service-role confusion, storage paths) are explicitly out of scope until the team resolves the open question in §6.

---

## 2. Integration / Black-Box Verification Layer — DEFERRED

The `supabase-js` suite targeting a started stack (`http://127.0.0.1:54321`) is **deferred until Job A is green and stable**. When revived as non-blocking Job B, its scope is the one class pgTAP cannot see:

- **SQL↔JS signature drift**: RPC argument names/types as seen through PostgREST casting (e.g. `materialize_guest_rides()` JSON shapes, `public_rider_page()` return shape).
- **PostgREST grant exposure**: anon/authenticated reachability of the public contract surface (`public_board_meta()`, `public_rider_page()`, `ranking_schedule()`).

It does not re-test what pgTAP already proves (grant boundaries, RLS enforcement). No `supabase start` cost is paid on the blocking path before this layer earns its keep.

---

## 3. Coverage Targets & Priority Phasing

Ordered by **failure consequence** (silent + indefinite damage first), not by code interest:

| Priority | Component / Function | Testing Objective | Key Risks Checked |
|---|---|---|---|
| **Phase 0 (gate)** | Migration preflight (`db reset` on Job A) | All 65+ migrations apply cleanly in dependency order; required extensions present | Deploy-time `db push` failure, wrong intra-PR dependency order, missing extension, signature drift vs. dependent views/triggers |
| **P0** | RLS policy-drift smoke (`user_rides`, `submissions`, `profiles`) | Owner R/W, cross-user deny, anon deny via claims impersonation | Silent RLS bypass with indefinite damage window; never previously verified |
| **P0 (characterization)** | Pair delta-deletion invariant (`pair_cleanup_on_profile_delete`) — **pre-refactor characterization for mega-user work** | Deleting a profile subtracts exactly that user's `user_pairs` slice from `pair_totals` via signed negative deltas; rows with `wins <= 0` delete; no residual `weight_sum`/`wins` drift; `pair_dirty_users`/`pair_user_state` rows clear; concurrent-delete ordering safe | Ghost wins biasing every subsequent fit forever. Purpose is to **lock current behavior before the mega-user queue refactor changes this code** — distinct from the general pair-state line below, which protects the shipped fit |
| **P1** | `materialize_guest_rides()` rank-conflict case | Guest [1,2,3] merged onto owned [1,2] with overlap → gapless positive-integer sequence; timestamp precedence holds | Off-by-one rank gaps silently corrupting the user's BT contribution at next recompute |
| **P1** | `handle_new_user()` NULL-username downstream | Collision/reserved metadata → profile row with `username IS NULL` that violates nothing and breaks no downstream query (share pages, nudge, rider RPCs) | Share-nudge loop, broken rider pages for NULL-username users |
| **P1** | `submission_payload_valid()` | JSONB structure, lengths, URLs, enum kinds (already user-visible on failure — loud, so P1 not P0) | Corrupted moderation queue rows |
| **P2** | Recompute RPCs (`pairwise_wins_custom`, `ranked_participants`, `recompute_idle_fingerprint`) | Representative aggregation + idle-skip correctness | Unnecessary cron runs / missed recomputes (observable in logs; additive coverage) |
| **P2** | Admin RPC grants (`admin_user_overview`, `admin_sharing_funnel`, `coaster_ride_counts`) | Non-privileged callers get permission errors | Privilege escalation (narrow surface; direct-grant tests suffice) |
| **P3** | Pair state machine (`pair_fit_step`, `pair_maintain_step`, dirty triggers, sweep) | Batch boundaries, idempotent re-queue, sweep self-heal | Already the most-covered component (bench parity + shadow soak + queue-depth observability); pgTAP is additive only |
| **Deferred** | PostgREST HTTP contracts (Job B) | SQL↔JS signature drift through PostgREST casting | Client call-shape mismatch (partially covered today by generated types + contract mocks) |

Explicitly **not** in pgTAP scope: payload-truncation contracts (needs PostgREST row-cap + Edge Function assertion), write-amplification/latency walls (needs bench harness), cron skip interactions (needs soak), weighting-distortion analysis (needs simulation). Those stay with their existing harnesses.

---

## 4. GitHub Actions Integration Strategy

Blocking Job A sketch (Postgres service container; exact image decided by the §6 spike):

```yaml
jobs:
  db-tests:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: supabase/postgres:17.x  # TBD by spike; must provide auth schema + pgTAP
        env:
          POSTGRES_PASSWORD: postgres
        ports: ["5432:5432"]
        options: >-
          --health-cmd="pg_isready -U postgres"
          --health-interval=5s --health-timeout=5s --health-retries=10
    steps:
      - uses: actions/checkout@v4
      - name: Apply all migrations (Phase 0 preflight gate)
        run: psql "$TEST_DATABASE_URL" -f <migrations in order>
      - name: Run pgTAP suite
        run: pg_prove -d "$TEST_DATABASE_URL" supabase/tests/**/*.test.sql
```

Notes:
- No production secrets in this job's environment. Connection string targets `localhost` only.
- If the image spike fails (migrations need more of the platform than the image provides), the fallback is `supabase start -x ...` **for Job A too** — but that outcome must be measured against the ~90s budget before acceptance.
- Job B (full `supabase start` + `supabase-js` checks) does not exist until Job A is stable. When created, it is `continue-on-error: true` / non-required until matured.

---

## 5. Developer Guide & Tooling Invocations

```bash
# Postgres-only loop (primary; matches CI Job A — exact image/tag in §6 spike outcome)
docker run -d --name crank-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 <image:tag>
psql "postgres://postgres:postgres@localhost:5432/postgres" -f <migrations in order>
pg_prove -d "postgres://postgres:postgres@localhost:5432/postgres" supabase/tests/**/*.test.sql

# Full-stack loop (only when working on Job B / PostgREST-visible behavior)
supabase start -x realtime,storage-api,imgproxy,inbucket
supabase test db
supabase stop
```

---

## 6. Open Questions

1. **Postgres image spike**: does `supabase/postgres:17.x` (or vanilla `postgres:17` + stub `auth.users` + `CREATE EXTENSION pgtap`) apply our full migration history? Owner + acceptance criterion needed before Job A implementation. If neither works cheaply, re-scope.
2. **RLS escalation depth**: P0 covers policy-drift smoke. Does the team want the full escalation matrix (admin-impersonation paths, service-role confusion, storage-adjacent policies) in a later phase, or is smoke + code review the standing policy? Decision deferred; current RFC budgets smoke only.
3. **Mega-user refactor sequencing**: characterization tests (§3 P0 row) must land **before** the queue refactor's design PR, so the refactor diff has invariants to preserve. Who owns the refactor design, and does it need new coverage rows (e.g. per-user pair caps, chunked slice rewrites) added here once designed?
4. **pgTAP provisioning**: `CREATE EXTENSION pgtap` in `00000_db_setup.sql` vs. baked into the image — decided by the spike in (1).

---

## Implementation Roadmap

1. **Phase 0: Migration preflight gate (first, standalone PR)**
   - Job A skeleton: Postgres service + ordered migration apply. No pgTAP files yet (one `SELECT 1` smoke is enough).
   - Gate blocks PRs touching `supabase/migrations/`. Record cold/hot timing in the PR.
2. **Phase 1: Harness + baseline + RLS smoke**
   - `supabase/tests/` scaffold, pgTAP extension wiring, `user_rides`/`submissions`/`profiles` drift tests.
   - Confirm Job A stays ~90s; publish baseline.
3. **Phase 2: Silent-corruption invariants (characterization before the refactor)**
   - Pair delta-deletion suite, guest rank-conflict suite, `handle_new_user()` NULL-downstream suite.
   - Explicit merge requirement: land before the mega-user queue design PR.
4. **Phase 3: Additive coverage (only if Phases 0–2 are green and cheap)**
   - Recompute RPC representatives, admin grant boundaries, pair-state batch/sweep tests.
5. **Phase 4 (deferred): Non-blocking Job B**
   - Full-stack boot + minimal `supabase-js` signature-drift checks. Never a merge gate until proven fast and stable.
