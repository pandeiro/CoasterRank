// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFile } from 'node:fs/promises'
import worker, {
  isSocialCrawler,
  escapeHtml,
  renderHomeHtml,
  homeMeta,
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

  it('includes OG/Twitter meta and the dynamic card in the prerendered HTML', () => {
    const html = renderRiderHtml(riderData, 'https://coasterrank.test', '/riders/coaster_fan')
    expect(html).toContain('<title>Coaster Fan (@coaster_fan) — CoasterRank</title>')
    expect(html).toContain('property="og:type" content="profile"')
    expect(html).toContain(
      'property="og:image" content="https://coasterrank.test/riders/coaster_fan/og.png?v=',
    )
    expect(html).toContain('property="og:image:width" content="1200"')
    expect(html).toContain('property="og:image:height" content="630"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain('rel="canonical" href="https://coasterrank.test/riders/coaster_fan"')
    expect(html).toContain('Steel Vengeance')
    expect(html).not.toContain('and 0 more')
  })

  it('describes the top 3 coasters in the meta description', () => {
    const html = renderRiderHtml(riderData, 'https://coasterrank.test', '/riders/coaster_fan')
    expect(html).toContain('Top: Steel Vengeance · Fury 325')
  })

  it('ignores the legacy uploaded card — og:image is always the dynamic route', () => {
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
    expect(html).toContain(
      'property="og:image" content="https://coasterrank.test/riders/coaster_fan/og.png?v=',
    )
    expect(html).toContain(
      'name="twitter:image" content="https://coasterrank.test/riders/coaster_fan/og.png?v=',
    )
    expect(html).not.toContain('og-card.png')
    expect(html).not.toContain('og-default.png')
  })

  it('buckets the image URL in 5-minute windows', () => {
    const at = (ms: number) =>
      renderRiderHtml(riderData, 'https://coasterrank.test', '/riders/coaster_fan', ms)
    expect(at(0)).toContain('og.png?v=0')
    expect(at(299_999)).toContain('og.png?v=0')
    expect(at(300_000)).toContain('og.png?v=1')
  })
})

describe('worker: home unfurl', () => {
  it('builds absolute, origin-relative meta for the base URL', () => {
    const meta = homeMeta('https://coasterrank.test')
    expect(meta.url).toBe('https://coasterrank.test/')
    expect(meta.image).toBe('https://coasterrank.test/og-default.png')
    expect(meta.title).toContain('CoasterRank')
  })

  it('includes full OG/Twitter meta in the prerendered home HTML', () => {
    const html = renderHomeHtml('https://coasterrank.test')
    expect(html).toContain('property="og:type" content="website"')
    expect(html).toContain('property="og:image" content="https://coasterrank.test/og-default.png"')
    expect(html).toContain('property="og:image:width" content="1200"')
    expect(html).toContain('property="og:image:height" content="630"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain('rel="canonical" href="https://coasterrank.test/"')
  })

  it('prerenders the home card for social crawlers on /', async () => {
    const env = makeEnv()
    const response = await worker.fetch(
      new Request('https://coasterrank.test/', { headers: { 'user-agent': 'Twitterbot/1.0' } }),
      env,
    )
    const html = await response.text()
    expect(response.headers.get('Content-Type')).toContain('text/html')
    expect(response.headers.get('Cache-Control')).toContain('max-age=3600')
    expect(html).toContain(
      '<title>CoasterRank — A live ranking of the world’s roller coasters</title>',
    )
    expect(html).toContain('property="og:image" content="https://coasterrank.test/og-default.png"')
    // Static content: no Supabase call, no SPA shell.
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
  })

  it('serves the SPA shell to humans on /', async () => {
    const env = makeEnv()
    const response = await worker.fetch(
      new Request('https://coasterrank.test/', { headers: { 'user-agent': 'Mozilla/5.0 Safari' } }),
      env,
    )
    expect(await response.text()).toBe('spa-shell')
    expect(env.ASSETS.fetch).toHaveBeenCalledTimes(1)
  })

  it('prerenders the home card for bare-URL requests with a query string', async () => {
    const env = makeEnv()
    const response = await worker.fetch(
      new Request('https://coasterrank.test/?utm_source=slack', {
        headers: { 'user-agent': 'Slackbot-LinkExpanding 1.0' },
      }),
      env,
    )
    const html = await response.text()
    expect(html).toContain('property="og:url" content="https://coasterrank.test/"')
    expect(env.ASSETS.fetch).not.toHaveBeenCalled()
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

describe('worker: /riders/:username/og.png', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  async function realAsset(path: string): Promise<ArrayBuffer> {
    const buf = await readFile(new URL(`../public${path}`, import.meta.url))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  }

  function stubAssets() {
    return {
      fetch: vi.fn(async (req: Request) => {
        const path = new URL(req.url).pathname
        if (path === '/og-default.png') {
          return new Response(new Uint8Array([9, 9, 9]), {
            headers: { 'Content-Type': 'image/png' },
          })
        }
        if (path === '/resvg.wasm' || path.startsWith('/fonts/')) {
          return new Response(await realAsset(path), {
            headers: { 'Content-Type': 'application/octet-stream' },
          })
        }
        // SPA shell passthrough for non-asset paths.
        return new Response('spa-shell')
      }),
    }
  }

  /** RPC data for rider paths; 404 for everything else (avatar → placeholder). */
  function stubOgUpstream() {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('public_rider_page')) {
        return new Response(JSON.stringify(riderData), {
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('missing', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  function ogRequest(path = '/riders/coaster_fan/og.png', ua = 'Twitterbot/1.0') {
    return new Request(`https://coasterrank.test${path}`, { headers: { 'user-agent': ua } })
  }

  function pngDimensions(bytes: Uint8Array): [number, number] {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return [view.getUint32(16), view.getUint32(20)]
  }

  it('renders the live card for any user-agent (real raster, 1200x630 PNG)', async () => {
    const env: Env = { ...makeEnv(), ASSETS: stubAssets() }
    const put = vi.fn(async () => {})
    vi.stubGlobal('caches', { default: { match: vi.fn(async () => undefined), put } })
    stubOgUpstream()
    const response = await worker.fetch(
      ogRequest('/riders/coaster_fan/og.png', 'Mozilla/5.0 Safari'),
      env,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Og-Cache')).toBe('MISS')
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([...bytes.slice(0, 4)]).toEqual([137, 80, 78, 71])
    expect(pngDimensions(bytes)).toEqual([1200, 630])
    expect(put).toHaveBeenCalledTimes(1)
  }, 30_000)

  it('serves edge hits without touching Supabase', async () => {
    const cached = new Response(new Uint8Array([137, 80, 78, 71]), {
      headers: { 'Content-Type': 'image/png' },
    })
    vi.stubGlobal('caches', {
      default: { match: vi.fn(async () => cached), put: vi.fn(async () => {}) },
    })
    const fetchMock = stubOgUpstream()
    const env: Env = { ...makeEnv(), ASSETS: stubAssets() }
    const response = await worker.fetch(ogRequest('/riders/coaster_fan/og.png?v=7'), env)
    expect(response.headers.get('X-Og-Cache')).toBe('HIT')
    expect(response.headers.get('Cache-Control')).toContain('max-age=300')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the default card for unknown or private riders', async () => {
    const env: Env = { ...makeEnv(), ASSETS: stubAssets() }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('null')),
    )
    const response = await worker.fetch(ogRequest(), env)
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Og-Cache')).toBe('FALLBACK')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([9, 9, 9]))
  })

  it('falls back to the default card when env vars are missing', async () => {
    const env: Env = { ...makeEnv(), ASSETS: stubAssets() }
    env.SUPABASE_URL = undefined
    env.SUPABASE_ANON_KEY = undefined
    const fetchMock = stubOgUpstream()
    const response = await worker.fetch(ogRequest(), env)
    expect(response.headers.get('X-Og-Cache')).toBe('FALLBACK')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls through to the SPA shell for path segments that cannot be usernames', async () => {
    const env: Env = { ...makeEnv(), ASSETS: stubAssets() }
    const fetchMock = stubOgUpstream()
    const response = await worker.fetch(ogRequest('/riders/AB/og.png'), env)
    expect(env.ASSETS.fetch).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(response).toBeDefined()
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
// What public_board_meta() returns (the third upstream read).
const boardMetaRow = {
  real_user_count: 61,
  ranked_user_count: 47,
  last_recomputed_at: '2026-08-31T00:30:00.000Z',
}
// What the worker assembles from the upstream responses.
const rankingPayload = {
  rankings: rankingRows,
  parks: parkRows,
  generated_at: '2026-08-31T00:00:00.000Z',
  last_recomputed_at: boardMetaRow.last_recomputed_at,
  real_user_count: boardMetaRow.real_user_count,
  ranked_user_count: boardMetaRow.ranked_user_count,
}

function rankingRequest(overrides: { method?: string; origin?: string | null } = {}) {
  const { method = 'GET', origin } = overrides
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

// The worker makes three upstream reads (rankings view + parks table + the
// board-meta RPC); each returns a bare PostgREST JSON body.
function stubRankingUpstream(status = 200, metaStatus = 200) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes('v_coaster_rankings'))
      return new Response(JSON.stringify(rankingRows), { status })
    if (url.includes('public_board_meta'))
      return new Response(JSON.stringify(boardMetaRow), { status: metaStatus })
    return new Response(JSON.stringify(parkRows), { status })
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
    // Three upstream reads (rankings + parks + board meta), all anon-key.
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const metaUrl = String((fetchMock.mock.calls[2] as unknown as [string])[0])
    expect(metaUrl).toBe('https://supabase.test/rest/v1/rpc/public_board_meta')
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

    const response = await worker.fetch(rankingRequest({ origin: 'https://coasterrank.test' }), env)
    expect(await response.json()).toEqual(rankingPayload)
    expect(response.headers.get('Cache-Control')).toContain('max-age=60')
    expect(response.headers.get('X-Ranking-Cache')).toBe('HIT')
    // Self-origin (the worker's own deployment host) is reflected per-request.
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://coasterrank.test')
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
    expect(fillMock).toHaveBeenCalledTimes(3)
  })

  it('degrades board meta to nulls (not 502) when the RPC is unavailable', async () => {
    const env = makeEnv()
    const cache = makeCacheStub()
    // Deploy-order skew: the migration may not exist yet — PostgREST answers
    // 404. The board itself must stay healthy, just without status extras.
    stubRankingUpstream(200, 404)

    const response = await worker.fetch(rankingRequest(), env)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.last_recomputed_at).toBeNull()
    expect(body.real_user_count).toBeNull()
    expect(body.ranked_user_count).toBeNull()
    expect(body.rankings).toEqual(rankingRows)
    // The (null-meta) payload is still cached so HITs stay consistent.
    expect(cache.put).toHaveBeenCalledTimes(1)
  })

  it('keeps the board healthy when the meta fetch throws', async () => {
    const env = makeEnv()
    makeCacheStub()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('v_coaster_rankings'))
        return new Response(JSON.stringify(rankingRows), { status: 200 })
      if (url.includes('public_board_meta')) throw new Error('meta socket reset')
      return new Response(JSON.stringify(parkRows), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await worker.fetch(rankingRequest(), env)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.last_recomputed_at).toBeNull()
    expect(body.real_user_count).toBeNull()
    expect(body.ranked_user_count).toBeNull()
  })

  it('back-compat: old RPC without ranked_user_count degrades that field to null', async () => {
    const env = makeEnv()
    const cache = makeCacheStub()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('v_coaster_rankings'))
        return new Response(JSON.stringify(rankingRows), { status: 200 })
      if (url.includes('public_board_meta'))
        return new Response(
          JSON.stringify({
            real_user_count: 61,
            last_recomputed_at: boardMetaRow.last_recomputed_at,
          }),
          {
            status: 200,
          },
        )
      return new Response(JSON.stringify(parkRows), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const response = await worker.fetch(rankingRequest(), env)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.real_user_count).toBe(61)
    expect(body.ranked_user_count).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(cache.put).toHaveBeenCalledTimes(1)
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

  it('reflects self-origin always; other origins only via the var; no domains in source', async () => {
    const env = makeEnv()
    makeCacheStub()

    // The worker's own origin needs no config — works for any fork's domain.
    const preflight = await worker.fetch(
      rankingRequest({ method: 'OPTIONS', origin: 'https://coasterrank.test' }),
      env,
    )
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('https://coasterrank.test')

    const selfOrigin = await worker.fetch(
      rankingRequest({ origin: 'https://coasterrank.test' }),
      env,
    )
    expect(selfOrigin.headers.get('Access-Control-Allow-Origin')).toBe('https://coasterrank.test')

    // Cross-origin without configuration: rejected.
    const stranger = await worker.fetch(rankingRequest({ origin: 'https://evil.example' }), env)
    expect(stranger.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('enables configured cross-origin consumers via RANKING_ALLOWED_ORIGINS', async () => {
    const env = makeEnv()
    env.RANKING_ALLOWED_ORIGINS = 'https://staging.example, https://other.example'
    makeCacheStub()
    stubRankingUpstream()

    const allowed = await worker.fetch(rankingRequest({ origin: 'https://staging.example' }), env)
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('https://staging.example')

    // The var is the entire cross-origin allowlist — anything unlisted (and
    // not self-origin) stays rejected.
    const unlisted = await worker.fetch(rankingRequest({ origin: 'https://evil.example' }), env)
    expect(unlisted.headers.get('Access-Control-Allow-Origin')).toBeNull()
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
