// POST /api/sessions — anonymous session analytics ingest + GET config.
// (SESSION_ANALYTICS.md; lib/analytics-schema.ts holds the wire contract.)
//
// Privacy boundary: browsers reach ONLY this worker for analytics, never
// Supabase. The worker validates every payload against the shared schema,
// hard-gates DNT/GPC requests server-side, rate-limits per client without
// persisting any identifier (hashed-IP fixed window, in-isolate memory,
// never logged), and expands each event into an Analytics Engine datapoint.
// Unknown event names, out-of-range buckets, oversized batches → 400.
// Missing AE bindings (local dev, CI) → 202 with dropped:true — never an
// SPA-visible error.
//
// Config (GET): ANALYTICS_ENABLED / ANALYTICS_SAMPLE_RATE dashboard vars —
// runtime-configurable without a redeploy; the GET response is served with
// a 5-minute browser TTL so a dashboard kill switch lands within minutes.
// Unset vars fail closed (collection off). A KV-backed config is the
// documented v2 upgrade path once an admin UI needs to mutate it.

import {
  parseAnalyticsPayload,
  type AnalyticsEventWire,
  type AnalyticsSummaryWire,
} from './lib/analytics-schema'

const POST_BODY_LIMIT_BYTES = 256 * 1024
const MAX_EVENTS_PER_BATCH = 50
const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 30
const RATE_LIMIT_MAP_MAX = 5_000
const CONFIG_TTL_SECONDS = 300

export interface AnalyticsEngineBinding {
  writeDataPoint(event: { blobs?: string[]; doubles?: number[]; indexes?: string[] }): void
}

export interface SessionsEnv {
  SESSIONS_AE_EVENTS?: AnalyticsEngineBinding
  SESSIONS_AE_SUMMARY?: AnalyticsEngineBinding
  ANALYTICS_ENABLED?: string
  ANALYTICS_SAMPLE_RATE?: string
  RATE_LIMIT_SALT?: string
}

function json(body: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extraHeaders },
  })
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ── Rate limiting: hashed-IP fixed window, in-isolate memory only ───────────
// "Limit, don't store": the hashed key (salted) lives nowhere durable and is
// never logged; the map is pruned opportunistically. Isolate-local accuracy
// is adequate for v1 abuse damping (a fixed ceiling, not an abuse control per
// SECURITY.md §Known risks).
const rateWindow = new Map<string, number[]>()

export function __resetSessionsRateLimitForTests(): void {
  rateWindow.clear()
}

async function rateLimitKey(request: Request, env: SessionsEnv): Promise<string | null> {
  const ip =
    request.headers.get('CF-Connecting-IP') ??
    request.headers.get('X-Forwarded-For')?.split(',')[0]?.trim()
  if (!ip) return null // no identifier available → don't track, don't limit
  const windowStart = Math.floor(Date.now() / RATE_LIMIT_WINDOW_MS)
  return (await sha256Hex(`${env.RATE_LIMIT_SALT ?? 'coasterrank'}|${windowStart}|${ip}`)).slice(
    0,
    16,
  )
}

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const hits = rateWindow.get(key) ?? []
  const recent = hits.filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    rateWindow.set(key, recent)
    return true
  }
  recent.push(now)
  rateWindow.set(key, recent)
  if (rateWindow.size > RATE_LIMIT_MAP_MAX) {
    for (const [k, times] of rateWindow) {
      if (times.length === 0 || now - times[times.length - 1] > RATE_LIMIT_WINDOW_MS * 2) {
        rateWindow.delete(k)
      }
      if (rateWindow.size <= RATE_LIMIT_MAP_MAX) break
    }
  }
  return false
}

function expandEventToDataPoint(event: AnalyticsEventWire): {
  blobs: string[]
  doubles: number[]
} {
  // blobs: [name, first bucket prop (often '')] — fixed arity so SQL can
  // group by blob1 unconditionally. doubles: [1] — sampled count semantics.
  const bucket =
    event.props.bulk_add_bucket ?? event.props.rows_bucket ?? event.props.rides_bucket ?? ''
  return { blobs: [event.name, bucket], doubles: [1] }
}

function expandSummaryToDataPoint(summary: AnalyticsSummaryWire): {
  blobs: string[]
  doubles: number[]
} {
  return {
    blobs: [
      summary.entry_surface,
      summary.viewport,
      summary.max_scroll,
      summary.reached,
      summary.auth_state,
    ],
    doubles: [
      summary.ms_to_first_interaction,
      summary.ms_to_first_mark,
      summary.duration_ms,
      summary.mark_count,
      summary.reorder_count,
      summary.did_search,
      summary.did_filter,
    ],
  }
}

function sessionGPC(request: Request): boolean {
  const gpc = request.headers.get('Sec-GPC')
  const dnt = request.headers.get('DNT')
  return gpc === '1' || dnt === '1'
}

export function parseConfig(env: SessionsEnv): { enabled: boolean; sampleRate: number } {
  const enabled = env.ANALYTICS_ENABLED === 'true'
  const raw = env.ANALYTICS_SAMPLE_RATE?.trim()
  const rate = raw ? Number(raw) : Number.NaN
  return {
    enabled,
    // Missing/garbled rate → the intended default (100) rather than silently 0.
    sampleRate:
      raw === undefined || raw === '' || !Number.isFinite(rate) || rate < 0 || rate > 100
        ? 100
        : rate,
  }
}

export async function handleSessionsRequest(request: Request, env: SessionsEnv): Promise<Response> {
  if (request.method === 'GET') {
    const config = parseConfig(env)
    return json(config, 200, {
      'Cache-Control': `public, max-age=${CONFIG_TTL_SECONDS}`,
    })
  }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 })
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, { Allow: 'GET, POST, OPTIONS' })
  }

  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.includes('application/json')) {
    return json({ error: 'Content-Type must be application/json' }, 415)
  }
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (Number.isFinite(declared) && declared > POST_BODY_LIMIT_BYTES) {
    return json({ error: 'Payload too large' }, 413)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'Invalid JSON' }, 400)
  }

  // Hard gate: an opted-out visitor (browser signal) never gets data points
  // even from a stale client that somehow captured first.
  if (sessionGPC(request)) {
    // 204 No Content (bodies are invalid for 204 in the fetch spec).
    return new Response(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const key = await rateLimitKey(request, env)
  if (key && isRateLimited(key)) {
    return json({ error: 'Rate limited' }, 429, { 'Retry-After': '30' })
  }

  const payload = parseAnalyticsPayload(body)
  if (!payload) {
    return json({ error: 'Invalid payload' }, 400)
  }
  if (payload.events.length > MAX_EVENTS_PER_BATCH) {
    return json({ error: 'Batch too large' }, 400)
  }

  const eventsBinding = env.SESSIONS_AE_EVENTS
  const summaryBinding = env.SESSIONS_AE_SUMMARY
  if (!eventsBinding || !summaryBinding) {
    // Local dev / CI without AE bindings: accept (client must not error-loop)
    // and drop. Prod bindings ship with the deploy, so this is a dev-only path.
    return json({ ok: true, dropped: 'no-dataset', stored: 0 }, 202)
  }

  let stored = 0
  try {
    for (const event of payload.events) {
      const point = expandEventToDataPoint(event)
      eventsBinding.writeDataPoint({ ...point, indexes: [] })
      stored += 1
    }
    if (payload.summary) {
      const point = expandSummaryToDataPoint(payload.summary)
      summaryBinding.writeDataPoint({ ...point, indexes: [] })
      stored += 1
    }
  } catch (error) {
    // AE is best-effort: a binding hiccup must not error the client loop.
    console.error('[sessions] writeDataPoint failed:', error)
    return json({ ok: true, dropped: 'binding-error', stored }, 202)
  }

  return json({ ok: true, stored }, 202)
}
