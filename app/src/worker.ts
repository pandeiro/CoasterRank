/**
 * Cloudflare Worker — unified project with static assets.
 *
 * Route handling:
 *  - `/api/ranking` → the global board dataset (rankings + parks) as JSON,
 *    served from the edge cache (Cache API, 15-minute TTL — mirrors the
 *    pg_cron recompute cadence; worst-case staleness ≤ 30 min). Supabase is
 *    only hit on cache misses, so homepage loads skip Supabase entirely.
 *    GET/OPTIONS only, CORS allowlist-reflected; upstream failures return
 *    502 (the SPA falls back to direct Supabase queries on any non-OK).
 *  - `/riders/:username` + social-crawler User-Agent → prerendered HTML with
 *    full OG/Twitter meta tags (most link-unfurling crawlers don't execute
 *    JS, so the SPA shell would otherwise unfurl as a bare "CoasterRank").
 *    Humans on the same URL fall through to static assets (the SPA).
 *  - Everything else → static assets directly (no Worker cost).
 *
 * Data comes from the same public PostgREST surfaces the SPA uses (anon key;
 * RLS-equivalent privacy enforced server-side — the rider RPC only returns
 * opted-in riders). NULL result → shared "not found" HTML, so
 * private/unknown usernames are indistinguishable.
 *
 * Runtime env: SUPABASE_URL / SUPABASE_ANON_KEY, falling back to the
 * VITE_-prefixed names already configured in the Cloudflare dashboard.
 */

import type { RankingBoardPayload } from './lib/board-types'

export interface Env {
  ASSETS: { fetch(request: Request): Promise<Response> }
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
}

// Link-unfurling crawlers known to skip JS. iMessage/Apple Messages uses a
// generic Safari WebKit UA with no bot marker — known limitation, documented
// in the PR; those unfurls show the SPA's default title. `reddit/` matches
// Reddit's "Mozilla/5.0 (compatible; Reddit/1.0; …)" preview fetcher as well
// as "redditbot/…".
const BOT_UA_RE =
  /facebookexternalhit|facebot|twitterbot|slackbot|linkedinbot|discordbot|whatsapp|telegrambot|applebot|googlebot|bingbot|embedly|quora link preview|outbrain|vkshare|pinterestbot|rogerbot|redditbot|reddit\//i

// Mirrors USERNAME_RE (client) + the DB's case-insensitive lookup.
const RIDER_PATH_RE = /^\/riders\/([A-Za-z0-9_]{3,20})\/?$/

export type WorkerRiderProfile = {
  username: string
  display_name: string | null
  avatar_url: string | null
  og_image_url: string | null
  member_since: string | null
}

export type WorkerRiderRide = {
  coaster_id: string
  rank: number
  name: string
  slug: string
  material: string
  status: string
  park_name: string | null
  park_slug: string | null
  score: number | null
}

export type WorkerRiderPage = {
  profile: WorkerRiderProfile
  rides: WorkerRiderRide[]
}

export function isSocialCrawler(userAgent: string | null): boolean {
  return BOT_UA_RE.test(userAgent ?? '')
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Inline brand palette (mirrors app/src/index.css) — the prerendered page
// carries no external CSS so it renders instantly for crawlers and previews.
const CSS = `
  body{margin:0;background:#FEFCF3;color:#1A1A2E;font-family:Inter,system-ui,sans-serif}
  .wrap{max-width:44rem;margin:0 auto;padding:2rem 1.25rem}
  .card{background:#fff;border:1px solid #E0DBD1;border-radius:1rem;padding:1.5rem;display:flex;gap:1rem;align-items:center}
  .avatar{width:4.5rem;height:4.5rem;border-radius:9999px;object-fit:cover}
  .eyebrow{font-size:.7rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#159AB8;margin:0}
  h1{font-size:1.9rem;margin:.25rem 0 0;font-weight:400}
  .meta{color:#4A4A5A;font-size:.875rem;margin:.35rem 0 0}
  ol{list-style:none;padding:0;margin:1.25rem 0}
  li{display:flex;gap:.75rem;align-items:center;background:#fff;border:1px solid #E0DBD1;border-radius:.75rem;padding:.75rem 1rem;margin-bottom:.5rem}
  li.top{border-color:#E85D75}
  .rank{font-size:1.5rem;color:#4A4A5A;min-width:2rem;text-align:center}
  li.top .rank{color:#E85D75}
  .name{font-weight:600}
  .park{color:#4A4A5A;font-size:.75rem;margin-left:.5rem}
  .cta{background:#E85D75;color:#fff;text-decoration:none;border-radius:9999px;padding:.65rem 1.25rem;font-size:.875rem;display:inline-block;margin-top:.5rem}
  footer{margin-top:2rem;text-align:center;color:#4A4A5A;font-size:.8rem}
`

export function riderMeta(data: WorkerRiderPage, origin: string, path: string) {
  const displayName = data.profile.display_name || data.profile.username
  const title = `${displayName} (@${data.profile.username}) — CoasterRank`
  const top = data.rides[0]
  const description =
    data.rides.length > 0
      ? `${data.rides.length} coaster${data.rides.length === 1 ? '' : 's'} ranked · #1: ${top?.name ?? ''} · See ${displayName}'s full coaster ranking on CoasterRank.`
      : `See ${displayName}'s coaster ranking on CoasterRank.`
  return {
    title,
    description,
    url: `${origin}${path}`,
    // Per-rider card generated client-side when available, else the static
    // brand card.
    image: data.profile.og_image_url || `${origin}/og-default.png`,
  }
}

export function renderRiderHtml(data: WorkerRiderPage, origin: string, path: string): string {
  const { title, description, url, image } = riderMeta(data, origin, path)
  const displayName = data.profile.display_name || data.profile.username
  const memberYear = data.profile.member_since?.slice(0, 4)

  const listItems = data.rides
    .slice(0, 10)
    .map(
      (ride) => `<li class="${ride.rank <= 3 ? 'top' : ''}">
        <span class="rank">${ride.rank}</span>
        <span class="name">${escapeHtml(ride.name)}</span>
        ${ride.park_name ? `<span class="park">${escapeHtml(ride.park_name)}</span>` : ''}
      </li>`,
    )
    .join('\n')
  const moreCount = data.rides.length - 10

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="CoasterRank">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="profile:username" content="${escapeHtml(data.profile.username)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    ${data.profile.avatar_url ? `<img class="avatar" src="${escapeHtml(data.profile.avatar_url)}" alt="">` : ''}
    <div>
      <p class="eyebrow">Rider ranking</p>
      <h1>${escapeHtml(displayName)}</h1>
      <p class="meta">@${escapeHtml(data.profile.username)}${memberYear ? ` · member since ${memberYear}` : ''} · ${data.rides.length} ranked</p>
    </div>
  </div>
  ${data.rides.length > 0 ? `<ol>${listItems}</ol>${moreCount > 0 ? `<p class="meta">…and ${moreCount} more on the full page.</p>` : ''}` : '<p class="meta">No coasters ranked yet.</p>'}
  <footer>
    <a class="cta" href="${escapeHtml(url)}">See the full ranking</a>
    <p>Rank your own coasters at <a href="${escapeHtml(origin)}">CoasterRank</a>.</p>
  </footer>
</div>
</body>
</html>`
}

export function renderRiderNotFoundHtml(origin: string): string {
  const title = 'Rider not found — CoasterRank'
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="robots" content="noindex">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:site_name" content="CoasterRank">
<meta property="og:url" content="${escapeHtml(origin)}">
<meta name="twitter:card" content="summary">
</head>
<body style="margin:0;background:#FEFCF3;color:#1A1A2E;font-family:Inter,system-ui,sans-serif">
<p style="max-width:44rem;margin:20vh auto 0;padding:0 1.25rem;color:#4A4A5A">
  This rider page doesn't exist or isn't shared.
  <a href="${escapeHtml(origin)}" style="color:#1A1A2E">Back to CoasterRank</a>
</p>
</body>
</html>`
}

async function fetchRiderPageFromSupabase(
  username: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<WorkerRiderPage | null> {
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/public_rider_page`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_username: username }),
  })
  if (!response.ok) {
    // Transport/infra failure, not "user unknown": throw so the handler
    // degrades to the SPA shell instead of claiming the page doesn't exist.
    throw new Error(`public_rider_page failed: ${response.status}`)
  }
  return (await response.json()) as WorkerRiderPage | null
}

// /api/ranking — edge-cached board payload ----------------------------------

// Edge TTL mirrors the pg_cron recompute cadence (every 15 min): worst-case
// staleness is edge TTL + recompute period (≤ 30 min, accepted — BT scores
// move glacially). The browser TTL stays short so reloads revalidate against
// the (cheap, same-colo) edge cache instead of skipping it.
const RANKING_EDGE_TTL_SECONDS = 900
const RANKING_BROWSER_TTL_SECONDS = 60
// Bound upstream reads so a hung Supabase can't pile up in-flight requests
// during a spike; a timeout surfaces as 502 → client falls back to Supabase.
const RANKING_UPSTREAM_TIMEOUT_MS = 10_000

// The SPA calls this same-origin, so CORS is a formality — the explicit
// allowlist keeps the endpoint from being embedded cross-origin while still
// permitting local development against production.
const RANKING_ALLOWED_ORIGINS = new Set([
  'https://coasterrank.app',
  'https://www.coasterrank.app',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
])

type EdgeCache = {
  match(key: Request | string): Promise<Response | undefined>
  put(key: Request | string, response: Response): Promise<void>
}

// `caches.default` exists in the Workers runtime; absent in unit tests and
// other runtimes — the endpoint still works there, just uncached.
function getEdgeCache(): EdgeCache | undefined {
  return (globalThis as { caches?: { default?: EdgeCache } }).caches?.default
}

// Canonical cache key: one entry regardless of query-string noise, so `?x=1`
// variants can't fragment the cache.
function rankingCacheKey(requestUrl: string): Request {
  const keyUrl = new URL(requestUrl)
  keyUrl.search = ''
  keyUrl.hash = ''
  return new Request(keyUrl.toString(), { method: 'GET' })
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin')
  return origin && RANKING_ALLOWED_ORIGINS.has(origin)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {}
}

function rankingJsonResponse(
  body: string,
  status: number,
  request: Request,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request),
      ...extraHeaders,
    },
  })
}

async function fetchRankingBoardFromSupabase(env: Env): Promise<RankingBoardPayload | null> {
  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const supabaseKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) return null

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: 'application/json',
  }
  const [rankingsRes, parksRes] = await Promise.all([
    // limit=10000 mirrors the SPA's .range(0, 9999): the view is ~1.2k rows
    // today with headroom for full-RCDB adoption (~6.6k rows).
    fetch(
      `${supabaseUrl}/rest/v1/v_coaster_rankings?select=*&order=score.desc.nullslast&limit=10000`,
      { headers, signal: AbortSignal.timeout(RANKING_UPSTREAM_TIMEOUT_MS) },
    ),
    fetch(
      `${supabaseUrl}/rest/v1/parks?select=id,name,slug,country,region,city&order=name&limit=10000`,
      { headers, signal: AbortSignal.timeout(RANKING_UPSTREAM_TIMEOUT_MS) },
    ),
  ])
  if (!rankingsRes.ok || !parksRes.ok) return null
  const rankings = await rankingsRes.json()
  const parks = await parksRes.json()
  if (!Array.isArray(rankings) || !Array.isArray(parks)) return null
  return { rankings, parks, generated_at: new Date().toISOString() } as RankingBoardPayload
}

export async function handleRankingRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        ...corsHeaders(request),
      },
    })
  }
  if (request.method !== 'GET') {
    return rankingJsonResponse(JSON.stringify({ error: 'Method not allowed' }), 405, request, {
      Allow: 'GET, OPTIONS',
      'Cache-Control': 'no-store',
    })
  }

  const cache = getEdgeCache()
  const cacheKey = rankingCacheKey(request.url)
  if (cache) {
    const hit = await cache.match(cacheKey)
    if (hit) {
      // Rebuild the client-facing response from the cached body rather than
      // returning the edge copy verbatim: the stored response carries the
      // LONG edge TTL, and CORS must be reflected per-request origin.
      const body = await hit.text()
      return rankingJsonResponse(body, 200, request, {
        'Cache-Control': `public, max-age=${RANKING_BROWSER_TTL_SECONDS}`,
        'X-Ranking-Cache': 'HIT',
      })
    }
  }

  const fillStartedAt = Date.now()
  let payload: RankingBoardPayload | null = null
  try {
    payload = await fetchRankingBoardFromSupabase(env)
  } catch {
    payload = null
  }
  if (!payload) {
    // Upstream failure: 502 with no-store. The SPA treats any non-OK as a
    // signal to fall back to direct Supabase queries.
    return rankingJsonResponse(JSON.stringify({ error: 'Upstream unavailable' }), 502, request, {
      'Cache-Control': 'no-store',
    })
  }

  const body = JSON.stringify(payload)
  if (cache) {
    // Edge copy carries the long TTL; separate Response objects (a body can't
    // be shared) so the client-facing copy below can use the short browser TTL.
    try {
      await cache.put(
        cacheKey,
        new Response(body, {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${RANKING_EDGE_TTL_SECONDS}`,
          },
        }),
      )
    } catch (error) {
      // A cache-write failure must not take the endpoint down — serve fresh
      // and let the next request retry the fill.
      console.error('[ranking] cache.put failed:', error)
    }
  }

  // Observability: the hit ratio is near-deterministic (one fill per colo per
  // TTL window), so a log line per fill — not a dashboard — is the useful
  // signal: fill failures, row-count surprises, and fill latency. Visible via
  // Workers Logs (see [observability] in wrangler.toml) and `wrangler tail`.
  console.log(
    `[ranking] cache fill: ${payload.rankings.length} rankings / ${payload.parks.length} parks in ${Date.now() - fillStartedAt}ms`,
  )
  return rankingJsonResponse(body, 200, request, {
    'Cache-Control': `public, max-age=${RANKING_BROWSER_TTL_SECONDS}`,
    'X-Ranking-Cache': cache ? 'MISS' : 'BYPASS',
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'

    if (pathname === '/api/ranking') {
      return handleRankingRequest(request, env)
    }

    const match = RIDER_PATH_RE.exec(url.pathname)

    if (!match || !isSocialCrawler(request.headers.get('user-agent'))) {
      return env.ASSETS.fetch(request)
    }

    const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
    const supabaseKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
      // Env not configured: degrade to the SPA shell rather than erroring.
      return env.ASSETS.fetch(request)
    }

    // Path regex already restricts the charset; normalize case for the RPC.
    const username = match[1].toLowerCase()

    try {
      const data = await fetchRiderPageFromSupabase(username, supabaseUrl, supabaseKey)
      const html = data
        ? renderRiderHtml(data, url.origin, url.pathname)
        : renderRiderNotFoundHtml(url.origin)
      return new Response(html, {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          // Short cache: rankings are live data; also softens RPC load if a
          // link gets a traffic spike after being shared.
          'Cache-Control': 'public, max-age=300',
        },
      })
    } catch {
      // Supabase unreachable: serve the SPA shell rather than an error page.
      return env.ASSETS.fetch(request)
    }
  },
}
