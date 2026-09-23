# RFC: Automated Testing Strategy for Supabase Migrations & Postgres RPC Logic

**Author:** CoasterRank Engineering
**Status:** Proposed / Draft (v3 — spike-resolved; P0 implemented in this PR)
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

Our TypeScript layer (`app/`, `packages/bt/`, `packages/match/`) has extensive Vitest coverage. Those 71 test files mock `supabase.rpc()` — and that is **correct test design, not a deficit**: the mocks encode the client↔server interface contract. This RFC does not propose replacing them.

The investment filter for new database tests is narrower: **silent, non-surfacing, hard-to-recover-from harm** — bugs that produce no error, no failed job, and no alert, and whose damage window is indefinite. That means RLS bypasses and Bradley-Terry state corruption first; loud failures (validation errors, failed RPCs, Sentry-visible errors) last.

This revision resolves the §6 open questions with a locally-executed spike (all claims verified 2026-09-23 unless noted) and implements P0 in this PR: Job A (`.github/workflows/db-tests.yml`), the RLS smoke suite, and the pair delta-deletion characterization suite.

### Why this matters now: the mega-user refactor

We are considering changes to the pair-maintenance machinery to handle very large users without them plugging the `pair_dirty_users` queue (batching, per-user caps, or chunked slice rewrites — design TBD). That refactor will increase the complexity of exactly the delta-maintenance code whose invariants are currently untested. The characterization tests in this PR **prove current behavior first**, so the refactor has invariants to preserve.

---

## Failure-mode calibration: what actually hurt us

Our real production incidents have been behavioral, systemic, and emergent — not "the SQL function has a logic error":

- The **pair-payload truncation bug** (board fitted on ~20% of pair data) was a silent contract between PostgREST's row cap and the Edge Function. A pgTAP test on `pairwise_wins()` would not have caught it.
- The **O(n²) trigger write-amplification trap** was discovered by empirical benchmarking (see `docs/research/benchmarks/2026-09-pairwise/`), not SQL logic testing.
- The **06:30 gateway 504** was a latency/scale failure, not pgTAP-testable.
- The **recompute cron silently skipping via the queue-aware idle-skip interaction** was caught in the shadow soak.
- The **`pairwise_wins_custom` weighting distortion** (5-ride user supplying ~99.5% of edge weight) was caught by simulation and analysis.

pgTAP catches **state-invariant and permission-drift** bugs. It does not catch systemic/emergent bugs — those remain the job of the bench harness, the shadow soak, parity gates, and `cron_execution_logs` observability.

---

## Core Testing Philosophy & Constraints

1. **Local developer workflow unchanged**: no persistent `supabase start` daemon required for SPA work. Database tests run in CI on every PR; locally they run on demand against an ephemeral container.
2. **Zero production risk**: all test execution happens in ephemeral CI/local containers. The DB-test workflow receives NO production credentials (no `SUPABASE_DB_URL`, no service-role key); every connection targets `localhost` only.
3. **Two-layer CI, hot path under ~90s**: the blocking per-PR job is Postgres-only (migration preflight + pgTAP). Anything needing GoTrue/PostgREST/Kong lives in a separate **optional, non-blocking** job until proven fast and stable. Slow blocking CI discourages iterating on migrations — the opposite of this initiative's goal.
4. **Migration preflight is the blocker; pgTAP is incremental**: the `db reset`-equivalent gate blocks merges on migration breakage from day one. Individual pgTAP files land incrementally without holding up unrelated PRs.
5. **Preserve existing test boundaries**: `app/src/lib/validation.test.ts` keeps the `RESERVED_USERNAMES` list-parity check. Postgres tests assert database consequences only.
6. **Defense in depth, in priority order**:
   - **Migration preflight (Phase 0)**: full 65+ migration history applies cleanly.
   - **RLS policy-drift smoke (P0)**: `SET ROLE` + `request.jwt.claim.sub` impersonation proves policies enforce what migration comments claim. Smoke-only is standing policy (§6 Q2).
   - **Silent-corruption invariants (P0/P1)**: pair delta-deletion, guest rank-gapless merge, `handle_new_user()` NULL-username downstream validity.
   - **Recompute/pair math + admin grants (P2/P3)**: already covered by bench parity, shadow soak, and logs; additive pgTAP only.
   - **PostgREST HTTP contracts (deferred)**: only the class pgTAP cannot see (SQL↔JS signature drift through PostgREST casting).

---

## Proposed Architecture

Two jobs — the blocking one has no CLI in the loop at all:

```
  ┌─────────────────────────────────────────────────────────┐
  │  Job A (blocking, every PR): postgres-only              │
  │  ─────────────────────────────────────────────────────  │
  │  services: supabase/postgres:<exact-pin>                │
  │    → platform shim as supabase_admin (test-only)        │
  │    → SIGSEGV probe: clean 42501, no backend crash       │
  │    → apply all migrations as postgres (preflight gate)  │
  │    → pg_prove supabase/tests as postgres                │
  │  No Docker Compose. No GoTrue/PostgREST/Kong. No CLI.   │
  └─────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────┐
  │  Job B (non-blocking, deferred): full stack             │
  │  ─────────────────────────────────────────────────────  │
  │  supabase start → tiny supabase-js signature checks     │
  │  Not a merge gate until fast + stable.                  │
  └─────────────────────────────────────────────────────────┘
```

---

## 1. Unit Testing Harness (pgTAP & Role Impersonation)

### Directory Structure

```
supabase/tests/
├── setup/00_platform_shim.sql           # supabase_admin, once per DB. NEVER via pg_prove, NEVER in migrations
├── rls/
│   └── user_rides_rls.test.sql          # P0 smoke: owner allow, cross-user deny, email gate, anon filter (7 tests)
├── pairs/
│   └── pair_delta_deletion.test.sql     # P0 characterization: profile-delete delta invariant (7 tests)
├── recompute/
│   └── recompute_rpcs.test.sql          # P2 (future)
└── admin/
    └── admin_grants.test.sql            # P2 (future)
```

### The platform shim (why it exists, why it is safe)

The bare image differs from prod in exactly two places our migrations touch (spike-verified):

1. **Stale `auth.users`**: the image bootstraps the ancient GoTrue schema (`confirmed_at`, no `email_confirmed_at`); prod runs current GoTrue. `email_confirmed_at` is the ONLY non-`id` `auth.users` column our migrations reference. The shim adds that one column. A hand-maintained full `auth.users` stub was rejected: it would be a parallel reimplementation drifting on every platform upgrade. One additive column, clearly marked test-only, is the minimal alternative — and the official image (not vanilla Postgres) was chosen precisely so the schema comes from Supabase.
2. **Empty `storage` schema**: tables are created by storage-api at boot, which Job A never starts. Our single storage migration needs `buckets` + `objects` + `foldername()` to exist. Minimal DDL-satisfying definitions only. Drift fails LOUD at migration-apply time, never silently.

Three further image facts shape the harness (all spike-verified):

- **`postgres` is NOT superuser** in this image (despite the name); `supabase_admin` is. Membership in `supabase_*_admin` roles is reserved to superusers, so the shim runs over a second connection as `supabase_admin`. Everything else — migrations and tests — runs as `postgres`, preserving prod's ownership/privilege topology. Localhost TCP is trust auth, so CI needs no passwords.
- **pgTAP 1.3.3 ships available-but-not-enabled** → the shim flips it on with `CREATE EXTENSION`. No custom image build. `db push` never touches `supabase/tests/` (CLI contract: `db push` pushes migrations only; `test db` takes explicit paths — verified against CLI 2.114.0).
- **The image auto-grants anon/authenticated full default privileges** on new public tables (prod no longer auto-exposes, but our migrations carry explicit GRANTs for client-touched tables). Negative-path tests therefore assert RLS enforcement, not missing privileges — the identical policy evaluation prod performs. One live example already in the suite: anon INSERTs into `user_rides` die at the email-gate helper (`user_email_verified()` is revoked from anon) rather than at the policy check — still 42501, still denied, and now pinned as defense-in-depth.

### The SIGSEGV builds (why the pin is exact and the probe runs every time)

Affected `supabase/postgres` builds segfault the backend (signal 11, full crash recovery) when a `postgres`-session role does `SET ROLE authenticated` (or `anon`) and calls a function with EXECUTE revoked — returning no `42501`, killing the whole cluster for ~1s (upstream `supabase/postgres#2377`; still open). That is *exactly* the RLS-smoke/grant-boundary test shape. Consequences encoded in this RFC:

- Job A pins the **exact patch tag** (`supabase/postgres:17.6.1.175`, verified clean 2026-09-23: `ERROR: permission denied for function`, no crash, server stays up), never a floating major, never `setup-cli@latest`-resolved.
- A **probe step runs on every CI invocation** (create function, revoke, call as `authenticated`, expect clean `42501`, then `pg_isready`): passing it is a pass/fail criterion of the job, not a one-time spike note. A green migration-apply plus crashing RLS tests must never read as success.
- The pin is verified against the registry CI actually pulls (Docker Hub); same-nominal-version/different-registry divergences have been reported upstream, so re-verify if the pull source ever changes.

### Role Impersonation & RLS Testing

No new production dependencies (no Basejump in the shipped schema). One correction from the spike worth recording: `auth.uid()` in this stack reads **`request.jwt.claim.sub`** (singular — set per-request by GoTrue in prod). With no GoTrue in Job A, tests set that GUC directly via `set_config(..., true)` alongside `SET LOCAL ROLE`:

```sql
BEGIN;
SELECT plan(7);

INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES ('11111111-1111-1111-1111-111111111111', 'owner@example.com', now(), '{"username":"rls_owner"}');
-- (park + coaster fixtures...)

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);

SELECT lives_ok($$ INSERT INTO public.user_rides ... $$, 'owner can insert their own ride');
SELECT throws_ok($$ INSERT INTO public.user_rides ... (other user) $$,
  '42501', 'new row violates row-level security policy for table "user_rides"',
  'owner cannot insert a ride for another user');

SELECT * FROM finish();
ROLLBACK;
```

Scope: P0 smoke = one positive (owner allowed) + one negative (non-owner denied) per operation. Full escalation matrices stay out until a trigger fires: the mega-user refactor touching an RLS-relevant table, or a new privileged surface (new admin feature, service-role-adjacent integration). Escalation tests are overwhelmingly negative-path permission assertions — the exact SIGSEGV shape — so scope expands only on the pinned, probe-gated image.

---

## 2. Integration / Black-Box Verification Layer — DEFERRED

The `supabase-js` suite against a started stack is **deferred until Job A is green and stable**. When revived as non-blocking Job B, its scope is the one class pgTAP cannot see:

- **SQL↔JS signature drift**: RPC argument names/types through PostgREST casting.
- **PostgREST grant exposure**: anon/authenticated reachability of the public contract surface.

It does not re-test what pgTAP already proves. No `supabase start` cost on the blocking path before this layer earns its keep.

---

## 3. Coverage Targets & Priority Phasing

Ordered by **failure consequence** (silent + indefinite damage first):

| Priority | Component / Function | Testing Objective | Key Risks Checked | State |
|---|---|---|---|---|
| **Phase 0 (gate)** | Migration preflight (Job A) | All 66 migrations apply cleanly in dependency order on the pinned image | Deploy-time `db push` failure, wrong intra-PR order, missing extension | ✅ in this PR |
| **P0** | RLS policy-drift smoke (`user_rides`) | Owner R/W, cross-user deny, email gate, anon filter | Silent RLS bypass; never previously verified | ✅ in this PR (7 tests) |
| **P0 (characterization)** | Pair delta-deletion invariant (`pair_cleanup_on_profile_delete`) — **pre-refactor characterization for mega-user work** | Profile delete subtracts exactly that user's slice; shared pairs keep survivors' exact values; sole pairs vanish; slice + queue + state rows clear | Ghost wins biasing every subsequent fit. Locks behavior BEFORE the refactor | ✅ in this PR (7 tests) |
| **P1** | `materialize_guest_rides()` rank-conflict case | Guest [1,2,3] onto owned [1,2] with overlap → gapless ranks; timestamp precedence | Off-by-one gaps corrupting BT contribution | Future |
| **P1** | `handle_new_user()` NULL-username downstream | Collision/reserved → NULL-username row valid for all downstream queries | Share-nudge loop, broken rider pages | Future |
| **P1** | `submission_payload_valid()` | JSONB structure, lengths, URLs, enum kinds (loud on failure, hence P1) | Corrupted moderation queue rows | Future |
| **P2** | Recompute RPCs (`pairwise_wins_custom`, `ranked_participants`, `recompute_idle_fingerprint`) | Representative aggregation + idle-skip correctness | Unnecessary/missed recomputes (observable; additive) | Future |
| **P2** | Admin RPC grants (`admin_user_overview`, `admin_sharing_funnel`, `coaster_ride_counts`) | Non-privileged callers get permission errors | Privilege escalation (narrow surface) | Future |
| **P3** | Pair state machine (`pair_fit_step`, `pair_maintain_step`, dirty triggers, sweep) | Batch boundaries, idempotent re-queue, sweep self-heal | Most-covered component already (parity + soak + logs); additive only | Future |
| **TBD (pre-registered)** | Refactor-specific invariants (per-user pair caps, chunked slice rewrites) | To be specified by the mega-user design PR; this row reserves the slot now so it cannot be forgotten | Mega-user queue plugging / refactor regressions | Awaits design |
| **Deferred** | PostgREST HTTP contracts (Job B) | SQL↔JS signature drift | Client call-shape mismatch | Awaits Job A stability |

### Characterization discipline (binding on the mega-user refactor)

Characterization tests constrain **outcomes/invariants, never implementation mechanics**: final `pair_totals` state independent of dirty-processing order; applied deltas sum to a from-scratch recompute; no negative or ghost `wins` survive any upsert/delete sequence. Mechanics-asserting tests (call counts, upsert sequences) would need rewriting the moment the refactor changes internals and therefore cannot constrain the new design. The delta-deletion suite in this PR is written to that standard. Sequencing is structural, not remembered: the mega-user design PR must link the landed characterization tests it preserves (required field of that PR), plus fill the TBD row above with its own new invariants.

Explicitly **not** in pgTAP scope: payload-truncation contracts, write-amplification/latency walls, cron-skip interactions, weighting-distortion analysis. Those stay with the bench harness, shadow soak, and logs.

---

## 4. GitHub Actions Integration Strategy

`.github/workflows/db-tests.yml` (blocking, every PR + main): pinned `supabase/postgres:17.6.1.175` service → install `postgresql-client` + `pgtap` (apt, with handler-lib fallback) → shim as `supabase_admin` → SIGSEGV probe → ordered migration apply (`ON_ERROR_STOP=1`; any failure fails the job) → `pg_prove` as `postgres` → timing report. No production secrets in the job environment.

Measured CI timing will be recorded in the PR description on landing (cold image pull dominates; hot path target ~90s for migrate+test proper).

---

## 5. Developer Guide & Tooling Invocations

```bash
# Postgres-only loop (primary; matches CI Job A — exact pin in db-tests.yml)
docker run -d --name crank-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 \
  supabase/postgres:17.6.1.175
psql -h localhost -U supabase_admin -d postgres -f supabase/tests/setup/00_platform_shim.sql
for f in $(ls supabase/migrations/*.sql | sort); do
  psql -h localhost -U postgres -d postgres -v ON_ERROR_STOP=1 -q -f "$f"
done
pg_prove -h localhost -U postgres -D postgres supabase/tests/rls/*.test.sql supabase/tests/pairs/*.test.sql
# (pg_prove via apt `pgtap` package, or `supabase test db --db-url ...` with a started stack)

# Full-stack loop (only for Job B / PostgREST-visible behavior)
supabase start -x realtime,storage-api,imgproxy,inbucket
supabase test db
supabase stop
```

---

## 6. Open Questions — resolved (spike 2026-09-23)

1. **Postgres image spike → RESOLVED: `supabase/postgres:17.6.1.175`, exact pin.** Standalone-runnable confirmed (initdb.d bootstrapping; `docker run` + `psql`, no CLI). Vanilla-plus-stub rejected (parallel-reimplementation drift). Acceptance met: full 66-migration history applies clean; pinned build returns clean `42501` under `SET ROLE` with no backend crash (arm64 local; amd64 proven per CI run); pgTAP 1.3.3 available-but-not-enabled (setup file flips it on); `db push` proven by CLI contract to never touch `supabase/tests/`. Registry: Docker Hub (same source CI pulls); re-verify on any source change.
2. **RLS escalation depth → RESOLVED: smoke-only standing policy**, floor = one positive + one negative per operation via `SET ROLE`; expansion trigger-gated (mega-user refactor touching RLS tables, or new privileged surface), sequenced after the probe-gated image.
3. **Mega-user sequencing → RESOLVED structurally**: outcome/invariant characterization standard (§3); design-PR link requirement; TBD row pre-registered.
4. **pgTAP provisioning → RESOLVED: `CREATE EXTENSION` in `supabase/tests/setup/`, never in migrations**; custom image only if a future pin lacks the extension (check at pin time, not assumed).

---

## Implementation Roadmap

1. **Phase 0 + P0 — DONE in this PR**: Job A skeleton with SIGSEGV probe + migration preflight gate; `supabase/tests/` scaffold; RLS smoke (7 tests); delta-deletion characterization (7 tests). CI timing recorded in the PR description.
2. **Phase 2 (next)**: P1 silent-corruption invariants — guest rank-conflict, `handle_new_user()` NULL-downstream, `submission_payload_valid()`.
3. **Phase 3 (only if Phases 0–2 green and cheap)**: P2/P3 additive coverage — recompute representatives, admin grant boundaries, pair-state batch/sweep.
4. **Phase 4 (deferred)**: non-blocking Job B signature-drift checks.
