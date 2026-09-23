# Spec: Retire shadow and legacy fit-mode machinery

**Status:** Proposed  
**Date:** September 23, 2026  
**Context:** `BT_FIT_MODE=indb` has been serving prod since 2026-09-14. The shadow
soak ran clean (10/10 non-skip runs, `board_match=true`, max |Δ log score| 5.5e-8).
The JS fit and parity machinery exist solely to support the soak and the
`legacy` rollback. Both are now dead code paths under normal operation.

---

## Goal

Remove the shadow soak and legacy JS-fit paths in their entirety from the
Edge Function. The result is a simpler, shorter function whose single code
path is the one that runs in prod. No behaviour change on the serving path.
No new secret values or migration needed.

---

## What is safe to touch vs. what must not be touched

### Must NOT be touched — these run in prod today

| Artifact | Role |
|---|---|
| `supabase/functions/recompute-rankings/index.ts` — the `indb` branch | The live serving path |
| `supabase/functions/recompute-rankings/helpers.ts` — `isRetryableRpcError`, `backoffDelayMs`, `shouldSkipRecompute`, `estimatePayloadBytes`, `drainPages`, `isStatementTimeoutMessage` | All used by the `indb` path |
| `supabase/migrations/20260913120000_pair_maintenance_schema.sql` | Schema for `pair_dirty_users`, `user_pairs`, `pair_totals`, `pair_user_state` |
| `supabase/migrations/20260913130000_pair_fit_functions.sql` | `pair_maintain_step`, `pair_fit_agg`, `pair_fit_step`, `pair_fit_rows`, `bt_eligible_users` |
| `supabase/migrations/20260910120000_bt_weighting_exponent.sql` | `pairwise_wins()` and `pairwise_wins_custom()` — both still used (see note below) |
| `supabase/functions/compare-weightings/index.ts` | Admin weighting tool — calls `pairwise_wins()` and `pairwise_wins_custom()` in JS, read-only, never touches `coaster_ratings` |
| `packages/bt/src/mm.ts` | Still imported by `compare-weightings` and its own test suite |
| `app/src/components/admin/RankingsPanel.tsx` | Mostly fine — see targeted UI change below |

**Note on `pairwise_wins()` and `pairwise_wins_custom()`:** these RPCs are
NOT retiring with shadow/legacy. They are independent of the recompute
pipeline — `compare-weightings` calls them on demand for the admin weighting
comparison tool. They stay in the DB and in the codebase unchanged.

---

## Artifacts to remove or simplify

### 1. `helpers.ts` — remove four exports

These are only used by the shadow/legacy paths:

| Export | Used by |
|---|---|
| `FitMode` type (`'shadow' \| 'indb' \| 'legacy'`) | `parseFitMode`, `index.ts` mode branching |
| `DEFAULT_FIT_MODE` (`'shadow'`) | `parseFitMode` |
| `parseFitMode()` | `index.ts` — reads `BT_FIT_MODE` env var |
| `computeParity()` | `index.ts` shadow branch only |
| `parityOk()` | `index.ts` shadow branch only |
| `ParityResult` type | `computeParity` / `parityOk` |
| `PARITY_DELTA_THRESHOLD` | `parityOk` |
| `ScoreRowLike` type | `computeParity` |

The `RPC_PAGE_SIZE`, `PageFetch`, `DrainResult`, `drainPages` block stays —
`drainPages` is used by `rpcPagedWithRetry` which is still called for
`ranked_participants` and `first_place_counts` even in `indb` mode.

### 2. `helpers_test.ts` — remove tests for the removed exports

Tests that exercise only the removed functions:

- `parseFitMode accepts the three modes, defaults unknown to shadow` — gone
- `computeParity measures log-space delta over the common board` — gone
- `computeParity + parityOk accept the measured float-noise floor` — gone
- `computeParity handles empty boards on either side` — gone

The remaining tests (`isRetryableRpcError`, `backoffDelayMs`,
`shouldSkipRecompute`, `estimatePayloadBytes`, `drainPages`,
`isStatementTimeoutMessage`) all survive unchanged.

### 3. `index.ts` — simplify to the `indb` path only

**Remove:**
- The `BT_FIT_MODE` env var read and `parseFitMode` call
- The `fitMode` variable and all `if (fitMode !== 'indb')` / `if (fitMode === 'indb')` / `if (fitMode === 'legacy')` / `if (fitMode !== 'legacy')` branches
- The `FitMode` type import from helpers
- `computeParity`, `parityOk`, `ParityResult`, `ParityStats` imports from helpers
- The `computeRankings` and `Pair` imports from `packages/bt/src/mm.ts` — the JS fit is gone
- The `jsPairs: PairRow[]`, `pairsTiming`, `pairsT`, `rpcPagedWithRetry` call for `pairwise_wins` — the paged `pairwise_wins` drain only runs in `shadow`/`legacy`
- The `parity: ParityResult | undefined` variable and the `computeParity(...)` call
- The `fitError` variable and the try/catch fail-open wrapper around the in-DB pipeline (in `indb` mode there is no fail-open; it already throws directly — just unwrap the try/catch and let errors propagate to the outer handler)
- The `if (fitMode !== 'indb')` block that calls `rpcPagedWithRetry` for `pairwise_wins`
- The `ParityStats` and `parity?` field on the `RpcStats` type in index.ts
- The `FitStats.error?` field (the fail-open shadow case that records `fit.error`)
- The `pairsTiming` conditional path in `rpcStats` assembly

**Keep (now unconditional):**
- The dirty-queue maintain loop (`pair_maintain_step` batches)
- The `pair_fit_agg` → `pair_fit_step` loop → `pair_fit_rows` sequence
- The `ranked_participants` + `first_place_counts` paged drains (still needed for `participants` and `firstPlace` maps used in the upsert)
- The `FitStats` type — minus the `error?` field
- The `rpcStats.fit` assembly block — now always present, always `mode: 'indb'`; the `mode` field can be dropped entirely since it's no longer variable, or kept as a static constant for log readability

**Comment cleanup:**  
The block comments at the top of `index.ts` describing the three modes reduce
to a single paragraph describing the `indb` pipeline. Remove all references to
`BT_FIT_MODE`, `shadow`, `legacy`, `fail open`, and the `parseFitMode`
defaults. Update the rollback documentation: the rollback path is now a code
change + deploy, not a `supabase secrets set` flip.

### 4. `RpcStats` type simplification in `index.ts`

```ts
// Before
type RpcStats = {
  pairwise_wins?: RpcTiming       // shadow/legacy only
  ranked_participants?: RpcTiming
  first_place_counts?: RpcTiming
  rides_max_ts?: string | null
  ranked_count?: number
  skipped?: boolean
  skip_reason?: string
  fit?: FitStats
  parity?: ParityStats            // shadow only
}

// After
type RpcStats = {
  ranked_participants?: RpcTiming
  first_place_counts?: RpcTiming
  rides_max_ts?: string | null
  ranked_count?: number
  skipped?: boolean
  skip_reason?: string
  fit?: FitStats
}
```

Existing `cron_execution_logs` rows in the DB that have `pairwise_wins` or
`parity` keys in their `rpc_stats` JSONB are unaffected — the column is
untyped JSONB; extra keys are just ignored by future reads. No migration
needed, no data loss.

### 5. `app/src/components/admin/RankingsPanel.tsx` — remove parity UI block

The component has a `ParityStats` type, a `parity` variable, and a rendered
block:

```tsx
{parity && (
  <div className={parity.board_match ? 'text-muted' : 'text-danger'}>
    <span className="font-medium text-ink">Shadow parity:</span> max |Δ log score|{' '}
    {formatDelta(parity.max_log_delta)}
    {parity.board_match ? ' (match)' : ' — BOARD MISMATCH'}
    {parity.js_pairs !== undefined && parity.db_pairs !== undefined && (
      <>
        {' '}
        · js {parity.js_pairs} vs db {parity.db_pairs} pairs
      </>
    )}
  </div>
)}
```

Remove:
- The `ParityStats` type definition
- The `parity?` field on `RpcStats` in the component
- `const parity = run?.rpc_stats?.parity`
- The entire `{parity && ...}` JSX block

The `RpcStats` type in RankingsPanel also references `pairwise_wins?`:
```ts
type RpcStats = {
  fit?: FitStats
  parity?: ParityStats                                   // remove
  pairwise_wins?: { ms?: number; bytes?: number; retries?: number }  // remove
}
```
That field is queried nowhere in the component's render; it's only typed for
completeness. Remove both.

The fit-mode display (`fit?.mode`) in the last-run block can be removed or
left as a static string. Since it will always read `'indb'` now, it adds
noise rather than information. Remove it.

### 6. `scripts/src/bench/edge-fork/` — archive, do not delete

`scripts/src/bench/edge-fork/index.ts` is the staging-only fork of the Edge
Function used during the 2026-09-13 benchmark spike. It imports `helpers.ts`
but only uses `backoffDelayMs`, `estimatePayloadBytes`, `isRetryableRpcError`,
`shouldSkipRecompute` — all of which survive. It is not wired into any `npm
run` command and is not deployed anywhere. It will still build cleanly after
the helpers changes since it does not import any of the removed exports.

Leave it in place as a historical artefact. Add a comment to its file header:

```
// NOTE (2026-09): The shadow/legacy modes in the production index.ts have
// been retired. This fork (bench-only, staging-only) is kept for historical
// reference only — see docs/architecture/decisions/2026-09-retire-shadow-legacy-modes.md.
```

### 7. `scripts/src/bench/sql/a-dirty-install.sql` and `a-dirty-restore.sql`

These contain bench-variant installs of `pairwise_wins()` — not the
production body, bench replacements used during the measurement spike. They
live in `scripts/src/bench/sql/` alongside the other bench-only SQL and are
not referenced by any migration or CI path.

No action required. The `pairwise_wins()` production function lives in the
migration stack and is unaffected. These bench files can optionally be given a
note in the `scripts/src/bench/` README flagging them as historical.

---

## What to do with the `BT_FIT_MODE` secret

After the deploy, `BT_FIT_MODE` is an inert dead env var in Supabase's
function secrets. It does no harm sitting there. Optionally clean it up via:

```bash
supabase secrets unset BT_FIT_MODE
```

Not urgent — worth doing to keep the secrets list clean, but not a blocker
for shipping the code change.

---

## `pairwise_wins()` in the migration stack — no action

The production `pairwise_wins()` function (defined in
`20260817170724_bt_recompute_pg_cron.sql`, replaced in
`20260906120000_security_hardening.sql`, then parameterised via
`20260910120000_bt_weighting_exponent.sql`) has two live uses:

1. `compare-weightings` Edge Function — JS-side fit for the admin weighting
   comparison tool (read-only, never serves the board)
2. `pair_maintain_step` uses the same weighting formula inline (not by calling
   `pairwise_wins()`, but the formula comment says "matches `pairwise_wins()`")

There is no reason to drop or rename `pairwise_wins()`. It stays.

---

## Verification checklist before merging

1. `deno test supabase/functions/recompute-rankings/helpers_test.ts` passes
   with the removed tests gone and no remaining test importing a removed symbol.
2. `deno check supabase/functions/recompute-rankings/index.ts` (or equivalent
   type-check) passes — no dangling imports.
3. `scripts/src/bench/edge-fork/index.ts` still type-checks (it imports only
   surviving helpers symbols).
4. `npm run gates` (app quality gates) passes — the RankingsPanel change is
   purely a type + JSX removal; its test file (`RankingsPanel.test.tsx`) should
   need no changes unless it specifically tests the parity block.
5. Manual smoke: trigger a recompute from the admin panel and verify the
   last-run block renders correctly without the parity row.
6. Check `cron_execution_logs` after the first post-deploy cron slot — confirm
   `rpc_stats` no longer contains `parity` or `pairwise_wins` keys; confirm
   `fit.mode` is absent (or `'indb'` if kept as a static).

---

## What this does NOT do

- Does not touch `pairwise_wins()` or `pairwise_wins_custom()` in the DB
- Does not touch `compare-weightings` Edge Function (still uses the JS fit for its read-only comparison work)
- Does not touch `packages/bt/src/mm.ts` (still used by `compare-weightings` and its own tests)
- Does not touch any migration files
- Does not touch any part of the `indb` serving path

---

## Rollback story post-retirement

The old `supabase secrets set BT_FIT_MODE=legacy` flip is gone. The new
rollback for a catastrophic in-DB pipeline failure is: revert the commit,
redeploy. The pipeline is stable and the monitoring (Telegram alerts,
`cron_execution_logs`, dirty-queue depth, admin panel) provides early warning
before any failure reaches "need to rollback" severity.
