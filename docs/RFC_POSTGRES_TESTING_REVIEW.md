# Review: RFC — Automated Testing Strategy for Supabase Migrations & Postgres RPC Logic

**Reviewer:** Staff Engineering Review  
**Date:** September 23, 2026  
**RFC Status at Review:** Proposed / Draft  

---

This is a devil's advocate review. The RFC is well-scoped and technically sound in its mechanics. My concerns are not about whether pgTAP works — it does — but about whether this initiative is solving the right problems in the right order, and whether the proposed investment will actually improve safety and development velocity at this project's scale and stage.

---

## 1. Start with "why do we test?" — then question the answers

The RFC opens with a list of what lives in Postgres (correct) and why the current test layer doesn't cover it (also correct). But it skips the prior question: **what are the actual failure modes that have hurt us, and would these tests have caught them?**

Let me answer that from the project record:

- The **pair-payload truncation bug** (board fitted on 20% of pair data for an unknown window) was not a logic error in an RPC — it was a silent behavioral contract between PostgREST's row cap and the Edge Function that nobody thought to assert. A pgTAP test on `pairwise_wins()` would not have caught it.
- The **O(n²) trigger write-amplification trap** (the measured lower bound that the incremental ranking spec explicitly rejects) was discovered by empirical benchmarking, not SQL logic testing.
- The **06:30 gateway 504** was a latency/scale failure. Not testable with pgTAP.
- The **recompute cron sometimes silently skipping due to the queue-aware idle-skip fix interaction** was caught in the shadow soak, not by any unit test.
- The **`pairwise_wins_custom` weighting distortion** (5-ride user supplying 99.5% of edge weight) was caught by simulation and manual analysis, not by testing whether the SQL is syntactically correct.

The pattern is: **our real production bugs have been behavioral, systemic, and emergent — not "the SQL function has a logic error."** The RFC's proposed investment is well-suited to catching a class of bugs (RLS bypass, trigger misfires, constraint violations) that we have not actually been bitten by. That's not worthless — prevention is legitimate — but it should make us calibrate the investment carefully.

The one genuine miss in the current test story that pgTAP *would* address: **RLS policy drift**. We have never tested that the policies actually do what the migration comments claim. That is a real gap. But it's one specific gap, not the broad justification the RFC implies.

---

## 2. The migration preflight is the highest-value item — and it's buried

Buried in point 4 of the Core Constraints is this sentence:

> every CI run will execute `supabase db reset` (applying the complete migration history). This catches syntax errors, missing extensions, out-of-order timestamps, or broken schema dependencies.

**This is the most valuable thing in the RFC.** Every other test in the document is optional compared to this.

Why? Because our migration stack is the most dangerous single point of failure. We have 65+ migrations. `supabase db push` on merge is irreversible. A broken migration that passes the migration-order check (timestamp only) can still fail at deploy time because:

- It references a function or type defined in a later migration (wrong dependency order within the new PR)
- It uses a PG extension not enabled in `supabase/config.toml`
- It has a subtle syntax error that pgparser accepts but Postgres rejects
- It `CREATE OR REPLACE`s a function with a different signature than a dependent view or trigger expects

Currently, CI only checks migration *ordering*. It does not verify that the full stack actually *applies cleanly*. The `supabase db reset` step in a CI container gives us that. And it's cheap relative to the full pgTAP suite — it just needs `supabase start` once.

**Recommendation:** Promote migration preflight as Phase 1 and gate it as a CI blocker immediately, independently of whether any pgTAP tests are ever written. The value is immediate and universal. Every PR that touches a migration benefits.

---

## 3. The pgTAP investment is inverted — you're testing the expensive things first

The P0/P1/P2 priority table proposes starting with:

- `materialize_guest_rides()` — complex, but guest promotion failures are immediately visible and recoverable (the user retries or we fix and replay)
- `submission_payload_valid()` — important, but failures surface as user-visible validation errors, not silent data corruption
- The pair state machine RPCs — algorithmically interesting, but already parity-checked against `packages/bt/src/mm.ts` at the bench level

What's actually P0 from a failure-consequence standpoint:

**The RLS policies.** An RLS bypass doesn't surface until a user notices they can read someone else's rides, or until a security researcher reports it. It doesn't generate an error, a failed job, or a Telegram alert. The damage window is indefinite. We have never verified that `SET ROLE authenticated` + `set_config('request.jwt.claims', ...)` actually enforces what we think it enforces for `user_rides`, `submissions`, and `profiles`. The RFC has this as P2 ("RLS Policies"). It should be P0.

The pair state machine is not P1. It has:
- The in-DB parity gate against `packages/bt/src/mm.ts` (already enforced)
- The shadow soak (verified before every flip)
- The bench harness that can replay against real data
- Observable dirty-queue depth and parity delta in `cron_execution_logs` on every prod run

Adding pgTAP tests on `pair_fit_step` is additive coverage on the most-already-covered component in the system.

---

## 4. The CI time budget is likely too optimistic for this team's workflow

The RFC targets under 60–90 seconds total for the DB job. That's the right instinct. But consider the actual cost model:

- `supabase start` in CI cold-starts Docker images for Postgres, GoTrue, PostgREST, and Kong. Even with the `-x realtime,storage-api,imgproxy,inbucket` flag, this is typically 45–90 seconds on GitHub-hosted runners in practice, not including image pull time on a cold runner.
- On top of that: `supabase db reset` (applies 65+ migrations), pgTAP test run, optional integration suite.

If the DB job ends up at 3+ minutes, it will be perceived as slow relative to the existing ~45-second `ci/check` job. Slow CI is not just an inconvenience — on a project where PRs are merged by one person with a clear "run gates before commit" culture, slow CI specifically discourages iterating on migrations. That is the opposite of the goal.

The RFC proposes benchmarking first (Phase 1) and punting to a "pure Postgres service container fallback." That's the right hedge, but the pure-Postgres path is actually not a fallback — it may be the *right* primary path for migration preflight and RLS tests that don't need PostgREST. pgTAP runs fine against a plain Postgres container via a GitHub service. PostgREST is only needed for the integration layer (§2), which is explicitly the lowest-priority and most optional part of the suite.

**Recommendation:** Design the CI job in two layers from the start:
1. A fast Postgres-only service container job (migration preflight + pgTAP) — no Docker Compose, no `supabase start`, no GoTrue. This is runnable in under 60 seconds.
2. An optional, non-blocking full-stack integration job (needs `supabase start`) — runs on demand or weekly, not on every PR. Its failure should not block merges until the suite has matured.

Running `supabase start` on every PR for the integration layer before the test suite covers anything meaningful is paying the full cost for minimal initial return.

---

## 5. The integration test layer has a hidden assumption about local development

The RFC states:

> Developers do *not* need to keep a local Supabase CLI daemon running continuously for standard day-to-day SPA frontend work.

This is true. But the RFC then proposes `supabase-js` integration tests that target `http://127.0.0.1:54321`. For those tests to be useful to a developer locally, they *do* need `supabase start`. The RFC presents `supabase start` as a one-time background daemon, but the developer workflow section treats it as something you spin up and tear down per-session. This friction is real.

More importantly: the integration tests targeting PostgREST are re-testing things that the RLS pgTAP tests already cover (grant boundaries, anon vs. authenticated role enforcement), just via HTTP. For this codebase — where the SPA calls PostgREST directly and there is no custom backend — the PostgREST integration layer is genuinely valuable for one specific class of bugs: RPC signature mismatch between the SQL definition and the JS client call. But that class is already partially covered by TypeScript types generated from the schema, and by the existing Vitest mocks that at least document the expected call shape.

The integration layer should be deferred until the pgTAP layer is stable and actually running in CI. Don't pay the `supabase start` overhead in CI before the core pgTAP suite is earning its keep.

---

## 6. What the RFC doesn't mention: the places coverage matters most right now

Given where the project actually is — live, growing, heading toward the incremental pair maintenance epic — the three highest-leverage coverage gaps not mentioned in the RFC are:

**A. The `pair_dirty_users` → `pair_totals` delta correctness under concurrent deletes.**

The profile-deletion trigger (`pair_cleanup_on_profile_delete`) subtracts a user's exact slice from `pair_totals` using signed negative deltas and deletes rows where `wins <= 0`. The correctness of "wins <= 0 is safe to delete" depends on the assumption that pair weights are always positive and that integer residue from floats never produces a false zero. This has never been tested. The failure mode is silent: ghost wins that persist indefinitely, biasing every subsequent fit. This is exactly the class of bug pgTAP is best at catching — an invariant in a stateful mutation pipeline.

**B. The `materialize_guest_rides()` rank-conflict resolution.**

The RFC correctly lists this as P0 but describes it generically ("conflict resolution, timestamp precedence, duplicate rank shifting"). The actual failure mode is subtle: a guest list with ranks [1, 2, 3] being merged onto an authenticated list that already has ranks [1, 2] where two of the three coasters overlap. The merge must produce a gapless positive-integer rank sequence. An off-by-one produces rank gaps that silently corrupt the user's BT contribution on the next recompute. This is worth testing with explicit fixture tables before the guest promotion flow is the main acquisition funnel.

**C. The `handle_new_user()` trigger race on username collision.**

The RFC mentions this. The failure mode (fallback to NULL username) is documented and intentional. But the consequence — a user whose `username IS NULL` can't share their list, gets excluded from certain RPCs, and may see the share nudge banner loop indefinitely — touches multiple systems. A test that verifies the NULL path produces a valid `profiles` row that doesn't break downstream queries is worth more than a test that just asserts "NULL on collision."

---

## 7. The framing of "71 mocked tests" as a problem to solve may be misleading

The RFC opens by noting that 71 Vitest test files mock `supabase.rpc()` and therefore don't test actual SQL execution. This is accurate, but framing it as a coverage gap risks implying that those tests need to be replaced or supplemented at scale, which would be expensive and mostly wrong.

Those tests are testing the right things: client-side behavior, error handling, optimistic update logic, UI state under various response shapes. The fact that they mock the Supabase client is not a deficit — it's correct test design. The mock is the interface contract, and testing against the contract is how you keep client and server decoupled.

The question is not "should we test the SQL that those mocks assume is behind them?" The question is: **for which specific pieces of SQL logic does a bug cause silent, non-surfacing, hard-to-recover-from harm?** That is the correct filter for where to invest pgTAP coverage. Most of the SQL behind those mocked calls (filter queries, board reads, coaster detail) fails loudly — the user sees an error, the Supabase error object is populated, Sentry fires. RLS bypasses and BT corruption do not fail loudly. Focus there.

---

## Summary: What to change

1. **Promote migration preflight (`supabase db reset` in CI) as Phase 0** — highest value, lowest marginal cost once you have a Postgres container. Gate it as a blocker on every PR touching `supabase/migrations/`. Do this before any pgTAP tests exist.

2. **Use a plain Postgres service container for Phase 1**, not `supabase start`. It's faster, simpler, and sufficient for pgTAP + migration preflight. Reserve `supabase start` for when you actually need PostgREST/GoTrue (integration tests, Phase 4).

3. **Reorder priorities:** RLS policies are P0 (silent failure, indefinite damage window). Pair state machine is P3 (already has the most coverage in the system). `materialize_guest_rides` and `handle_new_user` remain P1 for the specific scenarios outlined above.

4. **Add the profile-deletion pair delta test** as P0 alongside RLS — it's the same class (silent corruption, no error surface).

5. **Defer the PostgREST integration layer** (supabase-js §2) to after the pgTAP suite is running and stable in CI. It's the most expensive and least immediately valuable piece of the proposal.

6. **Don't let the CI job get above ~90 seconds on the hot path.** Once it does, people stop iterating on migrations locally and start YOLO-merging hoping CI catches it. That's the failure mode this initiative is supposed to prevent.

The bones of this RFC are right. The tooling choices are appropriate. The sequencing and priority ordering need adjustment to maximize the return on the first few weeks of implementation effort — because if Phase 1 is slow or the first tests are hard to write, the initiative will stall before it pays off. Optimize for getting *something* valuable into CI fast, then expand from that working baseline.
