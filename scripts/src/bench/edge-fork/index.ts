// BENCH-ONLY fork of recompute-rankings (spike: docs/spikes/2026-09-pairwise-bench/).
// Identical auth/logging/write flow, but the pair aggregation AND the MM fit
// both run inside Postgres via bench.recompute_plpgsql() (single RPC, tiny
// payload — no pair rows cross the gateway). Deployed to the disposable
// staging project only; never deployed to prod.
//
// NOTE: rpc_stats keeps the 'pairwise_wins' key for the in-DB call so the
// bench harness (which reads rpc_stats->'pairwise_wins') needs no branching.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3'
// Pure retry/skip/instrumentation helpers (unit-tested in helpers_test.ts).
import {
  backoffDelayMs,
  estimatePayloadBytes,
  isRetryableRpcError,
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
// One row per fitted coaster from bench.recompute_plpgsql(); iterations and
// converged repeat on every row (fit-level diagnostics).
type FittedRow = {
  coaster_id: string
  score: number
  comparisons: number
  wins: number
  iterations: number
  converged: boolean
}
type FingerprintRow = { rides_max_ts: string | null; ranked_count: number | string }
type LastSuccessRow = { created_at: string; rpc_stats: RpcStats | null }
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
// (which carry the idle fingerprint instead of timings).
type RpcTiming = { ms: number; bytes: number; retries: number }
type RpcStats = {
  pairwise_wins?: RpcTiming
  ranked_participants?: RpcTiming
  first_place_counts?: RpcTiming
  rides_max_ts?: string | null
  ranked_count?: number
  skipped?: boolean
  skip_reason?: string
}

const UPSERT_CHUNK = 500
const DELETE_CHUNK = 100
// 504s need the server to recover, so back off exponentially (1s/2s/4s,
// helpers.backoffDelayMs) rather than the old fixed 300ms. Three retries cap
// the added latency at ~7s + jitter, inside the function budget.
const RPC_MAX_RETRIES = 3
const RPC_RETRY_JITTER_MS = 250

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
      order: (
        column: string,
        options: { ascending: boolean },
      ) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
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
    // user_rides change since the last success no-op before touching the
    // expensive aggregates. Manual triggers (admin button / ops curl) always
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
            skip_reason: 'no user_rides change since last success',
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

    // In-DB fit (bench variant): aggregation + MM fit run inside Postgres,
    // split across resumable RPCs so no single statement nears the platform's
    // ~8s statement timeout: fit_maintain (dirty users only, no-op without the
    // dirty-tracking install) → fit_agg (pair tables) → fit_step ×N (MM
    // iterations, adaptive batch) → fit_rows (fitted board — tiny payload).
    // All timing is summed into the 'pairwise_wins' rpc_stats key so the bench
    // harness reads it unchanged.
    const maintainT = await timed(() => rpcWithRetry<unknown>(supabase, 'bench_fit_maintain'))
    if (maintainT.value.error)
      throw new Error(`bench_fit_maintain: ${maintainT.value.error.message}`)
    const aggT = await timed(() => rpcWithRetry<unknown>(supabase, 'bench_fit_agg'))
    if (aggT.value.error) throw new Error(`bench_fit_agg: ${aggT.value.error.message}`)
    let stepMs = 0
    let stepRetries = 0
    let done = false
    let calls = 0
    // Adaptive step size: a step's statements must each stay under the ~8s
    // platform statement timeout; per-iteration cost grows with the pair
    // count, so halve p_max on statement-timeout failures until a step fits.
    let pMax = 25
    while (!done && calls < 200) {
      const stepT = await timed(() =>
        rpcWithRetry<{ done: boolean }>(supabase, 'bench_fit_step', { p_max: pMax }),
      )
      stepMs += stepT.ms
      if (stepT.value.error) {
        if (stepT.value.error.message.includes('statement timeout') && pMax > 1) {
          pMax = Math.max(1, Math.floor(pMax / 2))
          calls += 1
          continue
        }
        throw new Error(`bench_fit_step: ${stepT.value.error.message}`)
      }
      stepRetries = Math.max(stepRetries, stepT.value.retriesUsed)
      done = stepT.value.data?.[0]?.done === true
      calls += 1
    }
    const rowsT = await timed(() => rpcWithRetry<FittedRow>(supabase, 'bench_fit_rows'))
    if (rowsT.value.error) throw new Error(`bench_fit_rows: ${rowsT.value.error.message}`)

    const participantsT = await timed(() =>
      rpcWithRetry<ParticipantRow>(supabase, 'ranked_participants'),
    )
    const firstPlaceT = await timed(() =>
      rpcWithRetry<FirstPlaceRow>(supabase, 'first_place_counts'),
    )
    const participantsRes = participantsT.value
    const firstPlaceRes = firstPlaceT.value
    rpcStats = {
      pairwise_wins: {
        ms: maintainT.ms + aggT.ms + stepMs + rowsT.ms,
        bytes: estimatePayloadBytes(rowsT.value.data),
        retries: Math.max(
          maintainT.value.retriesUsed,
          aggT.value.retriesUsed,
          stepRetries,
          rowsT.value.retriesUsed,
        ),
      },
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
    retriesUsed = Math.max(participantsRes.retriesUsed, firstPlaceRes.retriesUsed)
    const fitted = (rowsT.value.data ?? []) as FittedRow[]
    const fitIterations = fitted[0]?.iterations ?? 0
    const fitConverged = fitted[0]?.converged ?? true
    const participants = new Map(
      ((participantsRes.data ?? []) as ParticipantRow[]).map((r) => [r.coaster_id, r.participants]),
    )
    const firstPlace = new Map(
      ((firstPlaceRes.data ?? []) as FirstPlaceRow[]).map((r) => [
        r.coaster_id,
        r.first_place_votes,
      ]),
    )

    // Nothing ranked yet (or everything got un-ranked): clear stale ratings so
    // the board shows no scores. PostgREST DELETE needs a filter; this neq
    // matches every real uuid.
    if (fitted.length === 0) {
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

    // Rows come back already fitted (score/comparisons/wins from the RPC);
    // participants and first-place votes join from the sibling RPCs.
    const rows = fitted.map((r) => ({
      coasterId: r.coaster_id,
      score: r.score,
      comparisons: r.comparisons,
      wins: r.wins,
    }))

    const upserts = rows.map((r) => ({
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
    const snapshotRows = [...rows]
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
    const retentionCutoff = new Date(Date.parse(`${weekStart}T00:00:00Z`) - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10)
    const { error: retentionError } = await supabase
      .from('rank_weekly_snapshots')
      .delete()
      .lt('week_start', retentionCutoff)
    if (retentionError) throw new Error(retentionError.message)

    // Remove ratings for coasters no longer in any pair (all their comparisons
    // were un-ranked) so the board demotes them back to "unrated".
    const computedIds = new Set(rows.map((r) => r.coasterId))
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
      iterations: fitIterations,
      converged: fitConverged,
      pairs: fitted.length,
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
      iterations: fitIterations,
      converged: fitConverged,
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
