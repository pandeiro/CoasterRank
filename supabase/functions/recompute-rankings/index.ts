// Bradley-Terry batch recompute (PLAN §5). Fits strengths from all ranked
// user_rides and upserts them into coaster_ratings; the board's
// v_coaster_rankings view reads the results live.
//
// Fit pipeline: the in-DB pipeline (PROMOTION spec:
// docs/architecture/decisions/2026-09-incremental-ranking.md) runs entirely
// inside Postgres. pair_maintain_step batches maintain pair_totals from the
// dirty-user queue; pair_fit_agg + pair_fit_step MM-fit in-DB; pair_fit_rows
// returns a board-size payload. Pair rows never cross the gateway.
//
// Idle-skip gate: pg_cron runs skip only when BOTH the rides fingerprint is
// unchanged AND the dirty queue is empty — the backfill seed and sweep
// re-marks change neither fingerprint nor user_rides (PR #213 review).
//
// Authentication — exactly one of:
//   1. Bearer <RECOMPUTE_AUTH_SECRET>     — the pg_cron job (secret kept in
//      Supabase Vault on the DB side; see the pg_cron migration + AGENTS.md)
//   2. Bearer <SUPABASE_SERVICE_ROLE_KEY> — ops debugging via curl
//   3. Bearer <user JWT of an admin>      — the SPA's "Recompute now" button
//      (supabase.functions.invoke). The JWT is validated against GoTrue, then
//      profiles.is_admin is checked server-side. No secret ever ships to the
//      browser.
//
// Response: 200 { updated, durationMs, iterations, converged } (PLAN §5.5,
// with `converged` added as a backward-compatible diagnostic).
//
// Observability: every execution is logged to cron_execution_logs
// (rpc_stats carries per-RPC ms/bytes, the dirty-queue counters, and the
// in-DB fit timings). On failure: Telegram alert via CoasterRankAlerts bot.
// On #1 change: Telegram event via CoasterRankEvents bot. Dispatch control:
// messages are prefixed with the APP_ENV function secret ('prod' when unset).
// On non-prod clones/staging, simply do NOT set the Telegram token secrets —
// the sends below no-op silently when they're absent, so a staging function
// can never ping the prod channels.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3'
// Pure retry/skip/instrumentation helpers (unit-tested in helpers_test.ts).
import {
  backoffDelayMs,
  drainPages,
  estimatePayloadBytes,
  isRetryableRpcError,
  isStatementTimeoutMessage,
  shouldSkipRecompute,
  type RidesFingerprint,
} from './helpers.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

type ParticipantRow = { coaster_id: string; participants: number }
type FirstPlaceRow = { coaster_id: string; first_place_votes: number }
type FingerprintRow = { rides_max_ts: string | null; ranked_count: number | string }
type LastSuccessRow = { created_at: string; rpc_stats: RpcStats | null }
// One row per fitted coaster from pair_fit_rows(); iterations and converged
// repeat on every row (fit-level diagnostics).
type FittedRow = {
  coaster_id: string
  score: number
  comparisons: number
  wins: number
  iterations: number
  converged: boolean
}
// pair_maintain_step's single-row result (remaining is bigint → may arrive
// as a string through PostgREST's JSON serialization of int8).
type MaintainRow = { processed: number; remaining: number | string; oldest_marked_at: string | null }
// pair_fit_agg's single-row result (counts are bigint → possibly strings).
type AggRow = { pairs: number | string; contributors: number | string }
type RecomputeResult = {
  updated: number
  durationMs: number
  iterations: number
  converged: boolean
  skipped?: boolean
}

// Per-RPC coarse instrumentation, stored as cron_execution_logs.rpc_stats:
// wall-clock ms around each aggregate call + payload size (JSON length) +
// retries consumed. Shared shape for success, error (partial), and skip rows
// (which carry the idle fingerprint instead of timings). The fit/dirty block
// is present on every full run since the in-DB pipeline shipped.
type RpcTiming = { ms: number; bytes: number; retries: number }
type FitStats = {
  maintain_ms: number
  maintain_calls: number
  maintain_batch_final: number
  /** True when the maintain loop stopped on MAINTAIN_MS_BUDGET with users still queued (partial drain, not an error). */
  maintain_budget_hit: boolean
  agg_ms: number
  step_ms: number
  step_calls: number
  step_p_max_final: number
  rows_ms: number
  db_pairs: number
  db_contributors: number
  db_iterations: number
  db_converged: boolean
  dirty_processed: number
  dirty_remaining: number
  dirty_oldest: string | null
}
type RpcStats = {
  ranked_participants?: RpcTiming
  first_place_counts?: RpcTiming
  rides_max_ts?: string | null
  ranked_count?: number
  skipped?: boolean
  skip_reason?: string
  fit?: FitStats
}

const UPSERT_CHUNK = 500
const DELETE_CHUNK = 100
// 504s need the server to recover, so back off exponentially (1s/2s/4s,
// helpers.backoffDelayMs) rather than the old fixed 300ms. Three retries cap
// the added latency at ~7s + jitter, inside the function budget.
const RPC_MAX_RETRIES = 3
const RPC_RETRY_JITTER_MS = 250

// Dirty-queue budget (PROMOTION §3): bounded batches across separate RPCs —
// one call outgrew the platform statement timeout at ~200 dirty users, so
// each call claims MAINTAIN_BATCH users (adaptive-halved on statement
// timeouts) and the loop repeats until the queue drains. 40 calls × 25 users
// = 1000 users per run; a queue deeper than that drains across cron slots
// (the watchdog alert threshold is aligned).
//
// Per-call statements run under pair_maintain_step's function-level
// statement_timeout (60s — migration 20260922191500; a single 516-ride user
// needs ~21s for first-time ingestion of ~133k pairs, measured 2026-09-22).
// MAINTAIN_MS_BUDGET caps the loop's total RPC time, checked between calls:
// a future user larger than the statement budget degrades to a partial drain
// (remaining users process next slots, by design — recorded as
// maintain_budget_hit, not an error) instead of eating the invocation.
const MAINTAIN_BATCH = 25
const MAX_MAINTAIN_CALLS = 40
const MAINTAIN_MS_BUDGET = 60000
// MM iterations per fit_step call: adaptive-halved on statement timeouts.
// 200 calls covers a cold board rebuild (80-160 iterations measured) with
// headroom for halving. Per-call statements run under pair_fit_step's
// function-level statement_timeout (60s — migration 20260924024100; a single
// call needs ~8s at ~173k pairs, measured 2026-09-24). FIT_MS_BUDGET caps the
// loop's total RPC time, checked between calls: with 60s statements the
// halving ladder (25→…→1) could otherwise burn ~6 minutes before failing —
// the budget converts that into one clean throw + Telegram instead of eating
// the invocation (~3x the worst observed 42s fit).
const MAX_STEP_CALLS = 200
const FIT_MS_BUDGET = 120000

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t0 = performance.now()
  const value = await fn()
  return { value, ms: Math.round(performance.now() - t0) }
}

// ISO week (UTC Monday) containing `d` — the weekly rank-movement baseline
// key. Must match the view's
// `(date_trunc('week', now() at time zone 'utc'))::date` boundary in the
// rankings-view-weekly-delta migration (ISO weeks start Monday; UTC-pinned so
// the session TimeZone can't skew the boundary).
function weekStartUtc(d = new Date()): string {
  const day = d.getUTCDay()
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((day + 6) % 7)),
  )
  return monday.toISOString().slice(0, 10)
}

function fingerprintOf(row: FingerprintRow | null): RidesFingerprint {
  return {
    ridesMaxTs: row?.rides_max_ts ?? null,
    rankedCount: Number(row?.ranked_count ?? 0),
  }
}

function fingerprintFromStats(stats: RpcStats | null | undefined): RidesFingerprint | null {
  if (!stats || stats.ranked_count === undefined) return null
  return { ridesMaxTs: stats.rides_max_ts ?? null, rankedCount: stats.ranked_count }
}

type RpcResult<T> = {
  data: T[] | null
  error: { message: string } | null
  retriesUsed: number
}

async function rpcWithRetry<T>(
  supabase: ReturnType<typeof createClient>,
  name: string,
  args?: Record<string, unknown>,
): Promise<RpcResult<T>> {
  let lastError: { message: string } | null = null
  let retriesUsed = 0
  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt++) {
    const res = await supabase.rpc(name, args as never)
    if (!res.error || !isRetryableRpcError(res.error)) return { ...res, retriesUsed }
    lastError = res.error
    if (attempt < RPC_MAX_RETRIES) {
      retriesUsed++
      await sleep(backoffDelayMs(attempt) + Math.floor(Math.random() * RPC_RETRY_JITTER_MS))
    }
  }
  return {
    data: null,
    error: { message: `${lastError!.message} (after ${retriesUsed + 1} attempts)` },
    retriesUsed,
  }
}

// Aggregate RPCs are drained page-by-page (helpers.drainPages): PostgREST
// caps responses at the platform max-rows, and a silently capped pair set
// means the board gets fitted on a truncated prefix (SCALE §9). Each page
// retries independently with the same backoff semantics as rpcWithRetry.
async function rpcPagedWithRetry<T>(
  supabase: ReturnType<typeof createClient>,
  name: string,
): Promise<RpcResult<T>> {
  let retriesUsed = 0
  const drained = await drainPages((start, end) => {
    let lastError: { message: string } | null = null
    let attemptsUsed = 0
    const attempt = async (): Promise<{ data: T[] | null; error: { message: string } | null }> => {
      for (let i = 0; i <= RPC_MAX_RETRIES; i++) {
        const res = await supabase.rpc(name).range(start, end)
        if (!res.error || !isRetryableRpcError(res.error)) return res
        lastError = res.error
        if (i < RPC_MAX_RETRIES) {
          attemptsUsed++
          await sleep(backoffDelayMs(i) + Math.floor(Math.random() * RPC_RETRY_JITTER_MS))
        }
      }
      return { data: null, error: { message: `${lastError!.message} (after ${attemptsUsed + 1} attempts)` } }
    }
    return attempt().then((res) => {
      retriesUsed += attemptsUsed
      return res
    })
  })
  return { data: drained.error ? null : drained.data, error: drained.error, retriesUsed }
}

// The crown snapshot (read-only) can transiently fail the same way the pairs
// RPCs do ("Gateway Timeout"), so retry it before giving up. A surviving error
// must fail the run rather than be swallowed: a null snapshot would read as
// "no previous #1" and fire a phantom New #1 event after the upserts. Ties are
// broken score desc, id asc — the rankings view's exact rule — so two coasters
// with equal scores resolve to the same row every run instead of flip-flopping
// the detected crown.
type TopRow = { coaster_id: string }

// Structural slice of the read chain below; typing the param as
// ReturnType<typeof createClient> (like rpcWithRetry) trips local `deno check`
// on the esm.sh-resolved generic defaults.
type TopSnapshotClient = {
  from: (table: string) => {
    select: (columns: string) => {
      order: (column: string, options: { ascending: boolean }) => {
        order: (column: string, options: { ascending: boolean }) => {
          limit: (count: number) => {
            maybeSingle: () => PromiseLike<{
              data: TopRow | null
              error: { message: string } | null
            }>
          }
        }
      }
    }
  }
}

async function crownSnapshotWithRetry(
  supabase: TopSnapshotClient,
): Promise<{ top: TopRow | null; error: string | null }> {
  let lastError = ''
  for (let attempt = 0; attempt <= RPC_MAX_RETRIES; attempt++) {
    const { data, error } = await supabase
      .from('coaster_ratings')
      .select('coaster_id')
      .order('score', { ascending: false })
      .order('coaster_id', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!error) return { top: (data ?? null) as TopRow | null, error: null }
    lastError = error.message
    if (attempt < RPC_MAX_RETRIES) {
      await sleep(backoffDelayMs(attempt) + Math.floor(Math.random() * RPC_RETRY_JITTER_MS))
    }
  }
  return { top: null, error: `${lastError} (after ${RPC_MAX_RETRIES + 1} attempts)` }
}

// ── Telegram helpers ────────────────────────────────────────────────────
// APP_ENV prefixes every outbound message so the source project is always
// identifiable ('prod' when unset).
const APP_ENV = Deno.env.get('APP_ENV') ?? 'prod'

async function sendTelegramMessage(botToken: string, message: string) {
  const userId = Deno.env.get('TELEGRAM_USER_ID')
  if (!botToken || !userId) return
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: userId, text: message }),
    signal: AbortSignal.timeout(5000),
  })
}

function sendFailureAlert(message: string, durationMs: number, triggerSource: string) {
  const botToken = Deno.env.get('COASTER_RANK_ALERTS_BOT_TOKEN') ?? ''
  const ts = new Date().toISOString()
  const text =
    `[${APP_ENV}] 🚨 BT Recompute FAILED\n` +
    `⏰ Time: ${ts}\n` +
    `⏱️ Failed after: ${durationMs}ms\n` +
    `❌ Error: ${message}\n` +
    `🔀 Trigger: ${triggerSource}`
  return sendTelegramMessage(botToken, text)
}

function sendNumberOneEvent(newName: string, prevName: string | null) {
  const botToken = Deno.env.get('COASTER_RANK_EVENTS_BOT_TOKEN') ?? ''
  const overtakes = prevName ? ` (overtook ${prevName})` : ''
  const text = `[${APP_ENV}] 🏆 New #1: ${newName}${overtakes}`
  return sendTelegramMessage(botToken, text)
}

// ── Execution logging ───────────────────────────────────────────────────
type LogFields = {
  status: 'success' | 'error' | 'skipped'
  duration_ms: number
  trigger_source: string
  retries_used: number
  iterations?: number
  converged?: boolean
  pairs?: number
  updated?: number
  error_message?: string
  rpc_stats?: RpcStats
}

function logExecution(supabase: ReturnType<typeof createClient>, fields: LogFields) {
  return supabase.from('cron_execution_logs').insert(fields)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const cronSecret = Deno.env.get('RECOMPUTE_AUTH_SECRET')
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''

  const started = Date.now()
  let triggerSource = 'manual'
  let retriesUsed = 0
  // Partial instrumentation for the error path: assigned once the aggregate
  // RPCs settle, so a 504 failure still logs the timings/sizes it got.
  let rpcStats: RpcStats | undefined

  try {
    if (!token) return json({ error: 'missing bearer token' }, 401)

    if (cronSecret && token === cronSecret) {
      triggerSource = 'pg_cron'
    } else if (token === serviceKey) {
      // Ops/debug via the service-role key.
    } else {
      // User JWT: validate with GoTrue, then require profiles.is_admin.
      const me = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
      })
      if (!me.ok) return json({ error: 'invalid or expired token' }, 401)
      const user: { id?: string } = await me.json()
      if (!user.id) return json({ error: 'invalid token subject' }, 401)
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()
      if (!profile?.is_admin) return json({ error: 'admin access required' }, 403)
    }

    // Idle-skip (SCALE §6.1): pg_cron slots with no eligible-ranked
    // user_rides change since the last success AND an empty dirty queue
    // no-op before touching the expensive aggregates. The queue check is
    // what lets the pipeline see state changes that never touch user_rides:
    // the migration's backfill seed and the sweep's re-marks (eligibility
    // flips, missed-flag races) — skipping on the fingerprint alone would
    // starve the first cold backfill and strand re-marks until the next
    // ride write (PR #213 review). A failed queue read never skips (fail
    // open to a full run). Manual triggers (admin button / ops curl) always
    // run. The skip logs status='skipped' — deliberately NOT 'success', so
    // public_board_meta().last_recomputed_at only moves on real recomputes.
    // The fingerprint is read on every run (cheap single aggregate) and
    // stored on success rows, so the next cron slot always has something
    // to compare against regardless of which trigger produced it.
    let currentFp: RidesFingerprint | null = null
    {
      const { data: fpRow, error: fpError } = await supabase
        .rpc('recompute_idle_fingerprint')
        .maybeSingle()
      if (!fpError) currentFp = fingerprintOf((fpRow ?? null) as FingerprintRow | null)
    }
    // Live dirty-queue depth: one head count on a tiny table. null = the
    // read failed (transient PostgREST trouble) — treated as unknown, which
    // blocks the skip rather than risking starvation.
    let queueDepth: number | null = null
    {
      const { count, error: queueError } = await supabase
        .from('pair_dirty_users')
        .select('user_id', { count: 'exact', head: true })
      if (!queueError) queueDepth = count ?? 0
    }
    if (triggerSource === 'pg_cron' && currentFp) {
      const { data: lastSuccess } = await supabase
        .from('cron_execution_logs')
        .select('created_at, rpc_stats')
        .eq('status', 'success')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (
        lastSuccess &&
        shouldSkipRecompute(
          currentFp,
          fingerprintFromStats((lastSuccess as LastSuccessRow).rpc_stats),
          queueDepth,
        )
      ) {
        const durationMs = Date.now() - started
        await logExecution(supabase, {
          status: 'skipped',
          duration_ms: durationMs,
          trigger_source: triggerSource,
          retries_used: 0,
          rpc_stats: {
            skipped: true,
            skip_reason: 'no user_rides change since last success and dirty queue empty',
            dirty_queue: queueDepth,
            rides_max_ts: currentFp.ridesMaxTs,
            ranked_count: currentFp.rankedCount,
          },
        })
        const result: RecomputeResult = {
          updated: 0,
          durationMs,
          iterations: 0,
          converged: true,
          skipped: true,
        }
        return json(result, 200)
      }
      // A fingerprint failure (currentFp null) must never block the
      // recompute — fall through and do the full run.
    }

    // ── In-DB pipeline ───────────────────────────────────────────────────
    // pair_maintain_step claims + processes bounded dirty-user batches
    // (adaptive halving on statement timeouts) until the queue drains or the
    // per-run call budget is exhausted (a deeper queue drains across cron
    // slots — the watchdog watches for that). Then aggregates pair_totals (no
    // O(R) rides scan) and MM-fits in-DB, warm-started and resumable. Every
    // maintain statement runs under pair_maintain_step's 60s function-level
    // statement_timeout (migration 20260922191500), and the loop additionally
    // stops on MAINTAIN_MS_BUDGET. The fit stages run under their own 60s
    // function-level budgets (pair_fit_agg + pair_fit_step — migration
    // 20260924024100; incident 2026-09-24), with the step loop additionally
    // stopping on FIT_MS_BUDGET.
    let maintainMs = 0
    let maintainBudgetHit = false
    let maintainCalls = 0
    let maintainBatch = MAINTAIN_BATCH
    let aggMs = 0
    let stepMs = 0
    let stepCalls = 0
    let stepPMax = 25
    let rowsMs = 0
    let inDbRetries = 0
    let dirtyProcessed = 0
    let dirtyRemaining = 0
    let dirtyOldest: string | null = null
    let dbPairs = 0
    let dbContributors = 0
    let fitted: FittedRow[] = []
    let dbIterations = 0
    let dbConverged = true

    for (let call = 0; call < MAX_MAINTAIN_CALLS; call++) {
        if (maintainMs >= MAINTAIN_MS_BUDGET) {
          // A future giant-list user outgrew even the raised statement
          // budget — stop claiming and let the remainder drain next slots
          // (the first call always runs, so progress is guaranteed).
          maintainBudgetHit = true
          break
        }
        const t = await timed(() =>
          rpcWithRetry<MaintainRow>(supabase, 'pair_maintain_step', {
            p_batch: maintainBatch,
          }),
        )
        maintainMs += t.ms
        maintainCalls++
        if (t.value.error) {
          if (isStatementTimeoutMessage(t.value.error.message) && maintainBatch > 1) {
            // The batch's statements must each stay under the per-call
            // statement budget — halve and try again (consumed budget still
            // counts).
            maintainBatch = Math.max(1, Math.floor(maintainBatch / 2))
            continue
          }
          throw new Error(`pair_maintain_step: ${t.value.error.message}`)
        }
        inDbRetries = Math.max(inDbRetries, t.value.retriesUsed)
        const row = t.value.data?.[0]
        dirtyProcessed += Number(row?.processed ?? 0)
        dirtyRemaining = Number(row?.remaining ?? 0)
        if (row?.oldest_marked_at) dirtyOldest = row.oldest_marked_at
        if (dirtyRemaining === 0) break
      }

    {
      const aggT = await timed(() => rpcWithRetry<AggRow>(supabase, 'pair_fit_agg'))
      aggMs = aggT.ms
      if (aggT.value.error) throw new Error(`pair_fit_agg: ${aggT.value.error.message}`)
      inDbRetries = Math.max(inDbRetries, aggT.value.retriesUsed)
      dbPairs = Number(aggT.value.data?.[0]?.pairs ?? 0)
      dbContributors = Number(aggT.value.data?.[0]?.contributors ?? 0)

      // Warm-started MM, resumable across calls; halve p_max on statement
      // timeouts rather than retrying blind (a step that broke once will
      // break again at the same size).
      let done = false
      while (!done && stepCalls < MAX_STEP_CALLS) {
        if (stepMs >= FIT_MS_BUDGET) {
          // Pathological fit (or halving ladder against 60s statements):
          // fail closed on a bounded, legible error instead of eating the
          // invocation. Next slots retry from the warm start.
          throw new Error(`pair_fit_step: fit budget exceeded (${stepMs}ms over ${stepCalls} calls)`)
        }
        const t = await timed(() =>
          rpcWithRetry<{ done: boolean }>(supabase, 'pair_fit_step', { p_max: stepPMax }),
        )
        stepMs += t.ms
        stepCalls++
        if (t.value.error) {
          if (isStatementTimeoutMessage(t.value.error.message) && stepPMax > 1) {
            stepPMax = Math.max(1, Math.floor(stepPMax / 2))
            continue
          }
          throw new Error(`pair_fit_step: ${t.value.error.message}`)
        }
        inDbRetries = Math.max(inDbRetries, t.value.retriesUsed)
        done = t.value.data?.[0]?.done === true
      }

      const rowsT = await timed(() => rpcWithRetry<FittedRow>(supabase, 'pair_fit_rows'))
      rowsMs = rowsT.ms
      if (rowsT.value.error) throw new Error(`pair_fit_rows: ${rowsT.value.error.message}`)
      inDbRetries = Math.max(inDbRetries, rowsT.value.retriesUsed)
      fitted = (rowsT.value.data ?? []) as FittedRow[]
      dbIterations = fitted[0]?.iterations ?? 0
      dbConverged = fitted[0]?.converged ?? true
    }

    // ── Aggregates + served fit ──────────────────────────────────────────
    // The two sibling aggregates (participants, first-place votes) are still
    // paged — PostgREST caps every response at platform max-rows (SCALE §9).
    const [participantsT, firstPlaceT] = await Promise.all([
      timed(() => rpcPagedWithRetry<ParticipantRow>(supabase, 'ranked_participants')),
      timed(() => rpcPagedWithRetry<FirstPlaceRow>(supabase, 'first_place_counts')),
    ])
    const participantsRes = participantsT.value
    const firstPlaceRes = firstPlaceT.value
    rpcStats = {
      ranked_participants: {
        ms: participantsT.ms,
        bytes: estimatePayloadBytes(participantsRes.data),
        retries: participantsRes.retriesUsed,
      },
      first_place_counts: {
        ms: firstPlaceT.ms,
        bytes: estimatePayloadBytes(firstPlaceRes.data),
        retries: firstPlaceRes.retriesUsed,
      },
    }
    if (participantsRes.error) {
      throw new Error(`ranked_participants: ${participantsRes.error.message}`)
    }
    if (firstPlaceRes.error) throw new Error(`first_place_counts: ${firstPlaceRes.error.message}`)
    retriesUsed = Math.max(
      retriesUsed,
      participantsRes.retriesUsed,
      firstPlaceRes.retriesUsed,
      inDbRetries,
    )
    const participants = new Map(
      ((participantsRes.data ?? []) as ParticipantRow[]).map((r) => [
        r.coaster_id,
        r.participants,
      ]),
    )
    const firstPlace = new Map(
      ((firstPlaceRes.data ?? []) as FirstPlaceRow[]).map((r) => [
        r.coaster_id,
        r.first_place_votes,
      ]),
    )

    // Board rows come from pair_fit_rows (in-DB fit).
    const boardRows = fitted.map((r) => ({
      coasterId: r.coaster_id,
      score: r.score,
      comparisons: r.comparisons,
      wins: r.wins,
    }))
    const iterations = dbIterations
    const converged = dbConverged

    // Fit telemetry: emitted on every full run.
    {
      const fitStats: FitStats = {
        maintain_ms: maintainMs,
        maintain_calls: maintainCalls,
        maintain_batch_final: maintainBatch,
        maintain_budget_hit: maintainBudgetHit,
        agg_ms: aggMs,
        step_ms: stepMs,
        step_calls: stepCalls,
        step_p_max_final: stepPMax,
        rows_ms: rowsMs,
        db_pairs: dbPairs,
        db_contributors: dbContributors,
        db_iterations: dbIterations,
        db_converged: dbConverged,
        dirty_processed: dirtyProcessed,
        dirty_remaining: dirtyRemaining,
        dirty_oldest: dirtyOldest,
      }
      rpcStats = { ...rpcStats, fit: fitStats }
    }

    // Nothing ranked yet (or everything got un-ranked): clear stale ratings so
    // the board shows no scores. PostgREST DELETE needs a filter; this neq
    // matches every real uuid.
    if (boardRows.length === 0) {
      const { error } = await supabase
        .from('coaster_ratings')
        .delete()
        .neq('coaster_id', '00000000-0000-0000-0000-000000000000')
      if (error) throw new Error(error.message)
      // Snapshots of a wiped board are dead history — clear them too, so a
      // re-seeded board starts its weekly baseline fresh.
      const { error: snapError } = await supabase
        .from('rank_weekly_snapshots')
        .delete()
        .neq('coaster_id', '00000000-0000-0000-0000-000000000000')
      if (snapError) throw new Error(snapError.message)

      const durationMs = Date.now() - started
      await logExecution(supabase, {
        status: 'success',
        duration_ms: durationMs,
        trigger_source: triggerSource,
        retries_used: retriesUsed,
        iterations: 0,
        converged: true,
        pairs: 0,
        updated: 0,
        rpc_stats: {
          ...rpcStats,
          rides_max_ts: currentFp?.ridesMaxTs ?? null,
          ranked_count: currentFp?.rankedCount ?? 0,
        },
      })

      const result: RecomputeResult = {
        updated: 0,
        durationMs,
        iterations: 0,
        converged: true,
      }
      return json(result, 200)
    }

    // Snapshot the current #1 before recompute so we can detect a crown change.
    const prev = await crownSnapshotWithRetry(supabase)
    if (prev.error) throw new Error(`prev top: ${prev.error}`)
    const prevTopId = prev.top?.coaster_id as string | undefined

    const upserts = boardRows.map((r) => ({
      coaster_id: r.coasterId,
      score: r.score,
      comparisons: r.comparisons,
      wins: r.wins,
      participants: participants.get(r.coasterId) ?? 0,
      first_place_votes: firstPlace.get(r.coasterId) ?? 0,
    }))
    for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
      const { error } = await supabase
        .from('coaster_ratings')
        .upsert(upserts.slice(i, i + UPSERT_CHUNK), { onConflict: 'coaster_id' })
      if (error) throw new Error(error.message)
    }

    // Weekly rank snapshot (rank-movement baseline, PLAN §11): one upsert per
    // run overwrites the current week's row (it converges to end-of-week rank;
    // the previous week's row freezes and feeds rank_last_week). Ranks mirror
    // the view's exact rule — score desc, id asc tiebreak — so the stored
    // rank always equals the live row_number. computed_at rides the payload
    // so the conflict-update refreshes it (the column default only fires on
    // INSERT; it is "last computed", not "first computed this week").
    const now = new Date()
    const weekStart = weekStartUtc(now)
    const snapshotRows = [...boardRows]
      .sort((a, b) =>
        b.score !== a.score
          ? b.score - a.score
          : a.coasterId < b.coasterId
            ? -1
            : a.coasterId > b.coasterId
              ? 1
              : 0,
      )
      .map((r, i) => ({
        coaster_id: r.coasterId,
        week_start: weekStart,
        rank: i + 1,
        score: r.score,
        computed_at: now.toISOString(),
      }))
    for (let i = 0; i < snapshotRows.length; i += UPSERT_CHUNK) {
      const { error } = await supabase
        .from('rank_weekly_snapshots')
        .upsert(snapshotRows.slice(i, i + UPSERT_CHUNK), {
          onConflict: 'coaster_id,week_start',
        })
      if (error) throw new Error(error.message)
    }
    // Retention: the board consumes only the previous week's row, so drop
    // weeks older than that and keep the table bounded (~2 rows per ranked
    // coaster). Strictly older than the previous week, so the frozen
    // baseline survives a week-boundary roll.
    const retentionCutoff = new Date(
      Date.parse(`${weekStart}T00:00:00Z`) - 14 * 86_400_000,
    )
      .toISOString()
      .slice(0, 10)
    const { error: retentionError } = await supabase
      .from('rank_weekly_snapshots')
      .delete()
      .lt('week_start', retentionCutoff)
    if (retentionError) throw new Error(retentionError.message)

    // Remove ratings for coasters no longer in any pair (all their comparisons
    // were un-ranked) so the board demotes them back to "unrated".
    const computedIds = new Set(boardRows.map((r) => r.coasterId))
    const { data: existing, error: existingError } = await supabase
      .from('coaster_ratings')
      .select('coaster_id')
    if (existingError) throw new Error(existingError.message)
    const stale = ((existing ?? []) as { coaster_id: string }[])
      .map((r) => r.coaster_id)
      .filter((id) => !computedIds.has(id))
    for (let i = 0; i < stale.length; i += DELETE_CHUNK) {
      const chunk = stale.slice(i, i + DELETE_CHUNK)
      const { error } = await supabase.from('coaster_ratings').delete().in('coaster_id', chunk)
      if (error) throw new Error(error.message)
      // Their weekly snapshots are meaningless once they leave the board —
      // clear ALL weeks so a later return reads as a fresh ranking rather
      // than a ghost delta against a rank they no longer have.
      const { error: snapError } = await supabase
        .from('rank_weekly_snapshots')
        .delete()
        .in('coaster_id', chunk)
      if (snapError) throw new Error(snapError.message)
    }

    const durationMs = Date.now() - started

    // Check if the global #1 changed.
    const next = await crownSnapshotWithRetry(supabase)
    if (next.error) throw new Error(`new top: ${next.error}`)
    const newTopId = next.top?.coaster_id as string | undefined

    if (newTopId && newTopId !== prevTopId) {
      const { data: coaster } = await supabase
        .from('coasters')
        .select('name')
        .eq('id', newTopId)
        .single()
      const newName = coaster?.name ?? 'Unknown'

      let prevName: string | null = null
      if (prevTopId) {
        const { data: prevCoaster } = await supabase
          .from('coasters')
          .select('name')
          .eq('id', prevTopId)
          .single()
        prevName = prevCoaster?.name ?? null
      }

      await sendNumberOneEvent(newName, prevName)
    }

    await logExecution(supabase, {
      status: 'success',
      duration_ms: durationMs,
      trigger_source: triggerSource,
      retries_used: retriesUsed,
      iterations,
      converged,
      pairs: dbPairs,
      updated: upserts.length,
      rpc_stats: {
        ...rpcStats,
        rides_max_ts: currentFp?.ridesMaxTs ?? null,
        ranked_count: currentFp?.rankedCount ?? 0,
      },
    })

    const result: RecomputeResult = {
      updated: upserts.length,
      durationMs,
      iterations,
      converged,
    }
    return json(result, 200)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'recompute failed'
    const durationMs = Date.now() - started

    try {
      await logExecution(supabase, {
        status: 'error',
        duration_ms: durationMs,
        trigger_source: triggerSource,
        retries_used: retriesUsed,
        error_message: message,
        // Partial timings survive failures — a 504 on pairwise_wins still
        // records the other two RPCs' ms/bytes for diagnosis.
        ...(rpcStats ? { rpc_stats: rpcStats } : {}),
      })
      await sendFailureAlert(message, durationMs, triggerSource)
    } catch {
      // Best-effort: logging/alerting failure must not mask the original error.
    }

    return json({ error: message }, 500)
  }
})
