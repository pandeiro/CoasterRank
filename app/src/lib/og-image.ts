import { buildRiderOgSvg, type OgSvgProfile, type OgSvgRide } from './og-svg'

/**
 * Edge OG image pipeline for /riders/:username/og.png (see worker.ts).
 *
 * Freshness model: the PNG is rendered on demand from the same public RPC
 * the crawler HTML uses, then cached at the edge for 5 minutes (mirrors the
 * rider HTML TTL). No storage writes, no cron, no per-edit uploads — cost is
 * ~1 RPC + ~50ms CPU per unique rider per TTL window, only when the card is
 * actually requested (unfurls, in-app previews).
 *
 * Heavy lifting (resvg wasm, brand fonts) ships as same-origin static assets
 * (app/public/resvg.wasm + app/public/fonts/*.woff2) loaded lazily per
 * isolate — the worker bundle itself only grows by the ~17KB JS glue.
 * Every failure path degrades to the static /og-default.png bytes, never a
 * 500 to crawlers.
 */

export const OG_IMAGE_EDGE_TTL_SECONDS = 300
export const OG_IMAGE_BROWSER_TTL_SECONDS = 300
/** Crawler image caches are aggressive; the HTML embeds a time-bucketed ?v=
// so each 5-minute HTML generation points at a fresh image URL. */
export const OG_IMAGE_VERSION_BUCKET_MS = 300_000

export const OG_WASM_PATH = '/resvg.wasm'
export const OG_FONT_PATHS = ['/fonts/inter-latin.woff2', '/fonts/racing-sans-one-latin.woff2']

const AVATAR_UPSTREAM_TIMEOUT_MS = 5_000
const AVATAR_MAX_BYTES = 2_000_000

export type StaticAssetFetcher = (path: string) => Promise<ArrayBuffer>

export type FontBuffer = { bytes: Uint8Array; family: string }

export type RenderPng = (svg: string, fonts: FontBuffer[]) => Promise<Uint8Array<ArrayBuffer>>

/** Stable canonical image URL for a rider (HTML embeds this + ?v= bucket). */
export function ogImageUrl(origin: string, username: string, nowMs: number = Date.now()): string {
  const bucket = Math.floor(nowMs / OG_IMAGE_VERSION_BUCKET_MS)
  return `${origin}/riders/${username}/og.png?v=${bucket}`
}

/** Canonical edge-cache key: lowercase username, query stripped so ?v=
// buckets share one entry per TTL window. */
export function ogImageCacheKey(requestUrl: string, username: string): Request {
  const url = new URL(requestUrl)
  url.pathname = `/riders/${username.toLowerCase()}/og.png`
  url.search = ''
  url.hash = ''
  return new Request(url.toString(), { method: 'GET' })
}

export type OgImageRider = {
  profile: {
    username: string
    displayName: string
    avatarUrl: string | null
    memberSinceYear: string | null
    pageUrl: string
  }
  rides: OgSvgRide[]
}

/** Best-effort avatar → data URI. Null when missing/unsupported/slow —
// callers render the initial-letter placeholder instead. Only png/jpeg are
// attempted (resvg raster support); webp/gif fall back to the placeholder. */
export async function fetchAvatarDataUri(avatarUrl: string | null): Promise<string | null> {
  if (!avatarUrl) return null
  try {
    const response = await fetch(avatarUrl, {
      signal: AbortSignal.timeout(AVATAR_UPSTREAM_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase()
    if (contentType !== 'image/png' && contentType !== 'image/jpeg') return null
    const buffer = await response.arrayBuffer()
    if (buffer.byteLength === 0 || buffer.byteLength > AVATAR_MAX_BYTES) return null
    const bytes = new Uint8Array(buffer)
    let binary = ''
    const CHUNK = 0x8000
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
    }
    return `data:${contentType};base64,${btoa(binary)}`
  } catch {
    return null
  }
}

export type OgSvgInput = {
  profile: OgSvgProfile
  rides: OgSvgRide[]
}

/** Maps RPC-shaped rider data to the SVG builder input (avatar resolved). */
export function toOgSvgInput(rider: OgImageRider, avatarDataUri: string | null): OgSvgInput {
  const rankedCount = rider.rides.length
  const parkCount = new Set(rider.rides.map((r) => r.park_name).filter(Boolean)).size
  return {
    profile: {
      displayName: rider.profile.displayName,
      username: rider.profile.username,
      memberSinceYear: rider.profile.memberSinceYear,
      rankedCount,
      parkCount,
      avatarDataUri,
      pageUrl: rider.profile.pageUrl,
    },
    rides: rider.rides.slice(0, 5),
  }
}

// -- Default production implementations (isolate-cached) ---------------------

let wasmInitPromise: Promise<void> | null = null
let fontPromise: Promise<FontBuffer[]> | null = null

async function ensureWasm(fetchStatic: StaticAssetFetcher): Promise<void> {
  if (!wasmInitPromise) {
    wasmInitPromise = (async () => {
      const { initWasm } = await import('@resvg/resvg-wasm')
      const wasmBytes = await fetchStatic(OG_WASM_PATH)
      await initWasm(wasmBytes)
    })().catch((error) => {
      // A failed init must not poison the isolate forever — drop the promise
      // so the next request retries (and degrades to the fallback meanwhile).
      wasmInitPromise = null
      throw error
    })
  }
  await wasmInitPromise
}

async function loadFonts(fetchStatic: StaticAssetFetcher): Promise<FontBuffer[]> {
  if (!fontPromise) {
    fontPromise = (async () => {
      const [inter, racing] = await Promise.all(OG_FONT_PATHS.map((p) => fetchStatic(p)))
      return [
        { bytes: new Uint8Array(inter), family: 'Inter' },
        { bytes: new Uint8Array(racing), family: 'Racing Sans One' },
      ]
    })().catch((error) => {
      fontPromise = null
      throw error
    })
  }
  return fontPromise
}

/** Rasterizes SVG → PNG via resvg-wasm (1200 wide; height follows viewBox). */
export async function svgToPng(svg: string, fonts: FontBuffer[]): Promise<Uint8Array<ArrayBuffer>> {
  const { Resvg } = await import('@resvg/resvg-wasm')
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: {
      fontBuffers: fonts.map((f) => f.bytes),
      loadSystemFonts: false,
    },
  })
  return resvg.render().asPng() as Uint8Array<ArrayBuffer>
}

/** Full render: wasm + fonts (isolate-cached) then rasterize. */
export async function renderRiderOgPng(
  input: OgSvgInput,
  fetchStatic: StaticAssetFetcher,
): Promise<Uint8Array<ArrayBuffer>> {
  await ensureWasm(fetchStatic)
  const fonts = await loadFonts(fetchStatic)
  return svgToPng(buildRiderOgSvg(input.profile, input.rides), fonts)
}

// -- Serving (edge cache + fallbacks) ----------------------------------------

export type EdgeCacheLike = {
  match(key: Request | string): Promise<Response | undefined>
  put(key: Request | string, response: Response): Promise<void>
}

export type OgServeDeps = {
  fetchRider: (username: string) => Promise<OgImageRider | null>
  fetchStatic: StaticAssetFetcher
  fetchAvatar: (url: string | null) => Promise<string | null>
  renderPng: (
    input: OgSvgInput,
    fetchStatic: StaticAssetFetcher,
  ) => Promise<Uint8Array<ArrayBuffer>>
  defaultPng: () => Promise<Uint8Array<ArrayBuffer> | ArrayBuffer>
  cache: EdgeCacheLike | undefined
}

function ogPngResponse(
  body: Uint8Array<ArrayBuffer> | ArrayBuffer,
  cacheStatus: string,
  maxAge: number,
): Response {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': `public, max-age=${maxAge}`,
      'X-Og-Cache': cacheStatus,
    },
  })
}

async function fallbackOgResponse(deps: OgServeDeps): Promise<Response> {
  try {
    return ogPngResponse(await deps.defaultPng(), 'FALLBACK', 3600)
  } catch {
    return new Response('OG image unavailable', {
      status: 502,
      headers: { 'Cache-Control': 'no-store' },
    })
  }
}

/**
 * Serves GET /riders/:username/og.png: edge-cache lookup → RPC → avatar →
 * render → edge-cache fill. Unknown/private riders and every failure degrade
 * to the static default card, never an error to crawlers (unless even the
 * default bytes are unreachable — then 502).
 */
export async function serveOgImage(
  requestUrl: string,
  username: string,
  deps: OgServeDeps,
): Promise<Response> {
  const cacheKey = ogImageCacheKey(requestUrl, username)
  if (deps.cache) {
    const hit = await deps.cache.match(cacheKey)
    if (hit) {
      return ogPngResponse(await hit.arrayBuffer(), 'HIT', OG_IMAGE_BROWSER_TTL_SECONDS)
    }
  }

  try {
    const rider = await deps.fetchRider(username)
    if (!rider) return fallbackOgResponse(deps)

    const avatarDataUri = await deps.fetchAvatar(rider.profile.avatarUrl)
    const png = await deps.renderPng(toOgSvgInput(rider, avatarDataUri), deps.fetchStatic)

    if (deps.cache) {
      try {
        await deps.cache.put(
          cacheKey,
          new Response(png, {
            headers: {
              'Content-Type': 'image/png',
              'Cache-Control': `public, max-age=${OG_IMAGE_EDGE_TTL_SECONDS}`,
            },
          }),
        )
      } catch {
        // A cache-write failure must not take the endpoint down.
      }
    }
    return ogPngResponse(png, deps.cache ? 'MISS' : 'BYPASS', OG_IMAGE_BROWSER_TTL_SECONDS)
  } catch {
    return fallbackOgResponse(deps)
  }
}
