// @vitest-environment node
import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  fetchAvatarDataUri,
  ogImageCacheKey,
  ogImageUrl,
  serveOgImage,
  toOgSvgInput,
  type OgImageRider,
  type OgServeDeps,
} from './og-image'

function rider(): OgImageRider {
  return {
    profile: {
      username: 'marina_thrills',
      displayName: 'Marina Thrills',
      avatarUrl: 'https://img.test/avatar.png',
      memberSinceYear: '2021',
      pageUrl: 'https://coasterrank.test/riders/marina_thrills',
    },
    rides: [
      { rank: 1, name: 'Steel Vengeance', park_name: 'Cedar Point' },
      { rank: 2, name: 'Zadra', park_name: 'Energylandia' },
    ],
  }
}

const PNG = new Uint8Array([137, 80, 78, 71])
const DEFAULT_PNG = new Uint8Array([137, 80, 78, 71, 68, 69, 70])

function deps(overrides: Partial<OgServeDeps> = {}): OgServeDeps {
  return {
    fetchRider: async () => rider(),
    fetchStatic: async () => new ArrayBuffer(8),
    fetchAvatar: async () => null,
    renderPng: async () => PNG,
    defaultPng: async () => DEFAULT_PNG,
    cache: undefined,
    ...overrides,
  }
}

function cacheStub(hit: Response | undefined) {
  return { match: vi.fn(async () => hit), put: vi.fn(async () => {}) }
}

describe('ogImageUrl', () => {
  it('embeds a 5-minute version bucket', () => {
    const a = ogImageUrl('https://coasterrank.test', 'marina_thrills', 0)
    const b = ogImageUrl('https://coasterrank.test', 'marina_thrills', 299_999)
    const c = ogImageUrl('https://coasterrank.test', 'marina_thrills', 300_000)
    expect(a).toBe('https://coasterrank.test/riders/marina_thrills/og.png?v=0')
    expect(b).toBe(a)
    expect(c).toBe('https://coasterrank.test/riders/marina_thrills/og.png?v=1')
  })
})

describe('ogImageCacheKey', () => {
  it('normalizes case and strips the ?v= bucket so buckets share one entry', () => {
    const key = ogImageCacheKey(
      'https://coasterrank.test/riders/MARINA_thrills/og.png?v=12',
      'MARINA_thrills',
    )
    expect(key.url).toBe('https://coasterrank.test/riders/marina_thrills/og.png')
  })
})

describe('toOgSvgInput', () => {
  it('derives counts and caps rides at 5', () => {
    const many: OgImageRider = {
      ...rider(),
      rides: Array.from({ length: 8 }, (_, i) => ({
        rank: i + 1,
        name: `Coaster ${i + 1}`,
        park_name: i % 2 === 0 ? 'Park A' : 'Park B',
      })),
    }
    const input = toOgSvgInput(many, 'data:image/png;base64,AAA')
    expect(input.profile.rankedCount).toBe(8)
    expect(input.profile.parkCount).toBe(2)
    expect(input.rides).toHaveLength(5)
    expect(input.profile.avatarDataUri).toBe('data:image/png;base64,AAA')
  })
})

describe('serveOgImage', () => {
  it('renders on miss and fills the edge cache', async () => {
    const cache = cacheStub(undefined)
    const renderPng = vi.fn(async () => PNG)
    const response = await serveOgImage(
      'https://coasterrank.test/riders/marina_thrills/og.png?v=3',
      'marina_thrills',
      deps({ cache, renderPng }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Og-Cache')).toBe('MISS')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
    expect(renderPng).toHaveBeenCalledTimes(1)
    expect(cache.put).toHaveBeenCalledTimes(1)
    const [putKey, putResponse] = cache.put.mock.calls[0] as unknown as [Request, Response]
    expect(putKey.url).toBe('https://coasterrank.test/riders/marina_thrills/og.png')
    expect(putResponse.headers.get('Cache-Control')).toContain('max-age=300')
  })

  it('serves an edge hit without touching the RPC or renderer', async () => {
    const fetchRider = vi.fn()
    const renderPng = vi.fn()
    const cache = cacheStub(new Response(PNG, { headers: { 'Content-Type': 'image/png' } }))
    const response = await serveOgImage(
      'https://coasterrank.test/riders/marina_thrills/og.png',
      'marina_thrills',
      deps({ cache, fetchRider, renderPng }),
    )
    expect(response.headers.get('X-Og-Cache')).toBe('HIT')
    expect(fetchRider).not.toHaveBeenCalled()
    expect(renderPng).not.toHaveBeenCalled()
    expect(cache.put).not.toHaveBeenCalled()
  })

  it('still serves fresh data when the cache write fails', async () => {
    const cache = cacheStub(undefined)
    cache.put.mockRejectedValue(new Error('cache full'))
    const response = await serveOgImage(
      'https://coasterrank.test/riders/marina_thrills/og.png',
      'marina_thrills',
      deps({ cache }),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('X-Og-Cache')).toBe('MISS')
  })

  it('serves the static default card for unknown or private riders', async () => {
    const renderPng = vi.fn()
    const response = await serveOgImage(
      'https://coasterrank.test/riders/ghost/og.png',
      'ghost',
      deps({ fetchRider: async () => null, renderPng }),
    )
    expect(response.headers.get('X-Og-Cache')).toBe('FALLBACK')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DEFAULT_PNG)
    expect(renderPng).not.toHaveBeenCalled()
  })

  it('serves the static default card when rendering throws', async () => {
    const response = await serveOgImage(
      'https://coasterrank.test/riders/marina_thrills/og.png',
      'marina_thrills',
      deps({
        renderPng: async () => {
          throw new Error('wasm exploded')
        },
      }),
    )
    expect(response.headers.get('X-Og-Cache')).toBe('FALLBACK')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(DEFAULT_PNG)
  })

  it('502s only when even the default bytes are unreachable', async () => {
    const response = await serveOgImage(
      'https://coasterrank.test/riders/ghost/og.png',
      'ghost',
      deps({
        fetchRider: async () => null,
        defaultPng: async () => {
          throw new Error('assets down')
        },
      }),
    )
    expect(response.status).toBe(502)
    // Header coverage for this path lives at the worker level (the outer
    // withSecurityHeaders wrap) — see 'worker: /riders/:username/og.png'.
  })
})

describe('fetchAvatarDataUri', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns null without fetching when there is no avatar', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchAvatarDataUri(null)).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('encodes png/jpeg avatars as data URIs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/png' },
          }),
      ),
    )
    expect(await fetchAvatarDataUri('https://img.test/a.png')).toBe('data:image/png;base64,AQID')
  })

  it('skips unsupported formats like webp (resvg raster limits)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(new Uint8Array([1, 2, 3]), {
            headers: { 'content-type': 'image/webp' },
          }),
      ),
    )
    expect(await fetchAvatarDataUri('https://img.test/a.webp')).toBeNull()
  })

  it('returns null on fetch failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 404 })),
    )
    expect(await fetchAvatarDataUri('https://img.test/missing.png')).toBeNull()
  })
})
