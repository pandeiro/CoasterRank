// Pure helpers for the recompute-rankings Edge Function.
//
// Kept free of Deno / supabase-js imports so the logic is unit-testable
// (helpers_test.ts via `deno test`) and auditable without a live backend:
//   * isRetryableRpcError — which PostgREST failures are worth retrying
//   * backoffDelayMs      — exponential backoff base (caller adds jitter)
//   * shouldSkipRecompute — idle-skip decision from fingerprints
//   * estimatePayloadBytes — coarse payload-size instrumentation
//   * isStatementTimeoutMessage — detects 57014 statement-timeout errors
//   * drainPages          — page-by-page RPC drain (SCALE §9)

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
// inserts / re-ranks) AND the dirty queue is empty. The queue check matters
// because state changes that DON'T touch user_rides — the migration's
// backfill seed, sweep re-marks (eligibility flips, missed-flag races) —
// leave the fingerprint untouched; skipping on fingerprint alone would
// starve the backfill and strand sweep re-marks. A failed/unknown queue
// read (null/undefined) never skips — fail-open to a full run.
export function shouldSkipRecompute(
  current: RidesFingerprint,
  previous: RidesFingerprint | null | undefined,
  queueDepth: number | null | undefined,
): boolean {
  if (!previous) return false
  if (current.rankedCount !== previous.rankedCount) return false
  if ((current.ridesMaxTs ?? '') > (previous.ridesMaxTs ?? '')) return false
  return queueDepth === 0
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

// PostgREST caps every response at the platform max-rows (10,000 on prod).
// A capped aggregate RPC logs as success — the only symptom is a silently
// wrong board fitted on a truncated prefix of its pairs (found 2026-09-13:
// prod shipped 10k of ~50k pair rows; SCALE §9). Draining every aggregate
// page-by-page until a SHORT page proves exhaustion makes truncation
// structurally impossible. Page size matches the platform cap, so a full
// page costs the same as today's single capped request.
export const RPC_PAGE_SIZE = 10_000

export type PageFetch<T> = (
  start: number,
  end: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>

export type DrainResult<T> = {
  data: T[]
  error: { message: string } | null
  pages: number
}

// Fetches range-batched pages until one comes back short. Pure: the caller
// supplies the page fetcher (with its own retry semantics), so tests can
// inject page boundaries and errors without a live PostgREST.
export async function drainPages<T>(
  fetchPage: PageFetch<T>,
  pageSize: number = RPC_PAGE_SIZE,
): Promise<DrainResult<T>> {
  const all: T[] = []
  let pages = 0
  for (let start = 0; ; start += pageSize) {
    const res = await fetchPage(start, start + pageSize - 1)
    if (res.error) return { data: [], error: res.error, pages }
    pages++
    const rows = res.data ?? []
    all.push(...rows)
    if (rows.length < pageSize) return { data: all, error: null, pages }
  }
}

// Postgres statement timeouts (the ~8s platform per-statement default;
// individual functions may raise it via a function-level SET) surface
// through PostgREST as 57014 "canceling statement due to statement timeout".
// NOT retried by isRetryableRpcError — they mean the statement is too big;
// the pipeline responds by halving its batch size instead of retrying blind.
export function isStatementTimeoutMessage(message: string): boolean {
  return /canceling statement due to statement timeout|statement timeout/i.test(message)
}
