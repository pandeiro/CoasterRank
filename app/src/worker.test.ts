// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import worker, {
  isSocialCrawler,
  escapeHtml,
  renderRiderHtml,
  renderRiderNotFoundHtml,
  type Env,
  type WorkerRiderPage,
} from './worker'

const riderData: WorkerRiderPage = {
  profile: {
    username: 'coaster_fan',
    display_name: 'Coaster Fan',
    avatar_url: 'https://img.test/avatar.jpg',
    og_image_url: null,
    member_since: '2024-03-01T00:00:00Z',
  },
  rides: [
    {
      coaster_id: 'c1',
      rank: 1,
      name: 'Steel Vengeance',
      slug: 'steel-vengeance',
      material: 'steel',
      status: 'operating',
      park_name: 'Cedar Point',
      park_slug: 'cedar-point',
      score: 1.23,
    },
    {
      coaster_id: 'c2',
      rank: 2,
      name: 'Fury 325',
      slug: 'fury-325',
      material: 'steel',
      status: 'operating',
      park_name: 'Carowinds',
      park_slug: 'carowinds',
      score: 1.1,
    },
  ],
}

function makeEnv(): Env {
  return {
    ASSETS: { fetch: vi.fn(async () => new Response('spa-shell')) },
    SUPABASE_URL: 'https://supabase.test',
    SUPABASE_ANON_KEY: 'anon-key',
  }
}

function riderRequest(overrides: { path?: string; ua?: string } = {}) {
  const { path = '/riders/coaster_fan', ua = 'Twitterbot/1.0' } = overrides
  return new Request(`https://coasterrank.test${path}`, { headers: { 'user-agent': ua } })
}

function stubRpc(response: Response) {
  const fetchMock = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('worker: helpers', () => {
  it('detects social crawlers', () => {
    expect(isSocialCrawler('Twitterbot/1.0')).toBe(true)
    expect(isSocialCrawler('facebookexternalhit/1.1')).toBe(true)
    expect(isSocialCrawler('Slackbot-LinkExpanding 1.0')).toBe(true)
    expect(isSocialCrawler('Discordbot/1.0')).toBe(true)
    expect(isSocialCrawler('TelegramBot (like TwitterBot)')).toBe(true)
    expect(isSocialCrawler('WhatsApp/2.25.1 A')).toBe(true)
    expect(isSocialCrawler('Mozilla/5.0 (compatible; Reddit/1.0; +http://www.reddit.com/)')).toBe(
      true,
    )
    expect(isSocialCrawler('redditbot/1.0')).toBe(true)
    expect(isSocialCrawler('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari')).toBe(false)
    expect(isSocialCrawler(null)).toBe(false)
  })

  it('escapes user-controlled values', () => {
    expect(escapeHtml('<script>alert("x&y")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&amp;y&quot;)&lt;/script&gt;',
    )
  })

  it('escapes the display name in the prerendered HTML', () => {
    const html = renderRiderHtml(
      {
        ...riderData,
        profile: { ...riderData.profile, display_name: '<script>evil()</script>' },
      },
      'https://coasterrank.test',
      '/riders/coaster_fan',
    )
    expect(html).not.toContain('<script>evil()</script>')
    expect(html).toContain('&lt;script&gt;evil()&lt;/script&gt;')
  })

  it('includes OG/Twitter meta and brand image in the prerendered HTML', () => {
    const html = renderRiderHtml(riderData, 'https://coasterrank.test', '/riders/coaster_fan')
    expect(html).toContain('<title>Coaster Fan (@coaster_fan) — CoasterRank</title>')
    expect(html).toContain('property="og:type" content="profile"')
    expect(html).toContain('property="og:image" content="https://coasterrank.test/og-default.png"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain('rel="canonical" href="https://coasterrank.test/riders/coaster_fan"')
    expect(html).toContain('Steel Vengeance')
    expect(html).not.toContain('and 0 more')
  })

  it('uses the per-rider share card as og:image when one exists', () => {
    const html = renderRiderHtml(
      {
        ...riderData,
        profile: {
          ...riderData.profile,
          og_image_url: 'https://img.test/og-card.png',
        },
      },
      'https://coasterrank.test',
      '/riders/coaster_fan',
    )
    expect(html).toContain('property="og:image" content="https://img.test/og-card.png"')
    expect(html).toContain('name="twitter:image" content="https://img.test/og-card.png"')
    expect(html).not.toContain('og-default.png')
  })
})

describe('worker: fetch handler', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves the SPA shell to humans on /riders/*', async () => {
    const env = makeEnv()
    const response = await worker.fetch(riderRequest({ ua: 'Mozilla/5.0 Safari' }), env)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('spa-shell')
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1)
  })

  it('serves the SPA shell for non-rider paths even for bots', async () => {
    const env = makeEnv()
    const fetchMock = stubRpc(new Response(JSON.stringify(riderData)))
    const response = await worker.fetch(riderRequest({ path: '/coasters/steel-vengeance' }), env)
    expect(await response.text()).toBe('spa-shell')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('prerenders OG HTML for social crawlers with RPC data', async () => {
    const env = makeEnv()
    const fetchMock = stubRpc(
      new Response(JSON.stringify(riderData), {
        headers: { 'content-type': 'application/json' },
      }),
    )
    const response = await worker.fetch(riderRequest(), env)
    const html = await response.text()

    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('Cache-Control')).toContain('max-age=300')
    expect(html).toContain('Coaster Fan (@coaster_fan) — CoasterRank')
    expect(html).toContain('Steel Vengeance')

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://supabase.test/rest/v1/rpc/public_rider_page')
    expect(JSON.parse(String(init.body))).toEqual({ p_username: 'coaster_fan' })
  })

  it('serves shared not-found HTML when the RPC returns null', async () => {
    const env = makeEnv()
    stubRpc(new Response('null', { headers: { 'content-type': 'application/json' } }))
    const response = await worker.fetch(riderRequest(), env)
    const html = await response.text()

    expect(html).toContain('Rider not found — CoasterRank')
    expect(html).toContain('noindex')
  })

  it('falls back to the SPA shell when Supabase is unreachable', async () => {
    const env = makeEnv()
    stubRpc(new Response('boom', { status: 500 }))
    const response = await worker.fetch(riderRequest(), env)
    // Infra failure must NOT render the "not found" page (that would tell
    // crawlers the rider doesn't exist); degrade to the SPA shell instead.
    expect(await response.text()).toBe('spa-shell')
  })

  it('falls back to the SPA shell when env vars are missing', async () => {
    const env = makeEnv()
    env.SUPABASE_URL = undefined
    env.SUPABASE_ANON_KEY = undefined
    const fetchMock = stubRpc(new Response(JSON.stringify(riderData)))
    const response = await worker.fetch(riderRequest(), env)
    expect(await response.text()).toBe('spa-shell')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the SPA shell when the RPC throws', async () => {
    const env = makeEnv()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )
    const response = await worker.fetch(riderRequest(), env)
    expect(await response.text()).toBe('spa-shell')
  })

  it('falls back to the SPA shell for path segments that cannot be usernames', async () => {
    const env = makeEnv()
    const fetchMock = stubRpc(new Response(JSON.stringify(riderData)))
    const response = await worker.fetch(riderRequest({ path: '/riders/AB' }), env)
    expect(await response.text()).toBe('spa-shell')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('worker: not-found HTML', () => {
  it('never leaks whether a username exists', () => {
    const html = renderRiderNotFoundHtml('https://coasterrank.test')
    expect(html).toContain("doesn't exist or isn't shared")
  })
})

// /api/ranking ---------------------------------------------------------------

const rankingRows = [
  {
    id: 'c1',
    name: 'Steel Vengeance',
    slug: 'steel-vengeance',
    score: 1.23,
    rank: 1,
  },
]
const parkRows = [
  {
    id: 'p1',
    name: 'Cedar Point',
    slug: 'cedar-point',
    country: 'US',
    region: null,
    city: 'Sandusky',
  },
]
// What the worker assembles from the two upstream responses.
const rankingPayload = {
  rankings: rankingRows,
  parks: parkRows,
  generated_at: '2026-08-31T00:00:00.000Z',
}

function rankingRequest(overrides: { method?: string; origin?: string | null } = {}) {
  const { method = 'GET', origin = 'https://coasterrank.app' } = overrides
  const headers: Record<string, string> = {}
  if (origin) headers.origin = origin
  return new Request('https://coasterrank.test/api/ranking', { method, headers })
}

function makeCacheStub() {
  const cache = {
    match: vi.fn(async () => undefined as Response | undefined),
    put: vi.fn(async () => {}),
  }
  vi.stubGlobal('caches', { default: cache })
  return cache
}

// The worker makes two upstream reads (rankings view + parks table); each
// returns a bare PostgREST JSON array.
function stubRankingUpstream(status = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const payload = String(input).includes('v_coaster_rankings') ? rankingRows : parkRows
    return new Response(JSON.stringify(payload), { status })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('worker: /api/ranking', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves the combined payload and caches it at the edge with the long TTL', async () => {
    const env = makeEnv()
    const cache = makeCacheStub()
    const fetchMock = stubRankingUpstream()

    const response = await worker.fetch(rankingRequest(), env)
    const body = await response.json()

    expect(body).toEqual({ ...rankingPayload, generated_at: expect.any(String) })
    expect(response.headers.get('Content-Type')).toContain('application/json')
    // Browser copy: short TTL. Edge copy: 15-min TTL.
    expect(response.headers.get('Cache-Control')).toContain('max-age=60')
    expect(response.headers.get('X-Ranking-Cache')).toBe('MISS')
    expect(cache.put).toHaveBeenCalledTimes(1)
    const [putKey, putResponse] = cache.put.mock.calls[0] as unknown as [Request, Response]
    expect(putKey.url).toBe('https://coasterrank.test/api/ranking')
    expect(putResponse.headers.get('Cache-Control')).toContain('max-age=900')
    // Two upstream reads (rankings + parks), both with the anon key.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('serves a cache hit without touching Supabase, with browser TTL and CORS intact', async () => {
    const env = makeEnv()
    const cache = makeCacheStub()
    // The edge copy stores the LONG TTL (that's what expires the entry);
    // the response served to the browser must still carry the SHORT one.
    cache.match.mockResolvedValue(
      new Response(JSON.stringify(rankingPayload), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': `public, max-age=${900}`,
        },
      }),
    )
    const fetchMock = stubRankingUpstream()

    const response = await worker.fetch(rankingRequest(), env)
    expect(await response.json()).toEqual(rankingPayload)
    expect(response.headers.get('Cache-Control')).toContain('max-age=60')
    expect(response.headers.get('X-Ranking-Cache')).toBe('HIT')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://coasterrank.app')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('still serves fresh data when the cache write fails', async () => {
    const env = makeEnv()
    const cache = makeCacheStub()
    cache.put.mockRejectedValue(new Error('cache full'))
    const fillMock = stubRankingUpstream()

    const response = await worker.fetch(rankingRequest(), env)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...rankingPayload, generated_at: expect.any(String) })
    expect(fillMock).toHaveBeenCalledTimes(2)
  })

  it('normalizes the cache key so query strings cannot fragment the cache', async () => {
    const env = makeEnv()
    const cache = makeCacheStub()
    stubRankingUpstream()

    const request = new Request('https://coasterrank.test/api/ranking?utm=bogus', {
      headers: { origin: 'https://coasterrank.app' },
    })
    await worker.fetch(request, env)
    const [putKey] = cache.put.mock.calls[0] as unknown as [Request]
    expect(putKey.url).toBe('https://coasterrank.test/api/ranking')
  })

  it('returns 405 for non-GET methods', async () => {
    const env = makeEnv()
    makeCacheStub()
    const fetchMock = stubRankingUpstream()

    const response = await worker.fetch(rankingRequest({ method: 'POST' }), env)
    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toContain('GET')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers CORS preflights and reflects allowed origins only', async () => {
    const env = makeEnv()
    makeCacheStub()

    const preflight = await worker.fetch(rankingRequest({ method: 'OPTIONS' }), env)
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://coasterrank.app')

    const allowed = await worker.fetch(rankingRequest(), env)
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://coasterrank.app')

    const stranger = await worker.fetch(rankingRequest({ origin: 'https://evil.example' }), env)
    expect(stranger.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('honors a RANKING_ALLOWED_ORIGINS var override without a redeploy', async () => {
    const env = makeEnv()
    env.RANKING_ALLOWED_ORIGINS = 'https://staging.coasterrank.app, https://other.example'
    makeCacheStub()
    stubRankingUpstream()

    const allowed = await worker.fetch(
      rankingRequest({ origin: 'https://staging.coasterrank.app' }),
      env,
    )
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://staging.coasterrank.app',
    )

    // The var replaces (not extends) the default list.
    const defaultOrigin = await worker.fetch(rankingRequest(), env)
    expect(defaultOrigin.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('returns 502 (no-store) when Supabase fails so the SPA can fall back', async () => {
    const env = makeEnv()
    const cache = makeCacheStub()
    stubRankingUpstream(500)

    const response = await worker.fetch(rankingRequest(), env)
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toContain('no-store')
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('returns 502 without fetching when env vars are missing', async () => {
    const env = makeEnv()
    env.SUPABASE_URL = undefined
    env.SUPABASE_ANON_KEY = undefined
    makeCacheStub()
    const fetchMock = stubRankingUpstream()

    const response = await worker.fetch(rankingRequest(), env)
    expect(response.status).toBe(502)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
