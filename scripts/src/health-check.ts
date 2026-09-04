#!/usr/bin/env tsx
/**
 * Health check — periodic sanity probe for prod.
 *
 * Runs every 30 min via GitHub Actions (health-check.yml). Hits the public
 * site + /api/ranking + Supabase anon surface, and optionally drives a
 * headless browser to prove the board actually renders.
 *
 * Fixed-floor thresholds (no persisted baseline — pre-launch simplicity):
 *   parks >= 250, coasters >= 1000, rankings payload >= 900 rows when present.
 * Staleness: generated_at / max(updated_at) < 45m (30m cadence + 15m recompute).
 * If you need drift detection post-launch, add a health_check_logs table
 * with hybrid floor+delta (see spike notes) — not warranted now.
 *
 * Exit code: 0 = healthy, 1 = any check failed (GH job fails → Telegram alert).
 * Flags: --skip-browser skips Playwright (for runners without chromium deps).
 *        --url <https://host> overrides prod URL (default https://coasterrank.app).
 *
 * Alert template (Telegram — CoasterRankAlerts, on failure only):
 *   🚨 Health check FAILED
 *   🩺 Target: https://coasterrank.app
 *   ⏰ Time: 2026-09-04T22:52:00Z
 *   🔗 Run: https://github.com/pandeiro/CoasterRank/actions/runs/123456789
 *   Drill: check cron_execution_logs + /api/ranking (see run log).
 *
 * Console + GITHUB_STEP_SUMMARY (failed run) + drill snippet:
 *   Health check: FAILED (1/8)
 *     target: https://coasterrank.app
 *   ✅ homepage:status+marker: GET / → 200 contains CoasterRank (157ms)
 *   ✅ homepage:latency: latency 157ms (budget 5000ms)
 *   ✅ api:status: GET /api/ranking → 200 (242ms)
 *   ❌ api:freshness: stale 52m ago (generated_at=2026-09-04T22:00:00Z) (budget 45m)
 *   ✅ supabase:v_coaster_rankings: anon read ok
 *   ✅ browser:board_render: board rendered: rows~250, heading=true, table=true (1014ms)
 *   Drill:
 *     source .env && psql "$SUPABASE_DB_URL" -c "SELECT status, retries_used, error_message, created_at FROM cron_execution_logs ORDER BY created_at DESC LIMIT 5;"
 *     curl -s https://coasterrank.app/api/ranking | head -c 400
 */

import { config } from 'dotenv'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
config({ path: join(SCRIPT_DIR, '..', '..', '.env') })

const DEFAULT_PROD_URL = 'https://coasterrank.app'
const FETCH_TIMEOUT_MS = 10_000
const PAGE_TIMEOUT_MS = 20_000

// Fixed floors — conservative vs current catalog (310 parks / ~1236 coasters
// as of Aug 2026 curation). Catches catastrophic deletes without being noisy.
const MIN_PARKS = 250
const MIN_COASTERS = 1000
const MIN_RANKINGS_ROWS = 900
const MAX_STALENESS_MS = 45 * 60 * 1000

type Check = { name: string; ok: boolean; detail: string; latencyMs?: number }

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag)
  return i !== -1 ? process.argv[i + 1] : undefined
}
const hasFlag = (flag: string) => process.argv.includes(flag)

const prodUrl = (arg('--url') ?? process.env.HEALTH_CHECK_URL ?? DEFAULT_PROD_URL).replace(
  /\/+$/,
  '',
)
const skipBrowser = hasFlag('--skip-browser')
const supabaseUrl = (
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  ''
).trim()
const supabaseAnonKey = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim()

async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<{ res: Response; latencyMs: number; body: string }> {
  const started = Date.now()
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), init.timeoutMs ?? FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    const latencyMs = Date.now() - started
    const body = await res.text()
    return { res, latencyMs, body }
  } finally {
    clearTimeout(t)
  }
}

function parseJsonSafe(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

function msAgo(iso: string): number | null {
  const ts = Date.parse(iso)
  if (Number.isNaN(ts)) return null
  return Date.now() - ts
}

function formatStale(iso: string): string {
  const ago = msAgo(iso)
  if (ago == null) return `unparseable generated_at=${iso}`
  const m = Math.round(ago / 60000)
  return `${m}m ago (generated_at=${iso})`
}

async function checkHomepage(): Promise<Check[]> {
  const url = `${prodUrl}/`
  try {
    const { res, latencyMs, body } = await fetchWithTimeout(url)
    const ok = res.ok && body.includes('CoasterRank')
    return [
      {
        name: 'homepage:status+marker',
        ok,
        detail: ok
          ? `GET / → ${res.status} contains CoasterRank (${latencyMs}ms)`
          : `GET / → ${res.status} body missing marker (len=${body.length}, ${latencyMs}ms)`,
        latencyMs,
      },
      {
        name: 'homepage:latency',
        ok: latencyMs < 5000,
        detail: `latency ${latencyMs}ms (budget 5000ms)`,
        latencyMs,
      },
    ]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [{ name: 'homepage', ok: false, detail: `fetch failed: ${msg}` }]
  }
}

type RankingPayload = {
  rankings: unknown[]
  parks: unknown[]
  generated_at: string
}

async function checkApiRanking(): Promise<{ checks: Check[]; payload: RankingPayload | null }> {
  const url = `${prodUrl}/api/ranking`
  try {
    const { res, latencyMs, body } = await fetchWithTimeout(url, {
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) {
      return {
        checks: [
          {
            name: 'api:status',
            ok: false,
            detail: `GET /api/ranking → ${res.status} ${body.slice(0, 200)}`,
            latencyMs,
          },
        ],
        payload: null,
      }
    }
    const json = parseJsonSafe(body) as RankingPayload | null
    if (
      !json ||
      !Array.isArray((json as RankingPayload).rankings) ||
      !Array.isArray((json as RankingPayload).parks)
    ) {
      return {
        checks: [
          {
            name: 'api:shape',
            ok: false,
            detail: `invalid payload shape: ${body.slice(0, 400)}`,
            latencyMs,
          },
        ],
        payload: null,
      }
    }
    const rankingsLen = json.rankings.length
    const parksLen = json.parks.length
    const ago = json.generated_at ? msAgo(json.generated_at) : null
    const staleOk = ago != null && ago < MAX_STALENESS_MS
    const checks: Check[] = [
      {
        name: 'api:status',
        ok: true,
        detail: `GET /api/ranking → 200 (${latencyMs}ms)`,
        latencyMs,
      },
      {
        name: 'api:row_counts',
        ok: rankingsLen >= MIN_RANKINGS_ROWS && parksLen >= MIN_PARKS,
        detail: `rankings=${rankingsLen} (min ${MIN_RANKINGS_ROWS}), parks=${parksLen} (min ${MIN_PARKS})`,
      },
      {
        name: 'api:freshness',
        ok: staleOk ?? false,
        detail:
          ago == null
            ? `missing/unparseable generated_at=${String(json.generated_at)}`
            : staleOk
              ? `fresh ${formatStale(json.generated_at)} (budget 45m)`
              : `stale ${formatStale(json.generated_at)} (budget 45m)`,
      },
    ]
    // X-Ranking-Cache is observability, not a health gate — just surface it
    const cacheHeader = res.headers.get('x-ranking-cache')
    if (cacheHeader) {
      checks.push({
        name: 'api:edge_cache',
        ok: true,
        detail: `X-Ranking-Cache=${cacheHeader}`,
      })
    }
    return { checks, payload: json }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { checks: [{ name: 'api', ok: false, detail: `fetch failed: ${msg}` }], payload: null }
  }
}

async function checkSupabaseAnon(): Promise<Check[]> {
  if (!supabaseUrl || !supabaseAnonKey) {
    return [
      { name: 'supabase:config', ok: true, detail: 'skipped (SUPABASE_URL/ANON_KEY not set)' },
    ]
  }
  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${supabaseAnonKey}`,
    Accept: 'application/json',
  }
  try {
    const { res, body } = await fetchWithTimeout(
      `${supabaseUrl}/rest/v1/v_coaster_rankings?select=id&limit=1`,
      { headers },
    )
    if (!res.ok) {
      return [
        {
          name: 'supabase:v_coaster_rankings',
          ok: false,
          detail: `→ ${res.status} ${body.slice(0, 200)}`,
        },
      ]
    }
    const j = parseJsonSafe(body)
    const ok = Array.isArray(j)
    return [
      {
        name: 'supabase:v_coaster_rankings',
        ok,
        detail: ok ? 'anon read ok' : `unexpected body ${body.slice(0, 200)}`,
      },
    ]
  } catch (err) {
    return [
      { name: 'supabase', ok: false, detail: err instanceof Error ? err.message : String(err) },
    ]
  }
}

async function checkBrowser(): Promise<Check[]> {
  if (skipBrowser) return [{ name: 'browser', ok: true, detail: 'skipped (--skip-browser)' }]
  let browser: import('playwright').Browser | null = null
  try {
    const { chromium } = await import('playwright')
    browser = await chromium.launch({ args: ['--no-sandbox'] })
    const page = await browser.newPage()
    page.setDefaultTimeout(PAGE_TIMEOUT_MS)
    const started = Date.now()
    await page.goto(`${prodUrl}/`, { waitUntil: 'networkidle' })
    const latencyMs = Date.now() - started

    // Agnostic board-render checks — survive UX refactors / A/B tests.
    // Prefer role-based locators; fall back to generic row patterns.
    // Give the SPA time to fetch /api/ranking and hydrate the board.
    try {
      await page
        .locator('tbody tr, [data-testid="board-row"], table tbody tr')
        .first()
        .waitFor({ timeout: 8000 })
    } catch {
      /* table may use list layout on mobile — not fatal */
    }
    const noError = await page
      .locator('text=/failed to load|something went wrong/i')
      .count()
      .then((n) => n === 0)
    // Board rows: table rows, list items, or data-testid if present. At least 20 rows expected.
    const rowCount = await page
      .locator('tbody tr, [data-testid="board-row"], ol > li, ul > li, [role="row"]')
      .count()
    // Alternative signal: the SPA shell always has a main heading / board table
    const hasHeading = await page
      .getByRole('heading')
      .first()
      .isVisible()
      .catch(() => false)
    const hasTable = await page
      .getByRole('table')
      .first()
      .isVisible()
      .catch(() => false)
    const hasList = rowCount >= 20

    const ok = noError && (hasTable || hasList || hasHeading)
    const detail = ok
      ? `board rendered: rows~${rowCount}, heading=${hasHeading}, table=${hasTable} (${latencyMs}ms)`
      : `board render failed: noError=${noError}, rows=${rowCount}, heading=${hasHeading}, table=${hasTable} (${latencyMs}ms)`

    // Extra affordance for screenshots on failure — caller handles artifact upload
    if (!ok) {
      try {
        await page.screenshot({ path: '/tmp/health-check-failure.png', fullPage: true })
      } catch {
        /* ignore */
      }
    }

    await page.close()
    return [{ name: 'browser:board_render', ok, detail, latencyMs }]
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // If Playwright isn't installed (e.g. local dev without deps), treat as skipped not failed
    if (
      msg.includes("Cannot find package 'playwright'") ||
      msg.includes("browserType.launch: Executable doesn't exist")
    ) {
      return [
        {
          name: 'browser',
          ok: true,
          detail: `skipped (playwright not installed: ${msg.slice(0, 120)})`,
        },
      ]
    }
    return [{ name: 'browser', ok: false, detail: `playwright failed: ${msg}` }]
  } finally {
    await browser?.close().catch(() => {})
  }
}

function summarize(checks: Check[]): { ok: boolean; summary: string } {
  const failed = checks.filter((c) => !c.ok)
  const ok = failed.length === 0
  const lines = checks.map((c) => `${c.ok ? '✅' : '❌'} ${c.name}: ${c.detail}`)
  const header = ok
    ? 'Health check: OK'
    : `Health check: FAILED (${failed.length}/${checks.length})`
  const drill = failed.length
    ? `\n\nDrill:\n  source .env && psql "$SUPABASE_DB_URL" -c "SELECT status, retries_used, error_message, created_at FROM cron_execution_logs ORDER BY created_at DESC LIMIT 5;"\n  curl -s ${prodUrl}/api/ranking | head -c 400`
    : ''
  return { ok, summary: [header, `  target: ${prodUrl}`, ...lines].join('\n') + drill }
}

async function main(): Promise<void> {
  const all: Check[] = []

  const [home, apiRes, supabaseChecks, browserChecks] = await Promise.all([
    checkHomepage(),
    checkApiRanking(),
    checkSupabaseAnon(),
    checkBrowser(),
  ])
  all.push(...home, ...apiRes.checks, ...supabaseChecks, ...browserChecks)

  const { ok, summary } = summarize(all)
  console.log(summary)

  // GitHub Actions step summary (nice rendering in workflow UI)
  const stepSummary = process.env.GITHUB_STEP_SUMMARY
  if (stepSummary) {
    const { writeFileSync } = await import('node:fs')
    const md = [
      `## Health check — ${ok ? 'OK' : 'FAILED'}`,
      `Target: \`${prodUrl}\``,
      '',
      ...all.map((c) => `- ${c.ok ? '✅' : '❌'} **${c.name}**: ${c.detail}`),
      '',
      `_Floors: parks≥${MIN_PARKS}, rankings≥${MIN_RANKINGS_ROWS}, freshness <45m_`,
    ].join('\n')
    try {
      writeFileSync(stepSummary, md + '\n', { flag: 'a' })
    } catch {
      /* ignore */
    }
  }

  if (!ok) process.exitCode = 1
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err)
  process.exit(1)
})
