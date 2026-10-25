// Session analytics snapshot (SESSION_ANALYTICS.md / RUNBOOKS "how to query").
// READ-ONLY ops tool: one pass over the two Analytics Engine datasets plus
// the /api/sessions config echo, printed as a compact report. No writes, no
// Postgres, no third-party endpoints.
//
// Usage (from scripts/): npx tsx src/oneoff/analytics-snapshot.ts
// Optional: --days N (default 28, window for the daily-trend section).
//
// Reads CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from the root .env
// (dotenv, same pattern as every other one-off). The token needs
// Account → Analytics → Read (the same token the RUM queries use).
//
// Blob/double positions are the wire contract — if
// app/src/lib/analytics-schema.ts changes them, update BOTH RUNBOOKS and
// the queries below (positions map: summary blobs =
// [entry_surface, viewport, max_scroll, reached, auth_state]; doubles =
// [ms_to_first_interaction, ms_to_first_mark, duration_ms, mark_count,
// reorder_count, did_search, did_filter]; events blobs = [name, bucket],
// doubles = [1]).

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '..', '..', '.env') })

const WORKER_ORIGIN = 'https://coasterrank.app'
const AE_API = (account: string) =>
  `https://api.cloudflare.com/client/v4/accounts/${account}/analytics_engine/sql`
const SUMMARY_DS = 'coasterrank_session_summary'
const EVENTS_DS = 'coasterrank_session_events'

const daysArg = process.argv.find((arg) => arg.startsWith('--days='))
const DAYS = daysArg ? Math.max(1, Math.min(90, Number(daysArg.split('=')[1]) || 28)) : 28

const token = process.env.CLOUDFLARE_API_TOKEN
const account = process.env.CLOUDFLARE_ACCOUNT_ID
if (!token || !account) {
  console.error(
    'Missing CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID in root .env (Account → Analytics → Read token).',
  )
  process.exit(1)
}

type AERow = Record<string, string | number>

async function aeSql(query: string): Promise<AERow[]> {
  const res = await fetch(AE_API(account!), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'text/plain' },
    body: query,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`AE SQL ${res.status}: ${text.slice(0, 200)}`)
  }
  const body = (await res.json()) as { data?: AERow[] }
  return body.data ?? []
}

async function configEcho(): Promise<{ enabled: boolean; sampleRate: number } | null> {
  try {
    const res = await fetch(`${WORKER_ORIGIN}/api/sessions`, { method: 'GET' })
    if (!res.ok) return null
    return (await res.json()) as { enabled: boolean; sampleRate: number }
  } catch {
    return null
  }
}

const num = (v: string | number | undefined) => Number(v ?? 0)

// ── Queries (all interval-weighted per the AE sampling contract) ─────────────

const distributionQuery = (ds: string, blob: string) => `
  SELECT ${blob} AS key, sum(_sample_interval) AS n
  FROM ${ds}
  GROUP BY key
  ORDER BY n DESC`

async function fetchAll() {
  // toDate() requires the AE SQL dialect to have it; if the account's reader
  // rejects it, the script fails loudly here rather than half-reporting.
  const [
    config,
    summaryTotals,
    reached,
    entrySurface,
    viewport,
    maxScroll,
    authState,
    rollups,
    eventsByDay,
    eventsTop,
  ] = await Promise.all([
    configEcho(),
    aeSql(
      `SELECT count() AS n, min(timestamp) AS first, max(timestamp) AS last FROM ${SUMMARY_DS}`,
    ),
    aeSql(distributionQuery(SUMMARY_DS, 'blob4')),
    aeSql(distributionQuery(SUMMARY_DS, 'blob1')),
    aeSql(distributionQuery(SUMMARY_DS, 'blob2')),
    aeSql(distributionQuery(SUMMARY_DS, 'blob3')),
    aeSql(distributionQuery(SUMMARY_DS, 'blob5')),
    aeSql(`
      SELECT
        avg(_sample_interval * double6) / sum(_sample_interval) * 100 AS pct_search,
        avg(_sample_interval * double7) / sum(_sample_interval) * 100 AS pct_filter,
        avg(_sample_interval * double4) / sum(_sample_interval) AS avg_marks,
        avg(_sample_interval * double5) / sum(_sample_interval) AS avg_reorders,
        avg(_sample_interval * double3) / sum(_sample_interval) AS avg_duration_ms,
        sumIf(_sample_interval * double1, double1 >= 0) / sumIf(_sample_interval, double1 >= 0) AS avg_ms_to_first_interaction,
        sumIf(_sample_interval * double2, double2 >= 0) / sumIf(_sample_interval, double2 >= 0) AS avg_ms_to_first_mark,
        sumIf(_sample_interval, double2 >= 0) / sum(_sample_interval) * 100 AS pct_ever_added
      FROM ${SUMMARY_DS}
      WHERE _sample_interval > 0`),
    aeSql(`
      SELECT toDate(timestamp) AS day, sum(_sample_interval) AS sessions
      FROM ${SUMMARY_DS}
      GROUP BY day
      ORDER BY day ASC`),
    aeSql(`
      SELECT toDate(timestamp) AS day, blob1 AS event, sum(_sample_interval * double1) AS n
      FROM ${EVENTS_DS}
      GROUP BY day, event
      ORDER BY day ASC, n DESC`),
  ])
  return {
    config,
    summaryTotals,
    reached,
    entrySurface,
    viewport,
    maxScroll,
    authState,
    rollups,
    eventsByDay,
    eventsTop,
  }
}

// ── Report ───────────────────────────────────────────────────────────────────

function dist(rows: AERow[], total: number): string {
  const lines = rows.map((r) => {
    const n = num(r.n)
    const label = r.key === '' ? '(empty)' : String(r.key)
    return `    ${label.padEnd(14)} ${n}${total > 0 ? ` (${((n / total) * 100).toFixed(1)}%)` : ''}`
  })
  return lines.join('\n')
}

function durationPct(ms: number): string {
  if (!Number.isFinite(ms)) return '—'
  return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)} min` : `${Math.round(ms / 1000)}s`
}

function smallN(total: number): string {
  return total < 50
    ? `  ⚠ n=${total} is below the read-threshold (~50) — treat every number above as a shape-check, not a rate.`
    : ''
}

function printReport(data: Awaited<ReturnType<typeof fetchAll>>): void {
  const {
    config,
    summaryTotals,
    reached,
    entrySurface,
    viewport,
    maxScroll,
    authState,
    rollups,
    eventsByDay,
    eventsTop,
  } = data
  const total = num(summaryTotals[0]?.n)

  console.log('═'.repeat(72))
  console.log('Session analytics snapshot (read-only)')
  console.log('═'.repeat(72))

  console.log(`\nConfig echo (${WORKER_ORIGIN}/api/sessions):`)
  if (!config) console.log('    unable to reach the endpoint — ingest may be down')
  else
    console.log(
      config.enabled
        ? `    enabled=true, sampleRate=${config.sampleRate}%`
        : `    enabled=FALSE — collection is off (check ANALYTICS_* vars on the production environment)`,
    )

  console.log(`\nSummary rows (1 per tab): ${total}`)
  if (total === 0) {
    console.log(
      '\n  No data yet. Either no visitors since collection turned on, or beacons are failing.\n  Healthy pipe checks: config echo above; bundle contains /api/sessions;\n  POST responses return {ok:true,stored:N}.',
    )
    console.log(smallN(total))
  } else {
    const first = String(summaryTotals[0]?.first ?? '')
    const last = String(summaryTotals[0]?.last ?? '')
    console.log(`    window: ${first.slice(0, 16)} → ${last.slice(0, 16)} (UTC)`)
  }

  if (total > 0) {
    const r = rollups[0]
    console.log('\nFunnel reach (highest step per tab):')
    console.log(dist(reached, total))
    console.log(
      `\nSearch/filter usage: ${num(r?.pct_search).toFixed(1)}% searched · ${num(r?.pct_filter).toFixed(1)}% filtered`,
    )
    console.log(
      `Pace (of tabs that added anything, ${num(r?.pct_ever_added).toFixed(1)}% of sessions): ` +
        `first interaction after ${durationPct(num(r?.avg_ms_to_first_interaction))} · first mark after ${durationPct(num(r?.avg_ms_to_first_mark))}`,
    )
    console.log(
      `Averages per tab: ${num(r?.avg_marks).toFixed(1)} marks · ${num(r?.avg_reorders).toFixed(1)} reorders · session length ${durationPct(num(r?.avg_duration_ms))}`,
    )
    console.log(`\nEntry surface:\n${dist(entrySurface, total)}`)
    console.log(`\nViewport:\n${dist(viewport, total)}`)
    console.log(`\nScroll depth (none = never scrolled, not missing):\n${dist(maxScroll, total)}`)
    console.log(`\nAuth segment (coarse): \n${dist(authState, total)}`)
    console.log(smallN(total))
  }

  const eventsTotal = eventsTop.reduce((acc, r) => acc + num(r.n), 0)
  console.log(`\nEvents dataset: ${eventsTotal} interactions`)
  if (eventsByDay.length > 0) {
    console.log('  by day:')
    for (const r of eventsByDay) console.log(`    ${String(r.day).slice(0, 10)}  ${num(r.n)}`)
  }
  const byEvent = new Map<string, number>()
  for (const r of eventsTop)
    byEvent.set(String(r.event), (byEvent.get(String(r.event)) ?? 0) + num(r.n))
  if (byEvent.size > 0) {
    console.log('  by event:')
    for (const [event, n] of [...byEvent.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${event.padEnd(26)} ${n}`)
    }
  }

  console.log(
    `\nReminder: events = sampled interactions (search/filter/scroll are one-per-session ⚡) — funnel % comes from the summary blocks above, never from event counts.`,
  )
  console.log('═'.repeat(72))
}

fetchAll()
  .then(printReport)
  .catch((error) => {
    console.error('Snapshot failed:', error instanceof Error ? error.message : error)
    process.exit(1)
  })
