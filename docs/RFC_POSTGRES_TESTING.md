# RFC: Automated Testing Strategy for Supabase Migrations & Postgres RPC Logic

**Author:** CoasterRank Engineering  
**Status:** Proposed / Draft  
**Date:** September 22, 2026  

---

## Executive Summary

CoasterRank relies heavily on Supabase PostgreSQL for critical core domain logic, security constraints, analytical views, and batch algorithms. Key business logic lives directly in Postgres functions and triggers—including:
- `handle_new_user()` (auth triggers, profile fallback, reserved usernames)
- `submission_payload_valid()` (complex JSON schema & state validation for data moderation)
- `materialize_guest_rides()` (guest list promotion, conflict resolution, atomic merges)
- `pair_fit_agg()`, `pair_fit_step()`, `pair_maintain_step()` (incremental Bradley-Terry pair graph state machine)
- Recompute calculation RPCs (`pairwise_wins`, `pairwise_wins_custom`, `ranked_participants`, `recompute_idle_fingerprint`)
- `share_nudge_eligibility()`, `public_rider_page()`, `admin_sharing_funnel()`, `admin_user_overview()` (security definer RPCs & permissions)
- RLS Policies on `user_rides`, `submissions`, `profiles`, `user_feedback`, etc.

While our TypeScript layer (`app/`, `packages/bt/`, `packages/match/`) has extensive unit testing with Vitest, our 71 Vitest test files mock `supabase.rpc()` and therefore verify client call/error handling rather than actual SQL execution, grants, triggers, or RLS behavior. That leaves a substantial part of our domain logic and security boundary unexercised in CI.

This RFC outlines our strategy for introducing **pgTAP-based unit testing** alongside a targeted **PostgREST HTTP / `supabase-js` verification layer** in GitHub Actions, while establishing a realistic CI boot baseline, clarifying dependency management, preserving existing test boundaries, and preventing migration drift.

---

## Core Testing Philosophy & Constraints

1. **Local Developer Workflow Unchanged**: Developers do *not* need to keep a local Supabase CLI daemon running continuously (`supabase start`) for standard day-to-day SPA frontend work. However, developers can run `supabase test db` locally when authoring migrations or RPCs.
2. **Zero Production Risk**: Automated tests run in ephemeral CI containers (or isolated local ephemeral containers). No test execution touches remote staging or production databases.
3. **Realistic CI Time Budget**: We will establish an empirical baseline on CI for cold Docker image pulls and `supabase start` container spin-up (which includes Postgres, GoTrue Auth, PostgREST, and Kong). Our target is to keep total DB job duration under **60–90 seconds**, evaluating a pure Postgres service container fallback if Docker overhead becomes bottlenecked.
4. **Migration Pre-flight Verification**: Beyond testing RPCs, every CI run will execute `supabase db reset` (applying the complete migration history). This catches syntax errors, missing extensions, out-of-order timestamps, or broken schema dependencies *before* merging to `main` (avoiding deploy-time `db push` failures).
5. **Preserve Existing Unit Test Boundaries**: Tests in `app/src/lib/` (e.g., `validation.test.ts` checking `RESERVED_USERNAMES` parity) will remain intact. Postgres tests will focus strictly on database consequences (e.g., ensuring `handle_new_user()` falls back to `username = NULL` on collision without throwing).
6. **Defense in Depth**:
   - **Unit Level (pgTAP)**: In-database SQL assertions for internal tables, helper functions, trigger behavior, state transitions, and edge cases. Fast, transactional rollback per test.
   - **Permission & RLS Level (Native Claims / Helpers)**: Role context tests using explicit JWT claims setting (`set_config('request.jwt.claims', ...)`) or standard pgTAP role switches (`SET ROLE authenticated`), avoiding unvetted production dependencies.
   - **Integration / HTTP Level (supabase-js / PostgREST)**: Selective black-box verification of grants, PostgREST exposure, and JS client interface contracts for critical user flows.

---

## Proposed Architecture

```
                      +------------------------------------------+
                      |         GitHub Actions CI Runner         |
                      +------------------------------------------+
                                           |
                                 [supabase/setup-cli]
                                           |
                                 [supabase db start]
                           (Migration preflight + schema reset)
                                           |
                     +---------------------+---------------------+
                     |                                           |
        [1. pgTAP Unit Suite]                      [2. PostgREST Integration]
      supabase test db (pg_prove)                    vitest run supabase/tests/integration
  Executes *.sql under supabase/tests/            Executes TypeScript RPC integration tests
   Rolls back each test transaction                Validates RLS, Grants, PostgREST JSON
```

---

## 1. Unit Testing Harness (pgTAP & Role Impersonation)

### Directory Structure
All database tests will be located under `supabase/tests/`:

```
supabase/tests/
├── 00000_db_setup.sql             # Enables pgTAP and helper functions if needed
├── auth/
│   └── handle_new_user.test.sql   # Tests auth.users trigger, profile creation, fallback on username collision
├── rpc/
│   ├── materialize_guest_rides.test.sql # Guest list promotion & atomic merges
│   ├── submission_payload_valid.test.sql # Complex JSON validation
│   ├── share_nudge_eligibility.test.sql  # Nudge eligibility heuristics
│   └── recompute_rpcs.test.sql          # pairwise_wins, ranked_participants, fingerprint checks
├── pairs/
│   └── pair_fit_state_machine.test.sql  # Tests incremental pair maintenance & fitting logic
├── admin/
│   └── admin_grants.test.sql           # Grant boundary tests for admin-only RPCs
└── rls/
    ├── user_rides_rls.test.sql          # Role impersonation tests (anon vs authenticated vs owner)
    └── profiles_rls.test.sql
```

### Role Impersonation & RLS Testing
Rather than introducing heavy external dependencies to production schema, pgTAP tests will impersonate users via native PostgreSQL session settings (`SET LOCAL ROLE authenticated;`, `set_config('request.jwt.claims', ..., true)`):

```sql
BEGIN;
SELECT plan(4);

-- 1. Setup test fixtures
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'rider1@example.com');
INSERT INTO public.profiles (id, username, display_name) VALUES ('00000000-0000-0000-0000-000000000001', 'rider1', 'Rider One');

-- 2. Impersonate authenticated user via local session GUC
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub": "00000000-0000-0000-0000-000000000001", "role": "authenticated"}', true);

-- 3. Assertions
SELECT lives_ok(
  $$ INSERT INTO public.user_rides (user_id, coaster_id, rank) VALUES ('00000000-0000-0000-0000-000000000001', gen_random_uuid(), 1) $$,
  'User can insert their own ride'
);

SELECT throws_ok(
  $$ INSERT INTO public.user_rides (user_id, coaster_id, rank) VALUES ('00000000-0000-0000-0000-000000000002', gen_random_uuid(), 1) $$,
  '42501', -- Insufficient privilege / RLS violation
  'User cannot insert ride for another user'
);

SELECT * FROM finish();
ROLLBACK;
```

---

## 2. Integration / Black-Box Verification Layer (supabase-js)

While pgTAP tests SQL functions directly, PostgREST enforces HTTP permissions, custom header handling, RPC parameter casting, and security-definer function grants.

We will add a lightweight integration test suite under `supabase/tests/integration/` using Vitest + `@supabase/supabase-js` targeting the running local Supabase instance (`http://127.0.0.1:54321`).

### Scope of Integration Tests
- **RPC Grant Violations**: Verify `anon` cannot invoke `pair_fit_step()`, `admin_user_overview()`, or `admin_sharing_funnel()`.
- **PostgREST Type Serialization**: Verify complex JSON inputs to `materialize_guest_rides()` parse cleanly over HTTP.
- **Anon Public API Access**: Verify `public_rider_page()` and `public_board_meta()` return valid payloads over PostgREST without credentials.

---

## 3. Coverage Targets & Priority Phasing

We phase coverage starting with the highest risk/complexity database logic:

| Priority | Component / Function | Testing Objective | Key Risks Checked |
|---|---|---|---|
| **P0** | `materialize_guest_rides()` | Atomic guest list promotion, conflict resolution, timestamp precedence, duplicate rank shifting | Data corruption on guest login/signup |
| **P0** | `submission_payload_valid()` | Payload schema verification (JSONB structure, string lengths, URLs, enum kinds) | Corrupted moderation queue rows |
| **P1** | Recompute calculation RPCs (`pairwise_wins`, `pairwise_wins_custom`, `ranked_participants`, `recompute_idle_fingerprint`) | Direct mathematical calculation, participant counts, idle state detection | Algorithmic recompute corruption / unnecessary cron runs |
| **P1** | Pair State Machine (`pair_fit_step`, `pair_maintain_step`, `pair_mark_dirty_*`) | Triggering dirty flags, incremental pair fitting accumulation, statement budget & loop boundaries | Recompute inaccuracies, unmaintained pair state |
| **P1** | `handle_new_user()` & Auth Triggers | Profile auto-creation, username collision handling (fallback to NULL), reserved username handling | Failed signups, fallback logic breaking |
| **P2** | Admin RPC Grants (`admin_user_overview`, `admin_sharing_funnel`, `admin_ride_counts`) | Access control validation (ensure non-service_role/authenticated caller receives permission error) | Unauthorized data access / admin privilege escalation |
| **P2** | RLS Policies (`user_rides`, `submissions`, `profiles`) | Owner read/write, public list visibility, admin-only fields | Security leaks, unauthorized user modifications |
| **P2** | `share_nudge_eligibility()` & `public_rider_page()` | Eligibility heuristics, public flag gating, anonymous access | Information leakage of non-public lists |

---

## 4. GitHub Actions Integration Strategy

We will update `.github/workflows/ci.yml` (or create `.github/workflows/db-tests.yml`) to include a DB test job:

```yaml
jobs:
  db-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup Supabase CLI
        uses: supabase/setup-cli@v1
        with:
          version: latest

      - name: Start Supabase (minimal services)
        run: |
          # Disable unneeded containers to minimize boot time
          supabase start -x realtime,storage-api,imgproxy,inbucket

      - name: Run pgTAP Database Unit Tests
        run: supabase test db

      - name: Run Supabase JS RPC Integration Tests
        run: |
          cd app
          npm run test:db-integration
```

---

## 5. Developer Guide & Tooling Invocations

For local testing when writing new RPCs or migrations:

```bash
# 1. Start local Postgres + Supabase services (one-time background daemon)
supabase start -x realtime,storage-api,imgproxy,inbucket

# 2. Run pgTAP unit tests
supabase test db

# 3. Scaffold a new pgTAP test file
supabase test new rpc/my_new_function

# 4. Stop local services when finished
supabase stop
```

---

## Implementation Roadmap

1. **Phase 1: CI Harness Setup & Baseline Benchmarking**
   - Scaffold `supabase/tests/` directory with initial setup.
   - Create GitHub Actions workflow step with `supabase/setup-cli` and `supabase start`.
   - Measure CI duration baseline and evaluate startup overhead.
2. **Phase 2: Core P0 RPC Tests**
   - Write pgTAP tests for `submission_payload_valid()` and `materialize_guest_rides()`.
   - Write pgTAP tests for `handle_new_user()` (asserting NULL fallback behavior).
3. **Phase 3: Recompute RPCs, Pair State Machine & Admin Grant Tests**
   - Write pgTAP tests for `pairwise_wins_custom`, `ranked_participants`, `recompute_idle_fingerprint`.
   - Write pgTAP tests for pair fit steps and dirty triggers (`pair_maintain_step`).
   - Add grant boundary tests for admin RPCs (`admin_user_overview`, `admin_sharing_funnel`).
4. **Phase 4: PostgREST HTTP Integration Tests**
   - Add small Vitest integration suite for PostgREST HTTP boundary checks.

