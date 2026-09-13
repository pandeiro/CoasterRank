// Pure helpers for the recompute-rankings Edge Function.
//
// Kept free of Deno / supabase-js imports so the logic is unit-testable
// (helpers_test.ts via `deno test`) and auditable without a live backend:
//   * isRetryableRpcError — which PostgREST failures are worth retrying
//   * backoffDelayMs      — exponential backoff base (caller adds jitter)
//   * shouldSkipRecompute — idle-skip decision from fingerprints
//   * estimatePayloadBytes — coarse payload-size instrumentation
//   * parseFitMode / isStatementTimeoutMessage / computeParity — the
//     in-DB fit pipeline (PROMOTION §4-§5)

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

// ── In-DB fit pipeline (PROMOTION §4-§5) ────────────────────────────────

// Which pipeline serves the board, via the BT_FIT_MODE function secret:
//   legacy — today's shape: paged pairwise_wins over the gateway + JS MM fit.
//   shadow — the in-DB fit (maintain batches + pair_totals + pair_fit_step)
//            runs alongside, parity is logged per run, but the JS fit still
//            SERVES the board. Default: the flip decision reads the soak.
//   indb   — the in-DB fit serves; pair rows never cross the gateway
//            (payload collapses to board-size; the memory wall disappears).
export type FitMode = 'shadow' | 'indb' | 'legacy'

export const DEFAULT_FIT_MODE: FitMode = 'shadow'

// Unknown/unset values fall back to shadow: the served board never changes
// by accident, and the misconfiguration shows up in rpc_stats.fit.mode.
export function parseFitMode(value: string | null | undefined): FitMode {
  const v = (value ?? '').trim().toLowerCase()
  if (v === 'shadow' || v === 'indb' || v === 'legacy') return v
  return DEFAULT_FIT_MODE
}

// Postgres statement timeouts (the ~8s platform per-statement limit) surface
// through PostgREST as 57014 "canceling statement due to statement timeout".
// NOT retried by isRetryableRpcError — they mean the statement is too big;
// the pipeline responds by halving its batch size instead of retrying blind.
export function isStatementTimeoutMessage(message: string): boolean {
  return /canceling statement due to statement timeout|statement timeout/i.test(message)
}

// Parity check between the served (JS) fit and the in-DB fit: max |Δ log
// score| over coaster ids present in BOTH boards (log-space so a 1.03 vs
// 1.04 wobble weighs the same as a 500 vs 503 move), plus board-membership
// mismatches — which would mean the maintained pair totals diverged from the
// live aggregation (a maintenance bug signature, not a fit bug).
export type ScoreRowLike = { id: string; score: number }

export type ParityResult = {
  maxLogDelta: number
  common: number
  jsOnly: number
  dbOnly: number
}

// Board disagreement is never acceptable; score deltas below this are float
// noise from the two fixed-point solvers (the measured bench parity was
// 5.6e-9 — three orders below).
export const PARITY_DELTA_THRESHOLD = 1e-6

export function computeParity(jsRows: ScoreRowLike[], dbRows: ScoreRowLike[]): ParityResult {
  const js = new Map(jsRows.map((r) => [r.id, r.score]))
  const db = new Map(dbRows.map((r) => [r.id, r.score]))
  let maxLogDelta = 0
  let common = 0
  for (const [id, jsScore] of js) {
    const dbScore = db.get(id)
    if (dbScore === undefined) continue
    common++
    const delta = Math.abs(Math.log(jsScore) - Math.log(dbScore))
    if (delta > maxLogDelta) maxLogDelta = delta
  }
  return {
    maxLogDelta,
    common,
    jsOnly: jsRows.length - common,
    dbOnly: dbRows.length - common,
  }
}

export function parityOk(parity: ParityResult): boolean {
  return parity.jsOnly === 0 && parity.dbOnly === 0 && parity.maxLogDelta < PARITY_DELTA_THRESHOLD
}
