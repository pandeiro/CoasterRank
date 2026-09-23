# Decision: Postgres migration & RPC testing in CI — 2026-09-23

## Context

All TypeScript tests mock `supabase.rpc()`, so no CI job exercised the actual SQL boundary: 66 migrations applied in order, trigger behavior, RLS enforcement, or grant boundaries. Past production incidents were systemic (payload truncation, write amplification, gateway latency, cron-skip interaction, weighting distortion) — workloads for the bench harness, shadow soak, and logs — but two silent-harm classes had zero coverage: RLS policy drift and Bradley-Terry state corruption. A staff review of the original RFC proposal further argued migration preflight alone outweighs the whole pgTAP suite, and that pair-fit coverage already exists via bench parity.

A local spike (2026-09-23, `supabase/postgres:17.6.1.175`, full 66-migration apply + 14 pgTAP assertions green) resolved every open technical question before implementation. This record locks the resulting decisions.

## Decisions

1. **Blocking CI is Postgres-only (Job A); no CLI in the loop.** A `services:` container running the pinned image + plain `psql` + `pg_prove` applies all migrations and runs pgTAP in ~53s total (2s for migrate+test proper). Rejected: `supabase start` on the blocking path (45–90s+ cold boot for GoTrue/PostgREST/Kong we don't need) and vanilla-Postgres-plus-hand-stub (a parallel reimplementation of the auth schema drifting on every platform upgrade).
2. **Exact patch pin + per-run crash probe.** Affected `supabase/postgres` builds segfault the backend on `SET ROLE` + revoked-`EXECUTE` instead of raising `42501` (upstream `supabase/postgres#2377`, still open) — exactly the RLS/grant-test shape. So: never a floating tag, never CLI-resolved; pin `supabase/postgres:17.6.1.175` (verified clean on arm64 + amd64); and a probe step on every run must observe a clean `42501` with the server still up, or the job fails. Re-verify on any registry/source change (same-nominal-version divergences reported across registries).
3. **RLS testing is smoke-only as standing policy.** Floor: one positive (owner allowed) + one negative (non-owner denied) per operation via `SET ROLE` + `request.jwt.claim.sub`. No Basejump in the shipped schema; no escalation matrix until a trigger fires: the mega-user refactor touching an RLS-relevant table, or a new privileged surface. Escalation tests are overwhelmingly negative-path assertions — the crash shape — so scope expands only on the probe-gated image.
4. **Characterization before the mega-user refactor, outcome-based by rule.** The pair delta-deletion suite locks current behavior (shared pairs keep survivors' exact values; sole pairs vanish; slice/queue/state clear) asserting outcomes, never mechanics — mechanics-asserting tests couldn't survive the refactor they're meant to constrain. Sequencing is structural: the refactor's design PR must link the landed characterization tests it preserves and fill the pre-registered TBD invariant row (per-user caps, chunked rewrites).
5. **PostgREST integration deferred.** A `supabase-js` layer would re-test what pgTAP already proves; its only unique value is SQL↔JS signature drift. Non-blocking Job B, only after Job A is stable.
6. **Test-only platform shims live in `supabase/tests/setup/`, never in migrations.** The bare image needs exactly two compat items (one `auth.users` column prod's GoTrue has; minimal storage surface for our single storage migration). `db push` provably never touches `supabase/tests/` (CLI contract), and pgTAP ships available-but-not-enabled (1.3.3) so no custom image is maintained.

## Consequences

- `.github/workflows/db-tests.yml` blocks every PR (~53s); `supabase/tests/` grows incrementally without holding up unrelated PRs.
- The job holds zero production credentials (localhost only).
- Image fact recorded for future debuggers: `postgres` is NOT superuser in this image (`supabase_admin` is); localhost TCP is trust auth.
