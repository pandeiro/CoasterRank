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
