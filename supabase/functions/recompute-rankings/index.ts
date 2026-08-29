// Bradley-Terry batch recompute (PLAN §5). Fits strengths from all ranked
// user_rides and upserts them into coaster_ratings; the board's
// v_coaster_rankings view reads the results live.
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
// Observability: every execution is logged to cron_execution_logs.
// On failure: Telegram alert via CoasterRankAlerts bot.
// On #1 change: Telegram event via CoasterRankEvents bot.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// Pure-TS MM implementation shared with the Vitest suite; bundled at deploy.
import { computeRankings, type Pair } from '../../../packages/bt/src/mm.ts'

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

type PairRow = { winner: string; loser: string; weight: number; wins: number }
type ParticipantRow = { coaster_id: string; participants: number }
type RecomputeResult = { updated: number; durationMs: number; iterations: number; converged: boolean }

const UPSERT_CHUNK = 500
const DELETE_CHUNK = 100
const RPC_MAX_RETRIES = 2
const RPC_RETRY_DELAY_MS = 300

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function isPgrst303(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false
  const e = err as Record<string, unknown>
  return e.code === 'PGRST303'
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
    if (!res.error || !isPgrst303(res.error)) return { ...res, retriesUsed }
    lastError = res.error
    if (attempt < RPC_MAX_RETRIES) {
      retriesUsed++
      await sleep(RPC_RETRY_DELAY_MS)
    }
  }
  return {
    data: null,
    error: { message: `${lastError!.message} (after ${retriesUsed + 1} attempts)` },
    retriesUsed,
  }
}

// ── Telegram helpers ────────────────────────────────────────────────────
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
    `🚨 BT Recompute FAILED\n` +
    `⏰ Time: ${ts}\n` +
    `⏱️ Failed after: ${durationMs}ms\n` +
    `❌ Error: ${message}\n` +
    `🔀 Trigger: ${triggerSource}`
  return sendTelegramMessage(botToken, text)
}

function sendNumberOneEvent(newName: string, prevName: string | null) {
  const botToken = Deno.env.get('COASTER_RANK_EVENTS_BOT_TOKEN') ?? ''
  const overtakes = prevName ? ` (overtook ${prevName})` : ''
  const text = `🏆 New #1: ${newName}${overtakes}`
  return sendTelegramMessage(botToken, text)
}

// ── Execution logging ───────────────────────────────────────────────────
type LogFields = {
  status: 'success' | 'error'
  duration_ms: number
  trigger_source: string
  retries_used: number
  iterations?: number
  converged?: boolean
  pairs?: number
  updated?: number
  error_message?: string
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

    // Aggregated pairwise wins (per-user normalized, PLAN §5.1) + participant
    // counts, both via the RPCs installed by the Phase 6 migration.
    const [pairsRes, participantsRes] = await Promise.all([
      rpcWithRetry<PairRow>(supabase, 'pairwise_wins'),
      rpcWithRetry<ParticipantRow>(supabase, 'ranked_participants'),
    ])
    if (pairsRes.error) throw new Error(`pairwise_wins: ${pairsRes.error.message}`)
    if (participantsRes.error) {
      throw new Error(`ranked_participants: ${participantsRes.error.message}`)
    }
    const retriesUsed = Math.max(pairsRes.retriesUsed, participantsRes.retriesUsed)
    const pairs = (pairsRes.data ?? []) as PairRow[]
    const participants = new Map(
      ((participantsRes.data ?? []) as ParticipantRow[]).map((r) => [
        r.coaster_id,
        r.participants,
      ]),
    )

    // Nothing ranked yet (or everything got un-ranked): clear stale ratings so
    // the board shows no scores. PostgREST DELETE needs a filter; this neq
    // matches every real uuid.
    if (pairs.length === 0) {
      const { error } = await supabase
        .from('coaster_ratings')
        .delete()
        .neq('coaster_id', '00000000-0000-0000-0000-000000000000')
      if (error) throw new Error(error.message)

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
    const { data: prevTop } = await supabase
      .from('coaster_ratings')
      .select('coaster_id')
      .order('score', { ascending: false })
      .limit(1)
      .single()
    const prevTopId = prevTop?.coaster_id as string | undefined

    const { rows, iterations, converged } = computeRankings(
      pairs.map((r): Pair => {
        return { winner: r.winner, loser: r.loser, weight: r.weight, wins: r.wins }
      }),
    )

    const upserts = rows.map((r) => ({
      coaster_id: r.coasterId,
      score: r.score,
      comparisons: r.comparisons,
      wins: r.wins,
      participants: participants.get(r.coasterId) ?? 0,
    }))
    for (let i = 0; i < upserts.length; i += UPSERT_CHUNK) {
      const { error } = await supabase
        .from('coaster_ratings')
        .upsert(upserts.slice(i, i + UPSERT_CHUNK), { onConflict: 'coaster_id' })
      if (error) throw new Error(error.message)
    }

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
      const { error } = await supabase
        .from('coaster_ratings')
        .delete()
        .in('coaster_id', stale.slice(i, i + DELETE_CHUNK))
      if (error) throw new Error(error.message)
    }

    const durationMs = Date.now() - started

    // Check if the global #1 changed.
    const { data: newTop } = await supabase
      .from('coaster_ratings')
      .select('coaster_id')
      .order('score', { ascending: false })
      .limit(1)
      .single()
    const newTopId = newTop?.coaster_id as string | undefined

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
      pairs: pairs.length,
      updated: upserts.length,
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
        retries_used: 0,
        error_message: message,
      })
      await sendFailureAlert(message, durationMs, triggerSource)
    } catch {
      // Best-effort: logging/alerting failure must not mask the original error.
    }

    return json({ error: message }, 500)
  }
})
