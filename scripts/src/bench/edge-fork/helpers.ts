// Pure helpers for the recompute-rankings Edge Function.
//
// Kept free of Deno / supabase-js imports so the logic is unit-testable
// (helpers_test.ts via `deno test`) and auditable without a live backend:
//   * isRetryableRpcError — which PostgREST failures are worth retrying
//   * backoffDelayMs      — exponential backoff base (caller adds jitter)
//   * shouldSkipRecompute — idle-skip decision from fingerprints
//   * estimatePayloadBytes — coarse payload-size instrumentation

// Structural slice of a PostgREST/supabase-js error; extra fields ignored.
export type RpcErrorLike = {
  code?: unknown
  status?: unknown
  message?: unknown
}

// Retryable = transient gateway/clock-drift failures, never data errors:
//   * PGRST303 — PostgREST clock-drift content-negotiation failure (the
//     original retry case; harmless to repeat)
//   * 504 family — the API gateway killed a slow aggregate (SCALE §3: a bare
//     "Gateway Timeout" at ~7s on an 8k-row workload). Retried with
//     exponential backoff; scale turns this transient into every-run until
//     the query itself gets cheaper, so retries buy time, not a fix.
export function isRetryableRpcError(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as Record<string, unknown>
  if (e.code === 'PGRST303' || e.code === 'PGRST504') return true
  if (e.status === 504 || e.status === '504') return true
  const msg = typeof e.message === 'string' ? e.message : ''
  return /gateway timeout|504|bad gateway|service unavailable/i.test(msg)
}

// Exponential backoff base for retry `attempt` (0-based): 1s, 2s, 4s,
// capped at 8s. The caller adds a small random jitter so the three parallel
// RPCs don't retry in lockstep.
export function backoffDelayMs(attempt: number): number {
  if (attempt < 0) return 1000
  return Math.min(1000 * 2 ** Math.min(attempt, 3), 8000)
}

export type RidesFingerprint = {
  // Newest eligible-ranked-ride change timestamp (ISO), or null when no
  // such rides exist. Compared lexicographically (ISO 8601 UTC).
  ridesMaxTs: string | null
  rankedCount: number
}

// Skip iff the eligible ranked input is unchanged since the fingerprint
// stored on the last success row: same count (catches DELETEs / un-ranks,
// which leave no timestamp) AND no newer change timestamp (catches
// inserts / re-ranks). A missing previous fingerprint (pre-instrumentation
// success rows) never skips — one full run stores it.
export function shouldSkipRecompute(
  current: RidesFingerprint,
  previous: RidesFingerprint | null | undefined,
): boolean {
  if (!previous) return false
  if (current.rankedCount !== previous.rankedCount) return false
  return (current.ridesMaxTs ?? '') <= (previous.ridesMaxTs ?? '')
}

// Coarse payload-size estimate for rpc_stats instrumentation: UTF-16 code
// units of the JSON encoding. Good enough for order-of-magnitude transfer
// trend analysis (SCALE §8); not a byte-exact wire measure.
export function estimatePayloadBytes(data: unknown): number {
  try {
    return JSON.stringify(data ?? [])?.length ?? 0
  } catch {
    return 0
  }
}
