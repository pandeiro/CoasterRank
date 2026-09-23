# RFC: Automated Testing Strategy for Supabase Migrations & Postgres RPC Logic

**Author:** CoasterRank Engineering  
**Status:** Proposed / Draft  
**Date:** September 22, 2026  

---

## Executive Summary

CoasterRank currently relies on Supabase PostgreSQL for critical core domain logic, security constraints, analytical views, and batch algorithms. Key business logic lives directly in Postgres functions and triggers—including:
- `handle_new_user()` (auth triggers, profile fallback, reserved usernames)
- `submission_payload_valid()` (complex JSON schema & state validation for data moderation)
- `materialize_guest_rides()` (guest list promotion, conflict resolution, atomic merges)
- `pair_fit_agg()`, `pair_fit_step()`, `pair_maintain_step()` (incremental Bradley-Terry pair graph state machine)
- `share_nudge_eligibility()`, `public_rider_page()`, `admin_sharing_funnel()` (security definer RPCs & permissions)
- RLS Policies on `user_rides`, `submissions`, `profiles`, `user_feedback`, etc.

While our TypeScript layer (`app/`, `packages/bt/`, `packages/match/`) has unit testing with Vitest, our database migrations, triggers, security policies (RLS), and Postgres RPC functions have had no automated unit test harness running in CI.

This RFC outlines our strategy for introducing **pgTAP-based unit testing** alongside a targeted **PostgREST HTTP / `supabase-js` verification layer** in GitHub Actions, maintaining speed, isolation, safety from production data, and minimal local dev overhead.

---

## Core Testing Philosophy & Constraints

1. **Local Developer Workflow Unchanged**: Developers do *not* need to keep a local Supabase CLI daemon running continuously (`supabase start`) for standard day-to-day SPA frontend work. However, developers can run `supabase test db` locally when authoring migrations or RPCs.
2. **Zero Production Risk**: Automated tests run in ephemeral CI containers (or isolated local ephemeral containers). No test execution touches remote staging or production databases.
3. **CI Speed & Stability Budget**: Total database test suite execution must add **< 45 seconds** to CI runs. 
4. **Defense in Depth**:
   - **Unit Level (pgTAP)**: In-database SQL assertions for internal tables, helper functions, trigger behavior, state transitions, and edge cases. Fast, transactional rollback per test.
   - **Permission & RLS Level (Basejump helpers)**: Assertions executing as specific role contexts (`authenticated` with mock `auth.uid()`, `anon`, `service_role`).
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
                           (Minimal services, fast boot)
                                           |
                     +---------------------+---------------------+
                     |                                           |
        [1. pgTAP Unit Suite]                      [2. PostgREST Integration]
      supabase test db (pg_prove)                    vitest run supabase/tests/integration
  Executes *.sql under supabase/tests/            Executes TypeScript RPC integration tests
   Rolls back each test transaction                Validates RLS, Grants, PostgREST JSON
```

---

## 1. Unit Testing Harness (pgTAP + Basejump Helpers)

### Directory Structure
All database tests will be located under `supabase/tests/`:

```
supabase/tests/
├── 00000_db_setup.sql             # Installs pgTAP + basejump test helpers (if needed)
├── auth/
│   └── handle_new_user.test.sql   # Tests auth.users trigger, profile creation, reserved usernames
├── rpc/
│   ├── materialize_guest_rides.test.sql
│   ├── submission_payload_valid.test.sql
│   └── share_nudge_eligibility.test.sql
├── pairs/
│   └── pair_fit_state_machine.test.sql # Tests incremental pair maintenance & fitting logic
└── rls/
    ├── user_rides_rls.test.sql    # Role impersonation tests (anon vs authenticated vs owner)
    └── profiles_rls.test.sql
```

### Role Impersonation & RLS Testing
Using standard pgTAP along with Supabase test helpers (e.g. `tests.authenticate_as('user-uuid')` or setting `request.jwt.claims`), we will test RLS rules without stubbing out Supabase Auth:

```sql
BEGIN;
SELECT plan(4);

-- 1. Setup test fixtures
INSERT INTO auth.users (id, email) VALUES ('00000000-0000-0000-0000-000000000001', 'rider1@example.com');
INSERT INTO public.profiles (id, username, display_name) VALUES ('00000000-0000-0000-0000-000000000001', 'rider1', 'Rider One');

-- 2. Test execution as authenticated user
SELECT tests.authenticate_as('00000000-0000-0000-0000-000000000001');

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

We will add a lightweight integration test suite in `app/` or `supabase/tests/integration/` using Vitest + `@supabase/supabase-js` targeting the running local Supabase instance (`http://127.0.0.1:54321`).

### Scope of Integration Tests
- **RPC Grant Violations**: Verify `anon` cannot invoke `pair_fit_step()` or `admin_sharing_funnel()`.
- **PostgREST Type Serialization**: Verify complex JSON inputs to `materialize_guest_rides()` parse cleanly over HTTP.
- **Anon Public API Access**: Verify `public_rider_page()` returns valid payload over PostgREST without credentials.

---

## 3. High-Priority Migration & Coverage Targets

We phase coverage starting with the highest risk/complexity database logic:

| Priority | Component / Function | Testing Objective | Key Risks Checked |
|---|---|---|---|
| **P0** | `materialize_guest_rides()` | Atomic guest list promotion, conflict resolution, timestamp precedence, duplicate rank shifting | Data corruption on guest login/signup |
| **P0** | `submission_payload_valid()` | Payload schema verification (JSONB structure, string lengths, URLs, enum kinds) | Corrupted moderation queue rows |
| **P1** | `handle_new_user()` & Triggers | Profile auto-creation, username collision handling, reserved username enforcement | Failed signups, fallback logic breaking |
| **P1** | Pair State Machine (`pair_fit_step`, `pair_maintain_step`, `pair_mark_dirty_*`) | Triggering dirty flags, incremental pair fitting accumulation, state transition boundaries | Recompute inaccuracies, unmaintained pair state |
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

### Performance Optimization Targets
- `supabase start` with vector/realtime/storage disabled boots in **< 15 seconds** on GitHub Actions runner.
- Schema migrations (`supabase db push` / reset) apply in **< 5 seconds**.
- Total DB job execution time target: **< 40 seconds**.

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

1. **Phase 1: CI Harness Setup**
   - Create GitHub Actions workflow step with `supabase/setup-cli` and `supabase start`.
   - Scaffold `supabase/tests/` directory with `00000_db_setup.sql`.
2. **Phase 2: Core P0 RPC Tests**
   - Write pgTAP tests for `submission_payload_valid()` and `materialize_guest_rides()`.
   - Write pgTAP tests for `handle_new_user()`.
3. **Phase 3: Pair State Machine & RLS Tests**
   - Write pgTAP tests for pair fit steps and dirty triggers (`pair_maintain_step`).
   - Add Basejump / RLS role verification suite.
4. **Phase 4: PostgREST Integration Tests**
   - Add small Vitest integration suite for PostgREST HTTP boundary checks.
