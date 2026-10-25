/**
 * Cloudflare Worker — unified project with static assets.
 *
 * Route handling:
 *  - `/api/ranking` → the global board dataset (rankings + parks) as JSON,
 *    served from the edge cache (Cache API, 5-minute TTL — mirrors the
 *    pg_cron recompute cadence; worst-case staleness ≤ 10 min). Supabase is
 *    only hit on cache misses, so homepage loads skip Supabase entirely.
 *    GET/OPTIONS only, CORS: self-origin reflected, others only via the
 *    RANKING_ALLOWED_ORIGINS var (no domains hard-coded — forks deploy under
 *    their own domain); upstream failures return
 *    502 (the SPA falls back to direct Supabase queries on any non-OK).
 *  - `/riders/:username` + social-crawler User-Agent → prerendered HTML with
 *    full OG/Twitter meta tags (most link-unfurling crawlers don't execute
 *    JS, so the SPA shell would otherwise unfurl as a bare "CoasterRank").
 *    Humans on the same URL fall through to static assets (the SPA).
 *  - `/@username` (vanity alias for sharing) → same prerendered HTML with
 *    og:url/canonical normalized to /riders/:username; humans fall through
 *    to the SPA, which redirects to the canonical route.
 *  - `/riders/:username/og.png` (any User-Agent) → the dynamic 1200×630
 *    share card (rider's current top 5 + summary, SVG → PNG via resvg-wasm),
 *    edge-cached for 5 minutes. This is the og:image the rider HTML points
 *    at; unknown/private riders and all failures degrade to og-default.png.
 *  - `/` + social-crawler User-Agent → static prerendered OG HTML for the
 *    homepage unfurl: the shell only carries og:site_name, so shares of the
 *    base URL would otherwise unfurl with no preview image. Content is
 *    mostly static (the live top 10 prefers the edge-cached /api/ranking
 *    payload, falling back to a direct Supabase top-10 read on a cache miss)
 *    and URLs are computed from the request origin, so forks stay zero-config.
 *    Humans fall through to assets.
 *  - `/about` + `/faq` + search/social-crawler User-Agent → static
 *    prerendered HTML mirroring the SPA pages (same titles, descriptions,
 *    copy, and links — no cloaking: bots see what humans see, just without
 *    needing JS). Humans fall through to assets. These need no Supabase
 *    access, so they serve even with env unconfigured.
 *  - `/coasters/:slug` + `/parks/:slug` → trailing-slash 301s and the
 *    `kennywood-park` rename 301 (any UA); search/social crawlers get a live
 *    prerender (copy + canonical + JSON-LD mirroring the detail pages),
 *    unknown slugs a real 404 + noindex. Supabase failures and missing env
 *    degrade to the SPA shell, never a false 404. Humans fall through to
 *    assets.
 *  - `/llms.txt` (any UA) → LLM-agent digest, markdown per llmstxt.org:
 *    digest + curated links with live catalog counts from the ranking
 *    payload; qualitative wording when Supabase is unavailable (the file
 *    never 404/502s — agents must always get an entry point). Details in
 *    the llms.txt section below.
 *  - `/about/` + `/faq/` (any UA) → 301 to the canonical slash-less form.
 *  - Everything else → static assets directly (no Worker cost).
 *
 *
 * Data comes from the same public PostgREST surfaces the SPA uses (anon key;
 * RLS-equivalent privacy enforced server-side — the rider RPC only returns
 * opted-in riders). NULL result → shared "not found" HTML, so
 * private/unknown usernames are indistinguishable.
 *
 * Runtime env: SUPABASE_URL / SUPABASE_ANON_KEY, falling back to the
 * VITE_-prefixed names already configured in the Cloudflare dashboard.
 */

import type { Park, RankingBoardPayload, RankingRow } from './lib/board-types'
import {
  fetchAvatarDataUri,
  ogImageUrl,
  renderRiderOgPng,
  serveOgImage,
  type OgImageRider,
} from './lib/og-image'
import { truncate } from './lib/truncate'
import { handleSessionsRequest, type SessionsEnv } from './sessions-endpoint'

export interface Env extends SessionsEnv {
  ASSETS: { fetch(request: Request): Promise<Response> }
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  VITE_SUPABASE_URL?: string
  VITE_SUPABASE_ANON_KEY?: string
  /** Optional comma-separated CORS allowlist override (plain var, not secret). */
  RANKING_ALLOWED_ORIGINS?: string
}

const SECURITY_HEADERS: Record<string, string> = {
  // The SPA needs inline styles for its generated HTML and data URLs for the
  // generated default avatar; scripts are same-origin plus the Cloudflare Web
  // Analytics beacon. worker-src blob: — Sentry Replay (replaysOnErrorSampleRate 1.0) spawns its
  // compression worker from a same-origin-created blob URL at startup; without
  // this the worker is blocked on every page load (verified via live CSP test,
  // Sep 2026). font-src data: — KaTeX CSS embeds its fonts as data: URIs, so
  // math disclosures fall back to system fonts without it (same verification).
  // script-src https://static.cloudflareinsights.com — RUM beacon auto-injected
  // by Cloudflare's edge (auto_install); without this the beacon is blocked
  // with a script-src 'self' violation (hit in prod Sep 2026). connect-src
  // https://cloudflareinsights.com — covers the beacon's cross-origin send
  // endpoint (auto-inject posts same-origin to /cdn-cgi/rum, already covered
  // by 'self'; the host entry future-proofs a manual-snippet switch).
  // script-src 'sha256-…' — the UI-mode pre-paint inline script in
  // app/index.html (applies .dark + the dark tab icon before first paint).
  // The hash pins its exact bytes: ANY edit to that script (even whitespace)
  // changes the hash and prod blocks it, so worker.test.ts recomputes the
  // hash from index.html and asserts it matches this string — drift fails
  // loudly in CI instead of flashing in prod.
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' https://static.cloudflareinsights.com 'sha256-LewTQ+yP4jUGtNW+XKoPKeH5+9DC52I3J7PnjrJRwhE='; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://cloudflareinsights.com",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=()',
}

export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value)
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
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
// Dynamic OG image for a rider — served to ANY user-agent (crawlers fetch it
// after reading the HTML meta; humans hit it via in-app previews). Checked
// before the crawler gate below.
const RIDER_OG_PATH_RE = /^\/riders\/([A-Za-z0-9_]{3,20})\/og\.png\/?$/
// /@username vanity alias for the rider page. The alias is for sharing; the
// canonical URL stays /riders/:username, so prerendered HTML for alias hits
// points og:url/canonical at the canonical path.
const RIDER_AT_PATH_RE = /^\/@([A-Za-z0-9_]{3,20})\/?$/

// Shared links are sometimes %-encoded (@ → %40) by chat apps; decode before
// matching. Malformed escapes fall back to the raw value (→ SPA shell).
function tryDecodePathname(pathname: string): string {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return pathname
  }
}

/**
 * Resolves the canonical rider page from a request path: the /riders/:username
 * route and its /@username alias both map to the canonical username + the
 * canonical /riders/:username path. Null when the path is neither (→ SPA).
 */
export function resolveRiderPath(
  pathname: string,
): { username: string; canonicalPath: string } | null {
  const path = tryDecodePathname(pathname).replace(/\/+$/, '') || '/'
  const canonical = RIDER_PATH_RE.exec(path)
  if (canonical) {
    const username = canonical[1].toLowerCase()
    return { username, canonicalPath: `/riders/${username}` }
  }
  const alias = RIDER_AT_PATH_RE.exec(path)
  if (alias) {
    const username = alias[1].toLowerCase()
    return { username, canonicalPath: `/riders/${username}` }
  }
  return null
}

export type WorkerRiderProfile = {
  username: string
  display_name: string | null
  avatar_url: string | null
  /** Legacy client-uploaded card; no longer read — og:image is the dynamic
   * /riders/:username/og.png route. Kept because the RPC still selects it. */
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
  manufacturer_name: string | null
  /** Full lineage; the OG spotlight credits every entry. Optional so a
   * pre-migration RPC payload still typechecks. */
  manufacturer_names?: string[] | null
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
  .section{font-size:.8rem;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:#4A4A5A;margin:1.75rem 0 0}
  .meta a{color:#1A1A2E}
  li .name{text-decoration:none;color:#1A1A2E}
  footer{margin-top:2rem;text-align:center;color:#4A4A5A;font-size:.8rem}
`

export function riderMeta(
  data: WorkerRiderPage,
  origin: string,
  path: string,
  nowMs: number = Date.now(),
) {
  const displayName = data.profile.display_name || data.profile.username
  const title = `${displayName} (@${data.profile.username}) — CoasterRank`
  const topNames = data.rides.slice(0, 3).map((ride) => truncate(ride.name, 40))
  const description =
    data.rides.length > 0
      ? `${data.rides.length} coaster${data.rides.length === 1 ? '' : 's'} ranked · Top: ${topNames.join(' · ')} · See ${displayName}'s full coaster ranking on CoasterRank.`
      : `See ${displayName}'s coaster ranking on CoasterRank.`
  return {
    title,
    description,
    url: `${origin}${path}`,
    // Dynamic edge-rendered card (top 5 + summary, ≤5 min stale — see the
    // og.png route). The ?v= bucket defeats aggressive crawler image caches:
    // each HTML generation points at a fresh image URL while the edge keeps
    // one canonical entry per TTL window.
    image: ogImageUrl(origin, data.profile.username, nowMs),
  }
}

export function renderRiderHtml(
  data: WorkerRiderPage,
  origin: string,
  path: string,
  nowMs: number = Date.now(),
): string {
  const { title, description, url, image } = riderMeta(data, origin, path, nowMs)
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
<meta name="robots" content="noindex">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="CoasterRank">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${escapeHtml(`${displayName}'s top 5 coasters on CoasterRank`)}">
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
    ${data.profile.avatar_url ? `<img class="avatar" src="${escapeHtml(data.profile.avatar_url)}" alt="" width="72" height="72" loading="eager" decoding="async">` : ''}
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

// Base-URL unfurl (/) — static prerendered OG HTML ---------------------------
// The SPA shell's static head only carries og:site_name (og:image must be an
// absolute URL and the deployment domain isn't known at build time — forks
// deploy under their own domains), so link previews of the base URL fell
// back to title + description with no image. Crawlers hitting `/` get this
// prerendered card instead; all URLs are computed from the request origin.

// A board entry for the homepage prerender's top-10 list — the minimal shape
// the /api/ranking payload already carries (rankings arrive in BT-score
// order, so callers slice the first 10 without re-sorting).
export type HomeTopCoaster = {
  name: string
  slug: string
  park_name: string | null
}

export function homeMeta(origin: string) {
  const title = 'CoasterRank — A live ranking of the world’s roller coasters'
  const description =
    "Rank the coasters you've ridden and get your own shareable ranking page. Live community board computed with a Bradley-Terry model."
  return {
    title,
    description,
    url: `${origin}/`,
    image: `${origin}/og-default.png`,
  }
}

export function renderHomeHtml(origin: string, top: HomeTopCoaster[] = []): string {
  const { title, description, url, image } = homeMeta(origin)
  const topItems = top
    .slice(0, 10)
    .map(
      (coaster, index) => `<li>
        <span class="rank">${index + 1}</span>
        <span><a class="name" href="${escapeHtml(`${origin}/coasters/${coaster.slug}`)}">${escapeHtml(coaster.name)}</a>${
          coaster.park_name ? `<span class="park">${escapeHtml(coaster.park_name)}</span>` : ''
        }</span>
      </li>`,
    )
    .join('\n')
  // WebSite always; the live top 10 rides as an ItemList so crawlers see the
  // board's shape (positions link at the matching coaster URLs). Positions are
  // the payload's BT-score order at prerender time.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'CoasterRank',
    url: `${origin}/`,
    description,
    ...(top.length > 0
      ? {
          mainEntity: {
            '@type': 'ItemList',
            name: 'Top roller coasters',
            itemListElement: top.slice(0, 10).map((coaster, index) => ({
              '@type': 'ListItem',
              position: index + 1,
              url: `${origin}/coasters/${coaster.slug}`,
              name: coaster.park_name ? `${coaster.name} at ${coaster.park_name}` : coaster.name,
            })),
          },
        }
      : {}),
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CoasterRank">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="CoasterRank — the live community board with the current top 4 coasters">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div>
      <p class="eyebrow">Live community ranking</p>
      <h1>CoasterRank</h1>
      <p class="meta">Rank the coasters you've ridden — drag-sort your list and the community board updates. Every list feeds a Bradley–Terry refit of the whole board, recomputed every 5 minutes.</p>
    </div>
  </div>
  ${topItems ? `<h2 class="section">Topping the board right now</h2><ol>${topItems}</ol>` : ''}
  <p class="meta"><a href="${escapeHtml(`${origin}/about`)}">How the ranking works</a> · <a href="${escapeHtml(`${origin}/faq`)}">FAQ</a></p>
  <footer>
    <a class="cta" href="${escapeHtml(url)}">See the live board</a>
    <p>Bradley–Terry scored · recomputed every 5 minutes.</p>
  </footer>
</div>
</body>
</html>`
}

// /about + /faq — search-engine prerenders ----------------------------------
// The SPA shell carries none of these pages' content without JS, so crawlers
// (especially non-Google ones with weak JS rendering) index thin shells.
// These static builders mirror the React pages' titles, meta descriptions,
// copy, and links one-to-one — bots see exactly what humans see, pre-JS.
// Keep them in sync with app/src/pages/AboutPage.tsx and FaqPage.tsx when
// that copy changes (titles/descriptions/JSON-LD must match the Helmet tags).

export function aboutMeta(origin: string) {
  return {
    title: 'About — CoasterRank',
    description:
      'What CoasterRank is, how the live Bradley-Terry ranking works, and our commitments: always free, no ads, open source and open data.',
    url: `${origin}/about`,
  }
}

export function renderAboutHtml(origin: string): string {
  const { title, description, url } = aboutMeta(origin)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: 'CoasterRank',
    url: `${origin}/`,
    logo: `${origin}/logo.svg`,
    sameAs: ['https://github.com/pandeiro/CoasterRank'],
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CoasterRank">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div>
      <p class="eyebrow">About</p>
      <h1>CoasterRank</h1>
      <p class="meta">CoasterRank is a free, open-source leaderboard for roller coasters, built from the rankings of the people who ride them.</p>
    </div>
  </div>
  <h2 class="section">Our purpose</h2>
  <p class="meta">Our goal is to turn the community's collective experience into a useful, shared resource: a place to discover coasters, compare favorites, and contribute your own perspective throughout the year.</p>
  <p class="meta">Rank the coasters you've ridden from best to worst, share your personal list, and help shape the public leaderboard. You can browse the community rankings without an account, and riders with a handful of coasters are as welcome as lifelong enthusiasts.</p>
  <h2 class="section">How the ranking works</h2>
  <p class="meta">Your ordered list provides a set of head-to-head preferences: each coaster is preferred to every coaster below it. These comparisons let us combine different riders' lists without asking everyone to agree on a rating scale.</p>
  <p class="meta"><a href="https://en.wikipedia.org/wiki/Bradley%E2%80%93Terry_model">Bradley-Terry</a> (BT) is the statistical model we use to turn those comparisons into a strength score for each coaster. It estimates how consistently a coaster is preferred to others, taking into account the strength of the coasters it is compared with.</p>
  <p class="meta">Longer lists contain many more comparisons, so we weight each rider's contribution to balance that effect. The board is recalculated regularly as riders update their lists. Scores are shown on an index where 100 is the community average — anything above it was preferred more often.</p>
  <h2 class="section">Our commitments</h2>
  <p class="meta">Free access. Browsing the leaderboard and creating your own rankings are free. There are no ads or paid ranking placements.</p>
  <p class="meta">An open method. We publish the ranking code and explain how contributions are weighted, so anyone can examine the method, question the results, or propose improvements.</p>
  <p class="meta">Respect for your information. We do not sell your personal information. Your rankings and contributions are public; our <a href="${escapeHtml(`${origin}/privacy`)}">privacy policy</a> explains what we collect, how it is used, and your options for managing it.</p>
  <p class="meta">A shared resource. The application code is MIT-licensed, the seed catalog is public-domain data, and community contributions are licensed under CC BY 4.0.</p>
  <h2 class="section">Contribute</h2>
  <p class="meta">CoasterRank is <a href="https://github.com/pandeiro/CoasterRank">open source on GitHub</a>. Code contributions, bug reports, and feedback on the ranking method are welcome. You can also help directly through the app: <a href="${escapeHtml(`${origin}/submit`)}">submit a missing coaster</a> or rank the coasters you've ridden.</p>
  <h2 class="section">Origins</h2>
  <p class="meta">CoasterRank grew out of an appreciation for the enthusiast community, including <a href="https://aceonline.org/">ACE</a> and ranking projects such as <a href="https://votecoasters.com/">VoteCoasters</a>. In that spirit, CoasterRank is a year-round ranking that riders can contribute to whenever they choose. The project is maintained by CoasterRank Contributors.</p>
  <footer>
    <a class="cta" href="${escapeHtml(`${origin}/faq`)}">More questions? Read the FAQ</a>
    <p>Rank your own coasters at <a href="${escapeHtml(origin)}">CoasterRank</a>.</p>
  </footer>
</div>
</body>
</html>`
}

// Plain-text Q&A mirrors of FaqPage.tsx QUESTIONS (links flattened) — the
// page keeps JSX + text side by side so they can't drift; update both here
// and there together.
const FAQ_ITEMS: Array<{ q: string; text: string }> = [
  {
    q: 'Why head-to-head instead of star ratings?',
    text: "Star averages are easy to inflate, and everyone rates on a different scale — one rider's 8 is another's 10. Head-to-head results only ask which rode higher, so they compare cleanly across thousands of riders with different tastes and different strictness.",
  },
  {
    q: 'How do I add my rankings?',
    text: "Create an account, add the coasters you've ridden, then drag them into your own best-to-worst order. Everything saves as you go, and your list feeds the board automatically. You don't need hundreds of credits — rank whatever you've actually ridden, even if it's five.",
  },
  {
    q: 'What do the scores mean?',
    text: "They're Bradley-Terry strength scores on an index where 100 is the community average: a coaster at 112 rode higher than average more often, one at 93 rode lower. See the About page's How the ranking works section for the plain-English version.",
  },
  {
    q: 'Why is my favorite coaster ranked low?',
    text: 'The board reflects every rider, not any single list — disagreement is the point. Coasters with a few-votes badge have especially provisional scores, so the kindest thing you can do for an underrated gem is keep ranking it.',
  },
  {
    q: 'A coaster is missing — or the data is wrong.',
    text: 'Missing coasters can be submitted via the Submit page. Spotted an error on a coaster — a wrong stat, park, or manufacturer? Use the See something wrong? Suggest an edit link on that coaster’s page. For anything else, open an issue on GitHub or email coaster.rank.app@gmail.com.',
  },
  {
    q: 'How often do the rankings update?',
    text: 'The board is recalculated on a regular schedule as riders update their lists, with some caching to handle surges, so your changes generally show up within minutes.',
  },
  {
    q: 'Can I use the rankings or data in my own project?',
    text: 'Yes. The code is MIT-licensed on GitHub, and community-contributed data is CC BY 4.0 — attribute CoasterRank and go ride with it.',
  },
  {
    q: 'Who runs this?',
    text: 'CoasterRank is maintained by CoasterRank Contributors as a free, open-source project. There are no ads and we do not sell personal information. Contributions of code, data corrections, rankings, and feedback are all welcome.',
  },
]

export function faqMeta(origin: string) {
  return {
    title: 'FAQ — CoasterRank',
    description:
      'How CoasterRank works: head-to-head rankings, Bradley-Terry scores, adding your list, missing coasters, reusing the data, and who runs it.',
    url: `${origin}/faq`,
  }
}

export function renderFaqHtml(origin: string): string {
  const { title, description, url } = faqMeta(origin)
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: FAQ_ITEMS.map(({ q, text }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text },
    })),
  }
  const items = FAQ_ITEMS.map(
    ({ q, text }) =>
      `<h2 class="section">${escapeHtml(q)}</h2>\n  <p class="meta">${escapeHtml(text)}</p>`,
  ).join('\n  ')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CoasterRank">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div>
      <p class="eyebrow">FAQ</p>
      <h1>FAQ</h1>
      <p class="meta">${escapeHtml(description)}</p>
    </div>
  </div>
  ${items}
  <footer>
    <a class="cta" href="${escapeHtml(`${origin}/about`)}">How the ranking works</a>
    <p>Rank your own coasters at <a href="${escapeHtml(origin)}">CoasterRank</a>.</p>
  </footer>
</div>
</body>
</html>`
}

// /coasters/:slug + /parks/:slug — search-engine prerenders ------------------
// Every detail URL served the byte-identical SPA shell without JS, so
// Google's first-pass index saw ~1,800 duplicate pages with no canonical
// ("Duplicate without user-selected canonical", Oct 2026). Bots now get
// server-rendered copy + canonical + JSON-LD mirroring the React pages'
// Helmet tags one-to-one (titles, descriptions, entities) — same content
// humans see, just without needing JS. Keep in sync with
// CoasterDetailPage.tsx (buildMetaDescription/buildJsonLd) and
// ParkDetailPage.tsx when that copy changes.

const COASTER_PATH_RE = /^\/coasters\/([A-Za-z0-9-]+)\/?$/
const PARK_PATH_RE = /^\/parks\/([A-Za-z0-9-]+)\/?$/

// Renamed slugs redirect permanently (any UA — humans on the old URL deserve
// the new page too, not the SPA's "not found" state). Unknown slugs 404 for
// bots; humans keep the SPA shell (whose not-found branch carries a client
// noindex — see the detail pages).
const RENAMED_PARK_SLUGS: Record<string, string> = {
  // Park renamed after launch; the old slug still circulates in GSC + links.
  'kennywood-park': 'kennywood',
}

export type WorkerParkCoaster = {
  name: string
  slug: string
  rank: number | null
  score: number | null
}

export type WorkerParkDetail = {
  park: Park
  coasters: WorkerParkCoaster[]
}

// Mirrors lib/coasters.ts (worker-safe copies — the worker bundle can't
// import client modules; keep these byte-identical in behavior).
function workerCapitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ')
}

function workerFormatScore(score: number): string {
  return (score * 100).toFixed(1)
}

function workerLineageNames(
  row: Pick<RankingRow, 'manufacturer_names' | 'manufacturer_name'>,
): string[] {
  if (row.manufacturer_names && row.manufacturer_names.length > 0) {
    return row.manufacturer_names.filter((n): n is string => Boolean(n))
  }
  return row.manufacturer_name ? [row.manufacturer_name] : []
}

// Mirrors buildMetaDescription in CoasterDetailPage.tsx.
export function coasterMeta(coaster: RankingRow, origin: string) {
  const location = [coaster.park_city, coaster.park_country].filter(Boolean).join(', ')
  const title = coaster.park_name
    ? `${coaster.name} at ${coaster.park_name} — CoasterRank`
    : `${coaster.name} — CoasterRank`
  const parkBit = coaster.park_name ? ` at ${coaster.park_name}` : ''
  const locationBit = location ? ` (${location})` : ''
  const standingBit =
    coaster.rank !== null && coaster.score !== null && coaster.comparisons !== null
      ? ` — ranked #${coaster.rank} on CoasterRank with a ${workerFormatScore(coaster.score)} community score across ${coaster.comparisons} comparisons.`
      : ' — not yet ranked on CoasterRank.'
  const statBits = [
    coaster.height_m !== null ? `${coaster.height_m} m tall` : null,
    coaster.speed_kmh !== null ? `${coaster.speed_kmh} km/h` : null,
    coaster.length_m !== null ? `${coaster.length_m} m long` : null,
    coaster.inversions !== null
      ? `${coaster.inversions} inversion${coaster.inversions === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean)
  const statsBit = statBits.length > 0 ? ` ${statBits.join(' · ')}.` : ''
  return {
    title,
    description: `${coaster.name}${parkBit}${locationBit}${standingBit}${statsBit}`,
    url: `${origin}/coasters/${coaster.slug}`,
  }
}

// Mirrors buildJsonLd in CoasterDetailPage.tsx.
export function coasterJsonLd(coaster: RankingRow, pageUrl: string, metaDescription: string) {
  const specs: Array<{ '@type': 'PropertyValue'; name: string; value: string }> = []
  const trackLabel = coaster.model ?? coaster.type
  if (trackLabel) specs.push({ '@type': 'PropertyValue', name: 'track', value: trackLabel })
  specs.push({
    '@type': 'PropertyValue',
    name: 'material',
    value: workerCapitalize(coaster.material),
  })
  specs.push({ '@type': 'PropertyValue', name: 'status', value: workerCapitalize(coaster.status) })
  if (coaster.height_m !== null)
    specs.push({ '@type': 'PropertyValue', name: 'height', value: `${coaster.height_m} m` })
  if (coaster.speed_kmh !== null)
    specs.push({ '@type': 'PropertyValue', name: 'speed', value: `${coaster.speed_kmh} km/h` })
  if (coaster.length_m !== null)
    specs.push({ '@type': 'PropertyValue', name: 'length', value: `${coaster.length_m} m` })
  if (coaster.inversions !== null)
    specs.push({
      '@type': 'PropertyValue',
      name: 'inversions',
      value: String(coaster.inversions),
    })
  if (coaster.rank !== null)
    specs.push({ '@type': 'PropertyValue', name: 'communityRank', value: String(coaster.rank) })
  if (coaster.score !== null)
    specs.push({
      '@type': 'PropertyValue',
      name: 'communityScore',
      value: workerFormatScore(coaster.score),
    })
  if (coaster.comparisons !== null)
    specs.push({
      '@type': 'PropertyValue',
      name: 'comparisons',
      value: String(coaster.comparisons),
    })

  return {
    '@context': 'https://schema.org',
    '@type': 'RollerCoaster',
    name: coaster.name,
    description: metaDescription,
    url: pageUrl,
    ...(coaster.park_name
      ? {
          containedInPlace: {
            '@type': 'AmusementPark',
            name: coaster.park_name,
            ...(coaster.park_city || coaster.park_country
              ? {
                  address: {
                    '@type': 'PostalAddress',
                    ...(coaster.park_city ? { addressLocality: coaster.park_city } : {}),
                    ...(coaster.park_country ? { addressCountry: coaster.park_country } : {}),
                  },
                }
              : {}),
          },
        }
      : {}),
    ...(coaster.opening_date ? { openingDate: coaster.opening_date } : {}),
    ...(workerLineageNames(coaster).length > 0
      ? {
          manufacturer: workerLineageNames(coaster).map((name) => ({
            '@type': 'Organization',
            name,
          })),
        }
      : {}),
    additionalProperty: specs,
  }
}

export function renderCoasterHtml(coaster: RankingRow, origin: string): string {
  const { title, description, url } = coasterMeta(coaster, origin)
  const jsonLd = coasterJsonLd(coaster, url, description)
  const location = [coaster.park_city, coaster.park_country].filter(Boolean).join(', ')
  const lineage = workerLineageNames(coaster)
  const standing =
    coaster.rank !== null && coaster.score !== null && coaster.comparisons !== null
      ? `Ranked #${coaster.rank} on the community board with a ${workerFormatScore(coaster.score)} score across ${coaster.comparisons} comparisons.`
      : 'Not yet ranked on the community board.'
  const trackLabel = coaster.model ?? coaster.type
  const statBits = [
    coaster.height_m !== null ? `Height ${coaster.height_m} m` : null,
    coaster.speed_kmh !== null ? `Speed ${coaster.speed_kmh} km/h` : null,
    coaster.length_m !== null ? `Length ${coaster.length_m} m` : null,
    coaster.inversions !== null ? `Inversions ${coaster.inversions}` : null,
    trackLabel ? `Track ${trackLabel}` : null,
    `Material ${workerCapitalize(coaster.material)}`,
    `Status ${workerCapitalize(coaster.status)}`,
  ].filter((s): s is string => s !== null)
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="CoasterRank">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div>
      <p class="eyebrow">${coaster.park_name ? `<a href="${escapeHtml(`${origin}/parks/${coaster.park_slug}`)}">${escapeHtml(coaster.park_name)}</a>${location ? ` · ${escapeHtml(location)}` : ''}` : 'Coaster'}</p>
      <h1>${escapeHtml(coaster.name)}</h1>
      <p class="meta">${escapeHtml(standing)}</p>
    </div>
  </div>
  <h2 class="section">Details</h2>
  <p class="meta">${statBits.map(escapeHtml).join(' · ')}</p>
  ${lineage.length > 0 ? `<p class="meta">Built by ${escapeHtml(lineage.join(' · '))}.</p>` : ''}
  ${coaster.aliases && coaster.aliases.length > 0 ? `<p class="meta">Also known as: ${escapeHtml(coaster.aliases.join(' · '))}.</p>` : ''}
  <footer>
    <a class="cta" href="${escapeHtml(url)}">See the live ranking</a>
    <p>Rank your own coasters at <a href="${escapeHtml(origin)}">CoasterRank</a>.</p>
  </footer>
</div>
</body>
</html>`
}

// Mirrors the title/description/JSON-LD in ParkDetailPage.tsx.
export function parkMeta(park: Park, coasters: WorkerParkCoaster[], origin: string) {
  const location = [park.city, park.region, park.country].filter(Boolean).join(' · ')
  const title = `${park.name} — CoasterRank`
  const topCoaster = coasters.find((c) => c.rank !== null)
  const description =
    topCoaster && topCoaster.rank !== null
      ? `${park.name}${location ? ` (${location})` : ''} — ${coasters.length} coaster${coasters.length === 1 ? '' : 's'} ranked by the CoasterRank community. Top: ${topCoaster.name} (#${topCoaster.rank} on the board).`
      : `${park.name}${location ? ` (${location})` : ''} — ${coasters.length} coaster${coasters.length === 1 ? '' : 's'} on CoasterRank. Rank the ones you've ridden.`
  return { title, description, url: `${origin}/parks/${park.slug}` }
}

export function renderParkHtml(detail: WorkerParkDetail, origin: string): string {
  const { park, coasters } = detail
  const { title, description, url } = parkMeta(park, coasters, origin)
  const location = [park.city, park.region, park.country].filter(Boolean).join(' · ')
  const topCoaster = coasters.find((c) => c.rank !== null)
  const listItems = coasters
    .slice(0, 10)
    .map(
      (c) => `<li>
        <span class="rank">${c.rank ?? '–'}</span>
        <span><a class="name" href="${escapeHtml(`${origin}/coasters/${c.slug}`)}">${escapeHtml(c.name)}</a></span>
      </li>`,
    )
    .join('\n')
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'AmusementPark',
    name: park.name,
    url,
    ...(location
      ? {
          address: {
            '@type': 'PostalAddress',
            ...(park.city ? { addressLocality: park.city } : {}),
            ...(park.region ? { addressRegion: park.region } : {}),
            ...(park.country ? { addressCountry: park.country } : {}),
          },
        }
      : {}),
    ...(coasters.length > 0
      ? {
          containsPlace: coasters.slice(0, 10).map((c) => ({
            '@type': 'RollerCoaster',
            name: c.name,
            url: `${origin}/coasters/${c.slug}`,
          })),
        }
      : {}),
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="CoasterRank">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(url)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <div class="card">
    <div>
      <p class="eyebrow">Park</p>
      <h1>${escapeHtml(park.name)}</h1>
      <p class="meta">${location ? `${escapeHtml(location)} · ` : ''}${coasters.length} coaster${coasters.length === 1 ? '' : 's'}</p>
      ${topCoaster && topCoaster.rank !== null ? `<p class="meta">Top coaster here: <a href="${escapeHtml(`${origin}/coasters/${topCoaster.slug}`)}">${escapeHtml(topCoaster.name)}</a> — #${topCoaster.rank} on the board.</p>` : ''}
    </div>
  </div>
  ${listItems ? `<h2 class="section">Coasters at ${escapeHtml(park.name)}</h2><ol>${listItems}</ol>` : '<p class="meta">No coasters from this park on the board yet.</p>'}
  <footer>
    <a class="cta" href="${escapeHtml(url)}">See the park ranking</a>
    <p>Rank your own coasters at <a href="${escapeHtml(origin)}">CoasterRank</a>.</p>
  </footer>
</div>
</body>
</html>`
}

// Unknown detail slug for bots: a real 404 (status + noindex, no canonical)
// so dead URLs leave the index instead of clustering as duplicates or
// soft-404s. Humans keep the SPA shell (client noindex on its not-found
// branch) — a branded in-app message beats a bare edge 404.
export function renderDetailNotFoundHtml(origin: string, kind: 'coaster' | 'park'): string {
  const title =
    kind === 'coaster' ? 'Coaster not found — CoasterRank' : 'Park not found — CoasterRank'
  const message =
    kind === 'coaster'
      ? "This coaster doesn't exist on CoasterRank."
      : "This park doesn't exist on CoasterRank."
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
  ${escapeHtml(message)}
  <a href="${escapeHtml(origin)}" style="color:#1A1A2E">Back to CoasterRank</a>
</p>
</body>
</html>`
}

export function resolveDetailPath(
  rawPathname: string,
): { kind: 'coaster' | 'park'; slug: string; slashed: boolean } | null {
  const coaster = COASTER_PATH_RE.exec(rawPathname)
  if (coaster) return { kind: 'coaster', slug: coaster[1], slashed: rawPathname.endsWith('/') }
  const park = PARK_PATH_RE.exec(rawPathname)
  if (park) return { kind: 'park', slug: park[1], slashed: rawPathname.endsWith('/') }
  return null
}

function supabaseGetHeaders(supabaseKey: string): Record<string, string> {
  return {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    Accept: 'application/json',
  }
}

// NULL = slug unknown (→ 404 for bots); throws = infra failure (→ SPA shell,
// never a false 404). A found-but-malformed row also throws: serving the
// shell is safer than 404ing a real page.
async function fetchCoasterBySlug(
  slug: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<RankingRow | null> {
  const res = await fetch(
    `${supabaseUrl}/rest/v1/v_coaster_rankings?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`,
    {
      headers: supabaseGetHeaders(supabaseKey),
      signal: AbortSignal.timeout(RANKING_UPSTREAM_TIMEOUT_MS),
    },
  )
  if (!res.ok) throw new Error(`coaster lookup failed: ${res.status}`)
  const rows = (await res.json()) as Array<Partial<RankingRow>>
  const row = rows[0]
  if (!row) return null
  if (typeof row.name !== 'string' || typeof row.slug !== 'string') {
    throw new Error('coaster lookup returned a malformed row')
  }
  return row as RankingRow
}

async function fetchParkWithCoasters(
  slug: string,
  supabaseUrl: string,
  supabaseKey: string,
): Promise<WorkerParkDetail | null> {
  const parkRes = await fetch(
    `${supabaseUrl}/rest/v1/parks?select=id,name,slug,country,region,city&slug=eq.${encodeURIComponent(slug)}&limit=1`,
    {
      headers: supabaseGetHeaders(supabaseKey),
      signal: AbortSignal.timeout(RANKING_UPSTREAM_TIMEOUT_MS),
    },
  )
  if (!parkRes.ok) throw new Error(`park lookup failed: ${parkRes.status}`)
  const parks = (await parkRes.json()) as Array<Partial<Park>>
  const park = parks[0]
  if (!park) return null
  if (
    typeof park.id !== 'string' ||
    typeof park.name !== 'string' ||
    typeof park.slug !== 'string'
  ) {
    throw new Error('park lookup returned a malformed row')
  }
  const coastersRes = await fetch(
    `${supabaseUrl}/rest/v1/v_coaster_rankings?select=name,slug,rank,score&park_id=eq.${encodeURIComponent(park.id)}&order=rank.asc.nullslast&limit=100`,
    {
      headers: supabaseGetHeaders(supabaseKey),
      signal: AbortSignal.timeout(RANKING_UPSTREAM_TIMEOUT_MS),
    },
  )
  if (!coastersRes.ok) throw new Error(`park coasters lookup failed: ${coastersRes.status}`)
  const rows = (await coastersRes.json()) as Array<{
    name?: unknown
    slug?: unknown
    rank?: unknown
    score?: unknown
  }>
  if (!Array.isArray(rows)) throw new Error('park coasters lookup returned non-array')
  const coasters: WorkerParkCoaster[] = rows.flatMap((row) => {
    if (typeof row.name !== 'string' || typeof row.slug !== 'string') return []
    return [
      {
        name: row.name,
        slug: row.slug,
        rank: typeof row.rank === 'number' ? row.rank : null,
        score: typeof row.score === 'number' ? row.score : null,
      },
    ]
  })
  return { park: park as Park, coasters }
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

// Edge TTL mirrors the pg_cron recompute cadence (every 5 min): worst-case
// staleness is edge TTL + recompute period (≤ 10 min, accepted — BT scores
// move glacially). The browser TTL stays short so reloads revalidate against
// the (cheap, same-colo) edge cache instead of skipping it.
const RANKING_EDGE_TTL_SECONDS = 300
const RANKING_BROWSER_TTL_SECONDS = 60
// Bound upstream reads so a hung Supabase can't pile up in-flight requests
// during a spike; a timeout surfaces as 502 → client falls back to Supabase.
const RANKING_UPSTREAM_TIMEOUT_MS = 10_000

// CORS policy — zero domains in source (open-source: forks deploy under their
// own domain). Requests from the worker's own origin don't need CORS at all,
// but reflecting it is harmless and keeps the response contract uniform.
// Additional cross-origin consumers (staging, local dev against prod, third
// parties) are enabled via the RANKING_ALLOWED_ORIGINS Worker var
// (comma-separated). Plain var, not a secret: it's configuration, not a
// credential. Everything else is rejected — no cross-origin embedding unless
// explicitly configured.
function isAllowedOrigin(origin: string, request: Request, env: Env): boolean {
  if (origin === new URL(request.url).origin) return true
  return (env.RANKING_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((value) => value.trim())
    .includes(origin)
}

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

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin')
  return origin && isAllowedOrigin(origin, request, env)
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : {}
}

function rankingJsonResponse(
  body: string,
  status: number,
  request: Request,
  env: Env,
  extraHeaders: Record<string, string> = {},
): Response {
  return withSecurityHeaders(
    new Response(body, {
      status,
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders(request, env),
        ...extraHeaders,
      },
    }),
  )
}

// Board meta (user counts + last recompute time) for the homepage.
// Best-effort: an unavailable RPC (deploy-order skew) must never 502 the
// board, so every failure path resolves to nulls instead of throwing.
// ranked_user_count drives the first-place gate (>30); real_user_count the
// status-line users pill (>50).
type BoardMeta = Pick<
  RankingBoardPayload,
  'last_recomputed_at' | 'real_user_count' | 'ranked_user_count'
>

const EMPTY_BOARD_META: BoardMeta = {
  last_recomputed_at: null,
  real_user_count: null,
  ranked_user_count: null,
}

async function fetchBoardMeta(
  supabaseUrl: string,
  headers: Record<string, string>,
): Promise<BoardMeta> {
  try {
    // GET is valid for STABLE RPCs via PostgREST (same as main already did for
    // public_board_meta); Supabase-JS uses POST but this worker historically
    // uses GET — keep GET to avoid churn. If args are ever added, switch to
    // POST with JSON body.
    const res = await fetch(`${supabaseUrl}/rest/v1/rpc/public_board_meta`, {
      headers,
      signal: AbortSignal.timeout(RANKING_UPSTREAM_TIMEOUT_MS),
    })
    if (!res.ok) return EMPTY_BOARD_META
    const payload = (await res.json()) as
      | {
          real_user_count?: number | string
          ranked_user_count?: number | string
          last_recomputed_at?: string | null
        }
      | Array<{
          real_user_count?: number | string
          ranked_user_count?: number | string
          last_recomputed_at?: string | null
        }>
    const row = Array.isArray(payload) ? payload[0] : payload
    if (!row) return EMPTY_BOARD_META
    const toCount = (raw: number | string | undefined | null) => {
      if (raw == null) return null
      const n = Number(raw)
      return Number.isFinite(n) ? n : null
    }
    return {
      last_recomputed_at: row.last_recomputed_at ?? null,
      real_user_count: toCount(row.real_user_count),
      ranked_user_count: toCount(
        // Back-compat while the migration rolls out: old RPC has no
        // ranked_user_count column; treat missing as null (gate closed).
        (row as { ranked_user_count?: number | string }).ranked_user_count,
      ),
    }
  } catch {
    return EMPTY_BOARD_META
  }
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
  const [rankingsRes, parksRes, boardMeta] = await Promise.all([
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
    fetchBoardMeta(supabaseUrl, headers),
  ])
  if (!rankingsRes.ok || !parksRes.ok) return null
  const rankings = await rankingsRes.json()
  const parks = await parksRes.json()
  if (!Array.isArray(rankings) || !Array.isArray(parks)) return null
  return {
    rankings,
    parks,
    generated_at: new Date().toISOString(),
    ...boardMeta,
  } as RankingBoardPayload
}

export async function handleRankingRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Max-Age': '86400',
        ...corsHeaders(request, env),
      },
    })
  }
  if (request.method !== 'GET') {
    return rankingJsonResponse(JSON.stringify({ error: 'Method not allowed' }), 405, request, env, {
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
      return rankingJsonResponse(body, 200, request, env, {
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
    return rankingJsonResponse(
      JSON.stringify({ error: 'Upstream unavailable' }),
      502,
      request,
      env,
      {
        'Cache-Control': 'no-store',
      },
    )
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
  return rankingJsonResponse(body, 200, request, env, {
    'Cache-Control': `public, max-age=${RANKING_BROWSER_TTL_SECONDS}`,
    'X-Ranking-Cache': cache ? 'MISS' : 'BYPASS',
  })
}

// Homepage prerender's live top 10 — read from the edge-cached /api/ranking
// payload (same entry the board endpoint fills) first; on an edge-cache miss
// (the common case in a crawler's colo) fall back to a direct Supabase read
// of the top 10, so search crawlers rarely index the list-less static card.
// Any failure still degrades to the static card: crawlers get full OG meta,
// just without the list. Humans never touch this path (bot-UA branch only),
// so board pageloads are unaffected.
async function readCachedTopCoasters(origin: string, env: Env): Promise<HomeTopCoaster[]> {
  try {
    const cache = getEdgeCache()
    if (cache) {
      const hit = await cache.match(rankingCacheKey(`${origin}/api/ranking`))
      if (hit) {
        const payload = (await hit.json()) as {
          rankings?: Array<{ name?: unknown; slug?: unknown; park_name?: unknown }>
        }
        if (payload && Array.isArray(payload.rankings)) {
          const top = toHomeTopCoasters(payload.rankings)
          if (top.length > 0) return top
        }
      }
    }
  } catch {
    // Fall through to the Supabase read below.
  }
  return fetchTopCoastersFromSupabase(env)
}

function toHomeTopCoasters(
  rankings: Array<{ name?: unknown; slug?: unknown; park_name?: unknown }>,
): HomeTopCoaster[] {
  return rankings.slice(0, 10).flatMap((row) => {
    if (typeof row.name !== 'string' || typeof row.slug !== 'string') return []
    return [
      {
        name: row.name,
        slug: row.slug,
        park_name: typeof row.park_name === 'string' ? row.park_name : null,
      },
    ]
  })
}

// Direct top-10 read for the crawler homepage prerender (edge-cache-miss
// path only — a couple of bot hits per hour at most, never the human board
// traffic). Best-effort: every failure resolves to [] (static card).
async function fetchTopCoastersFromSupabase(env: Env): Promise<HomeTopCoaster[]> {
  try {
    const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
    const supabaseKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) return []
    const res = await fetch(
      `${supabaseUrl}/rest/v1/v_coaster_rankings?select=name,slug,park_name&order=score.desc.nullslast&limit=10`,
      {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(RANKING_UPSTREAM_TIMEOUT_MS),
      },
    )
    if (!res.ok) return []
    const rows = (await res.json()) as Array<{
      name?: unknown
      slug?: unknown
      park_name?: unknown
    }>
    if (!Array.isArray(rows)) return []
    return toHomeTopCoasters(rows)
  } catch {
    return []
  }
}

// /riders/:username/og.png — dynamic share card --------------------------------
// Rendered on demand from the public rider RPC (top 5 + summary) and cached
// at the edge for 5 minutes. Any UA may fetch (crawlers after reading the
// HTML meta, humans via in-app previews). Unknown/private riders and every
// infra failure degrade to the static /og-default.png bytes — never an error
// to crawlers, never a privacy leak.

function memberSinceYear(iso: string | null): string | null {
  if (!iso) return null
  const year = iso.slice(0, 4)
  return /^\d{4}$/.test(year) ? year : null
}

/** Maps the public RPC payload to the OG pipeline input (rides by rank). */
function toOgImageRider(data: WorkerRiderPage): OgImageRider {
  return {
    profile: {
      username: data.profile.username,
      displayName: data.profile.display_name || data.profile.username,
      avatarUrl: data.profile.avatar_url,
      memberSinceYear: memberSinceYear(data.profile.member_since),
    },
    rides: [...data.rides].sort((a, b) => a.rank - b.rank),
  }
}

async function fetchStaticAsset(env: Env, requestUrl: string, path: string): Promise<ArrayBuffer> {
  const response = await env.ASSETS.fetch(new Request(new URL(path, requestUrl)))
  if (!response.ok) throw new Error(`static asset ${path} failed: ${response.status}`)
  return response.arrayBuffer()
}

export async function handleOgImageRequest(
  requestUrl: string,
  username: string,
  env: Env,
): Promise<Response> {
  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const supabaseKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  const fetchRider = async (name: string): Promise<OgImageRider | null> => {
    if (!supabaseUrl || !supabaseKey) return null
    const data = await fetchRiderPageFromSupabase(name, supabaseUrl, supabaseKey)
    return data ? toOgImageRider(data) : null
  }
  return serveOgImage(requestUrl, username, {
    fetchRider,
    fetchStatic: (path) => fetchStaticAsset(env, requestUrl, path),
    fetchAvatar: fetchAvatarDataUri,
    renderPng: renderRiderOgPng,
    defaultPng: () => fetchStaticAsset(env, requestUrl, '/og-default.png'),
    cache: getEdgeCache(),
  })
}

// /sitemap.xml — search-engine discovery -------------------------------------
// Static pages plus every coaster/park slug, served to any user-agent.
// Successes edge-cache for an hour (slugs change slowly); upstream failures
// 502 without caching so crawlers retry against their held copy instead of
// learning a shrunken sitemap. Missing env (fork without Supabase wired)
// degrades to the three static URLs rather than erroring.

const SITEMAP_EDGE_TTL_SECONDS = 3600

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function sitemapCacheKey(requestUrl: string): Request {
  const keyUrl = new URL(requestUrl)
  keyUrl.pathname = '/sitemap.xml'
  keyUrl.search = ''
  keyUrl.hash = ''
  return new Request(keyUrl.toString(), { method: 'GET' })
}

async function fetchSlugs(
  supabaseUrl: string,
  headers: Record<string, string>,
  table: string,
): Promise<string[]> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?select=slug&order=slug&limit=10000`, {
    headers,
    signal: AbortSignal.timeout(RANKING_UPSTREAM_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`sitemap ${table} failed: ${res.status}`)
  const rows = (await res.json()) as Array<{ slug?: unknown }>
  if (!Array.isArray(rows)) throw new Error(`sitemap ${table} returned non-array`)
  const slugs = new Set<string>()
  for (const row of rows) {
    if (typeof row.slug === 'string' && SLUG_RE.test(row.slug)) slugs.add(row.slug)
  }
  return [...slugs]
}

export function renderSitemap(origin: string, coasterSlugs: string[], parkSlugs: string[]): string {
  const today = new Date().toISOString().slice(0, 10)
  const urls = [
    `  <url><loc>${escapeHtml(`${origin}/`)}</loc><lastmod>${today}</lastmod></url>`,
    `  <url><loc>${escapeHtml(`${origin}/about`)}</loc><lastmod>${today}</lastmod></url>`,
    `  <url><loc>${escapeHtml(`${origin}/faq`)}</loc><lastmod>${today}</lastmod></url>`,
    `  <url><loc>${escapeHtml(`${origin}/countries`)}</loc><lastmod>${today}</lastmod></url>`,
    ...coasterSlugs.map(
      (slug) => `  <url><loc>${escapeHtml(`${origin}/coasters/${slug}`)}</loc></url>`,
    ),
    ...parkSlugs.map((slug) => `  <url><loc>${escapeHtml(`${origin}/parks/${slug}`)}</loc></url>`),
  ]
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>`
}

export async function handleSitemapRequest(requestUrl: string, env: Env): Promise<Response> {
  const origin = new URL(requestUrl).origin
  const cache = getEdgeCache()
  const cacheKey = sitemapCacheKey(requestUrl)
  if (cache) {
    const hit = await cache.match(cacheKey)
    if (hit) {
      const body = await hit.text()
      return withSecurityHeaders(
        new Response(body, {
          status: 200,
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': `public, max-age=${SITEMAP_EDGE_TTL_SECONDS}`,
            'X-Sitemap-Cache': 'HIT',
          },
        }),
      )
    }
  }

  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const supabaseKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return withSecurityHeaders(
      new Response(renderSitemap(origin, [], []), {
        status: 200,
        headers: {
          'Content-Type': 'application/xml; charset=utf-8',
          'Cache-Control': `public, max-age=${SITEMAP_EDGE_TTL_SECONDS}`,
          'X-Sitemap-Cache': 'BYPASS',
        },
      }),
    )
  }

  let body: string | null = null
  try {
    const headers = {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: 'application/json',
    }
    const [coasterSlugs, parkSlugs] = await Promise.all([
      fetchSlugs(supabaseUrl, headers, 'v_coaster_rankings'),
      fetchSlugs(supabaseUrl, headers, 'parks'),
    ])
    body = renderSitemap(origin, coasterSlugs, parkSlugs)
  } catch {
    body = null
  }
  if (!body) {
    return withSecurityHeaders(
      new Response('Upstream unavailable', {
        status: 502,
        headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
      }),
    )
  }

  if (cache) {
    try {
      await cache.put(
        cacheKey,
        new Response(body, {
          headers: {
            'Content-Type': 'application/xml; charset=utf-8',
            'Cache-Control': `public, max-age=${SITEMAP_EDGE_TTL_SECONDS}`,
          },
        }),
      )
    } catch (error) {
      console.error('[sitemap] cache.put failed:', error)
    }
  }
  console.log(`[sitemap] cache fill: ${body.split('<url>').length - 1} urls`)
  return withSecurityHeaders(
    new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': `public, max-age=${SITEMAP_EDGE_TTL_SECONDS}`,
        'X-Sitemap-Cache': cache ? 'MISS' : 'BYPASS',
      },
    }),
  )
}

// /llms.txt — LLM-agent digest (https://llmstxt.org) ---------------------------
// A small markdown file agents read before (or instead of) JS-shelled pages:
// project digest + curated links, so an assistant answering "what is
// CoasterRank" describes the pairwise-vote methodology rather than guessing
// from the SPA shell. Catalog counts in the summary derive from the same
// ranking payload /api/ranking serves (the full v_coaster_rankings view, all
// coasters — ranked last with null scores — plus the parks table): the edge
// cache is preferred, with a direct read as fallback (never written back —
// the ranking endpoint owns that entry). If Supabase is unavailable the file
// still serves 200 with qualitative wording instead of counts — an agent's
// entry point must never 404/502 the way other upstream-dependent paths can.
// Edge-cached an hour (catalog counts move glacially).

const LLMS_EDGE_TTL_SECONDS = 3600

function llmsCacheKey(requestUrl: string): Request {
  const keyUrl = new URL(requestUrl)
  keyUrl.pathname = '/llms.txt'
  keyUrl.search = ''
  keyUrl.hash = ''
  return new Request(keyUrl.toString(), { method: 'GET' })
}

type LlmsCounts = { coasters: number; parks: number; rated: number }

// Same source /api/ranking uses; write-policy stays with the ranking handler.
async function readRankingCounts(requestUrl: string, env: Env): Promise<LlmsCounts | null> {
  let payload: RankingBoardPayload | null = null
  try {
    const cache = getEdgeCache()
    if (cache) {
      const hit = await cache.match(rankingCacheKey(`${new URL(requestUrl).origin}/api/ranking`))
      if (hit) {
        const cached = (await hit.json()) as RankingBoardPayload | null
        if (cached && Array.isArray(cached.rankings) && Array.isArray(cached.parks)) {
          payload = cached
        }
      }
    }
  } catch {
    // Cache read blowups fall through to the direct read.
  }
  if (!payload) {
    try {
      payload = await fetchRankingBoardFromSupabase(env)
    } catch {
      payload = null
    }
  }
  if (!payload || !Array.isArray(payload.rankings) || !Array.isArray(payload.parks)) return null
  return {
    coasters: payload.rankings.length,
    parks: payload.parks.length,
    rated: payload.rankings.filter((row) => Number(row.participants ?? 0) > 0).length,
  }
}

export function renderLlmsTxt(origin: string, counts: LlmsCounts | null): string {
  const coverage = counts
    ? `CoasterRank covers ${formatNumber(counts.coasters)} coasters across ${formatNumber(counts.parks)} parks (${formatNumber(counts.rated)} currently rated by the community).`
    : 'CoasterRank covers more than a thousand coasters across hundreds of parks worldwide.'
  const site = (path: string, label: string, note = '') =>
    `- [${label}](${origin}${path})${note ? `: ${note}` : ''}`
  return `# CoasterRank

> ${coverage} Rankings come from one-on-one votes fitted with a Bradley-Terry maximum-likelihood model — not survey scores or editorial picks.

CoasterRank is a community ranking site for roller coasters. Riders record
rides and cast pairwise "which is better?" votes; a job fits a Bradley-Terry
model (Hunter 2004 MM algorithm with per-rider evidence weighting and L2
regularization) and refreshes the global rankings. A rating of 100 means "at
the community average"; scores move as votes accrue. Catalog data is seeded
from the CC0-licensed coaster_db dataset and maintained through community
submissions and a suggest-edit flow on every coaster page. The site is free,
has no ads, and loads no third-party trackers. Open source (forks deploy
under their own domain).

## Site

${site('/', 'Rankings (home)', 'the global board, filterable by country and coaster type')}
${site('/about', 'About', 'the methodology and how voting works, in plain language')}
${site('/faq', 'FAQ', 'common questions')}
${site('/countries', 'Explore by country', 'per-country boards')}
${site('/terms', 'Terms')}
${site('/privacy', 'Privacy', 'what is and is not collected')}

## Optional

${site('/rank', 'Rank a sample without an account')}
- Individual coasters live at ${origin}/coasters/<slug>; public rider boards at ${origin}/riders/<username>
- Machine-readable page list: ${origin}/sitemap.xml
`
}

// formatNumber returns "1,506" in both Node (tests) and the Workers runtime.
function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

function llmsTextResponse(body: string, cacheState: string): Response {
  return withSecurityHeaders(
    new Response(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Cache-Control': `public, max-age=${LLMS_EDGE_TTL_SECONDS}`,
        'X-Llms-Cache': cacheState,
      },
    }),
  )
}

export async function handleLlmsTxtRequest(requestUrl: string, env: Env): Promise<Response> {
  const cache = getEdgeCache()
  const cacheKey = llmsCacheKey(requestUrl)
  if (cache) {
    const hit = await cache.match(cacheKey)
    if (hit) return llmsTextResponse(await hit.text(), 'HIT')
  }

  const counts = await readRankingCounts(requestUrl, env)
  const body = renderLlmsTxt(new URL(requestUrl).origin, counts)

  if (cache && counts) {
    // Only cache when counts were computed — the qualitative fallback stays
    // uncached so a computed file serves again on the next request.
    try {
      await cache.put(
        cacheKey,
        new Response(body, {
          headers: {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Cache-Control': `public, max-age=${LLMS_EDGE_TTL_SECONDS}`,
          },
        }),
      )
    } catch (error) {
      // A cache-write failure must not take the endpoint down.
      console.error('[llms.txt] cache.put failed:', error)
    }
  }
  console.log(
    counts
      ? `[llms.txt] cache fill: ${counts.coasters} coasters / ${counts.parks} parks / ${counts.rated} rated`
      : '[llms.txt] cache fill: fallback (upstream unavailable)',
  )
  return llmsTextResponse(body, !cache || !counts ? 'FALLBACK' : 'MISS')
}

// Permanent redirect to a same-origin canonical path (query string
// preserved, fragment dropped). Long browser cache: renames and slash
// forms are stable.
function redirectToPath(requestUrl: string, path: string): Response {
  const target = new URL(requestUrl)
  target.pathname = path
  target.hash = ''
  return withSecurityHeaders(
    new Response(null, {
      status: 301,
      headers: { Location: target.toString(), 'Cache-Control': 'public, max-age=86400' },
    }),
  )
}

// Bot prerender for a detail page: live copy + canonical (200), a real 404 +
// noindex for unknown slugs, SPA-shell fallback when env is unconfigured or
// Supabase fails (never a false 404 from an infra blip).
async function handleDetailRequest(
  request: Request,
  kind: 'coaster' | 'park',
  slug: string,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url)
  const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const supabaseKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseKey) {
    return withSecurityHeaders(await env.ASSETS.fetch(request))
  }
  try {
    if (kind === 'coaster') {
      const coaster = await fetchCoasterBySlug(slug, supabaseUrl, supabaseKey)
      if (!coaster) {
        return withSecurityHeaders(
          new Response(renderDetailNotFoundHtml(url.origin, kind), {
            status: 404,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'public, max-age=300',
            },
          }),
        )
      }
      return withSecurityHeaders(
        new Response(renderCoasterHtml(coaster, url.origin), {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Short cache: ranks/scores refit every 5 minutes.
            'Cache-Control': 'public, max-age=300',
          },
        }),
      )
    }
    const detail = await fetchParkWithCoasters(slug, supabaseUrl, supabaseKey)
    if (!detail) {
      return withSecurityHeaders(
        new Response(renderDetailNotFoundHtml(url.origin, kind), {
          status: 404,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'public, max-age=300',
          },
        }),
      )
    }
    return withSecurityHeaders(
      new Response(renderParkHtml(detail, url.origin), {
        status: 200,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      }),
    )
  } catch {
    // Supabase unreachable or malformed row: serve the SPA shell rather than
    // an error page or a false 404.
    return withSecurityHeaders(await env.ASSETS.fetch(request))
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'

    if (pathname === '/api/ranking') {
      return withSecurityHeaders(await handleRankingRequest(request, env))
    }

    // Analytics ingest + config (SESSION_ANALYTICS.md): same-origin browser
    // → worker only, never Supabase. GET = runtime config echo (dashboard
    // vars, 5-min TTL); POST = validated batches → Analytics Engine.
    if (pathname === '/api/sessions') {
      return withSecurityHeaders(await handleSessionsRequest(request, env))
    }

    // Sitemap — any user-agent (crawlers + humans). Checked before the
    // crawler gate so humans can inspect it too; requires the wrangler
    // run_worker_first entry (the static-asset SPA fallback would otherwise
    // answer with index.html).
    if (pathname === '/sitemap.xml') {
      return handleSitemapRequest(request.url, env)
    }

    // llms.txt — LLM-agent digest (https://llmstxt.org), any user-agent.
    // Checked before the crawler gate (agents fetch it directly); requires
    // the wrangler run_worker_first entry, since nothing in the static asset
    // directory answers this path.
    if (pathname === '/llms.txt') {
      return handleLlmsTxtRequest(request.url, env)
    }

    // Dynamic share card — any user-agent (crawlers + in-app previews).
    const ogMatch = RIDER_OG_PATH_RE.exec(url.pathname)
    if (ogMatch) {
      // Path regex already restricts the charset; normalize case for the RPC.
      return withSecurityHeaders(
        await handleOgImageRequest(request.url, ogMatch[1].toLowerCase(), env),
      )
    }

    // Detail pages: renames + trailing-slash 301s (any UA), bot prerenders.
    // Requires the /coasters/* + /parks/* run_worker_first entries — without
    // them these requests never reach the worker and serve the SPA shell.
    const detail = resolveDetailPath(url.pathname)
    if (detail) {
      const canonicalDetailPath = `/${detail.kind === 'coaster' ? 'coasters' : 'parks'}/${detail.slug}`
      // Renamed slugs (any UA — the old URL should land on the live page).
      if (detail.kind === 'park' && RENAMED_PARK_SLUGS[detail.slug]) {
        return redirectToPath(request.url, `/parks/${RENAMED_PARK_SLUGS[detail.slug]}`)
      }
      // Trailing-slash duplicates 301 to the canonical form. The slashed
      // variants otherwise serve the shell with no server canonical
      // ("Duplicate, Google chose different canonical", Oct 2026).
      if (detail.slashed) {
        return redirectToPath(request.url, canonicalDetailPath)
      }
      if (isSocialCrawler(request.headers.get('user-agent'))) {
        return handleDetailRequest(request, detail.kind, detail.slug, env)
      }
      return withSecurityHeaders(await env.ASSETS.fetch(request))
    }

    // /about/ + /faq/ 301 to the canonical form (any UA) — the exact-match
    // run_worker_first entries don't cover the slashed variants. Needs the
    // /about/ + /faq/ entries below so the worker sees these at all.
    if (url.pathname === '/about/' || url.pathname === '/faq/') {
      return redirectToPath(request.url, url.pathname.replace(/\/+$/, ''))
    }

    if (pathname === '/' && isSocialCrawler(request.headers.get('user-agent'))) {
      return withSecurityHeaders(
        new Response(renderHomeHtml(url.origin, await readCachedTopCoasters(url.origin, env)), {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Static content — cached an hour, so copy tweaks after a deploy
            // propagate without a manual cache purge.
            'Cache-Control': 'public, max-age=3600',
          },
        }),
      )
    }

    const rider = resolveRiderPath(url.pathname)

    // Static informational pages — any search/social crawler gets the
    // prerendered copy (content parity with the SPA, no Supabase needed);
    // humans fall through to the SPA. Requires the wrangler
    // run_worker_first entries (the static-asset SPA fallback would
    // otherwise answer with index.html).
    if (!rider && isSocialCrawler(request.headers.get('user-agent'))) {
      if (pathname === '/about' || pathname === '/faq') {
        const html = pathname === '/about' ? renderAboutHtml(url.origin) : renderFaqHtml(url.origin)
        return withSecurityHeaders(
          new Response(html, {
            status: 200,
            headers: {
              'Content-Type': 'text/html; charset=utf-8',
              // Static copy — cached an hour, so edits after a deploy
              // propagate without a manual cache purge.
              'Cache-Control': 'public, max-age=3600',
            },
          }),
        )
      }
    }

    if (!rider || !isSocialCrawler(request.headers.get('user-agent'))) {
      return withSecurityHeaders(await env.ASSETS.fetch(request))
    }

    const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
    const supabaseKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseKey) {
      // Env not configured: degrade to the SPA shell rather than erroring.
      return withSecurityHeaders(await env.ASSETS.fetch(request))
    }

    try {
      const data = await fetchRiderPageFromSupabase(rider.username, supabaseUrl, supabaseKey)
      const html = data
        ? renderRiderHtml(data, url.origin, rider.canonicalPath)
        : renderRiderNotFoundHtml(url.origin)
      return withSecurityHeaders(
        new Response(html, {
          status: 200,
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            // Short cache: rankings are live data; also softens RPC load if a
            // link gets a traffic spike after being shared.
            'Cache-Control': 'public, max-age=300',
          },
        }),
      )
    } catch {
      // Supabase unreachable: serve the SPA shell rather than an error page.
      return withSecurityHeaders(await env.ASSETS.fetch(request))
    }
  },
}
