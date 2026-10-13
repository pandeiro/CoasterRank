// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { handleSessionsRequest, __resetSessionsRateLimitForTests } from './sessions-endpoint'
import type { AnalyticsEngineBinding } from './sessions-endpoint'

const summaryBlob = (overrides: Record<string, unknown> = {}) => ({
  entry_surface: 'board',
  viewport: 'mobile',
  max_scroll: 'mid',
  reached: 'mark',
  auth_state: 'guest',
  ms_to_first_interaction: 1200,
  ms_to_first_mark: 9000,
  duration_ms: 42_000,
  mark_count: 3,
  reorder_count: 1,
  did_search: 0,
  did_filter: 1,
  ...overrides,
})

function makePostRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://coasterrank.app/api/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.9', ...headers },
    body: JSON.stringify(body),
  })
}

function makeEnv(options: { withBindings?: boolean } = {}): {
  env: Parameters<typeof handleSessionsRequest>[1]
  events: { points: unknown[] }
  summary: { points: unknown[] }
} {
  const events = { points: [] as unknown[] }
  const summary = { points: [] as unknown[] }
  const binding = (sink: { points: unknown[] }): AnalyticsEngineBinding => ({
    writeDataPoint(point) {
      sink.points.push(point)
    },
  })
  return {
    env:
      options.withBindings === false
        ? { ANALYTICS_ENABLED: 'true', ANALYTICS_SAMPLE_RATE: '100' }
        : {
            ANALYTICS_ENABLED: 'true',
            ANALYTICS_SAMPLE_RATE: '100',
            SESSIONS_AE_EVENTS: binding(events),
            SESSIONS_AE_SUMMARY: binding(summary),
          },
    events,
    summary,
  }
}

beforeEach(() => {
  __resetSessionsRateLimitForTests()
})

afterEach(() => {
  __resetSessionsRateLimitForTests()
  vi.restoreAllMocks()
})

describe('GET /api/sessions', () => {
  it('echoes the dashboard vars with a 5-minute TTL', async () => {
    const { env } = makeEnv()
    const res = await handleSessionsRequest(
      new Request('https://coasterrank.app/api/sessions'),
      env,
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toContain('max-age=300')
    expect(await res.json()).toEqual({ enabled: true, sampleRate: 100 })
  })

  it('fails closed when vars are unset', async () => {
    const res = await handleSessionsRequest(new Request('https://coasterrank.app/api/sessions'), {})
    expect(await res.json()).toEqual({ enabled: false, sampleRate: 100 })
  })

  it('clamps an out-of-range sample rate to the safe default', async () => {
    const res = await handleSessionsRequest(new Request('https://coasterrank.app/api/sessions'), {
      ANALYTICS_ENABLED: 'true',
      ANALYTICS_SAMPLE_RATE: '250',
    })
    expect(await res.json()).toEqual({ enabled: true, sampleRate: 100 })
  })

  it('rejects other methods', async () => {
    const res = await handleSessionsRequest(
      new Request('https://coasterrank.app/api/sessions', { method: 'DELETE' }),
      {},
    )
    expect(res.status).toBe(405)
  })
})

describe('POST /api/sessions', () => {
  it('expands a valid event batch into event + summary datapoints', async () => {
    const { env, events, summary } = makeEnv()
    const res = await handleSessionsRequest(
      makePostRequest({
        events: [
          { name: 'coaster_marked' },
          { name: 'park_bulk_add_committed', props: { bulk_add_bucket: '4-10' } },
          { name: 'guest_import_applied', props: { rows_bucket: '51+' } },
          { name: 'save_started', props: { rides_bucket: '1-4' } },
        ],
        summary: summaryBlob(),
      }),
      env,
    )
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, stored: 5 })
    expect(events.points).toHaveLength(4)
    expect(events.points[0]).toEqual({ blobs: ['coaster_marked', ''], doubles: [1], indexes: [] })
    expect(events.points[1]).toEqual({
      blobs: ['park_bulk_add_committed', '4-10'],
      doubles: [1],
      indexes: [],
    })
    expect(summary.points).toHaveLength(1)
    expect(summary.points[0]).toEqual({
      blobs: ['board', 'mobile', 'mid', 'mark', 'guest'],
      doubles: [1200, 9000, 42_000, 3, 1, 0, 1],
      indexes: [],
    })
  })

  it('drops unknown event names with 400 (allowlist is the privacy boundary)', async () => {
    const { env, events } = makeEnv()
    const res = await handleSessionsRequest(
      makePostRequest({ events: [{ name: 'page_view', props: { url: '/secret' } }] }),
      env,
    )
    expect(res.status).toBe(400)
    expect(events.points).toHaveLength(0)
  })

  it('rejects invalid bucket values', async () => {
    const { env } = makeEnv()
    const res = await handleSessionsRequest(
      makePostRequest({
        events: [{ name: 'save_started', props: { rides_bucket: '999' } }],
      }),
      env,
    )
    expect(res.status).toBe(400)
  })

  it('rejects payloads over 50 events / invalid summaries', async () => {
    const { env } = makeEnv()
    const tooBig = makePostRequest({
      events: Array.from({ length: 51 }, () => ({ name: 'coaster_marked' })),
    })
    expect((await handleSessionsRequest(tooBig, env)).status).toBe(400)
    const badSummary = makePostRequest({
      events: [],
      summary: summaryBlob({ entry_surface: 'admin-area-not-allowed' }),
    })
    expect((await handleSessionsRequest(badSummary, env)).status).toBe(400)
    const negative = makePostRequest({ events: [], summary: summaryBlob({ duration_ms: -5 }) })
    expect((await handleSessionsRequest(negative, env)).status).toBe(400)
  })

  it('accepts −1 sentinels for the never-happened ms fields', async () => {
    const { env, events, summary } = makeEnv()
    const res = await handleSessionsRequest(
      makePostRequest({
        events: [],
        summary: summaryBlob({ ms_to_first_interaction: -1, ms_to_first_mark: -1 }),
      }),
      env,
    )
    expect(res.status).toBe(202)
    expect(events.points).toHaveLength(0)
    expect(summary.points).toHaveLength(1)
  })

  it('accepts beacons from opted-out visitors as no-ops (server-side GPC gate)', async () => {
    const { env, events } = makeEnv()
    const res = await handleSessionsRequest(
      makePostRequest({ events: [{ name: 'coaster_marked' }] }, { 'Sec-GPC': '1' }),
      env,
    )
    expect(res.status).toBe(204)
    expect(events.points).toHaveLength(0)
  })

  it('rate-limits per client IP without storing it', async () => {
    const { env } = makeEnv()
    let last: Response
    for (let i = 0; i < 30; i++) {
      last = await handleSessionsRequest(makePostRequest({ events: [] }), env)
      expect(last.status).toBe(202)
    }
    last = await handleSessionsRequest(makePostRequest({ events: [] }), env)
    expect(last.status).toBe(429)
  })

  it('returns dropped for missing AE bindings (dev/CI) without erroring', async () => {
    const { env } = makeEnv({ withBindings: false })
    const res = await handleSessionsRequest(
      makePostRequest({ events: [{ name: 'coaster_marked' }] }),
      env,
    )
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ ok: true, dropped: 'no-dataset', stored: 0 })
  })

  it('rejects wrong content types and invalid JSON', async () => {
    const { env } = makeEnv()
    const text = await handleSessionsRequest(
      new Request('https://coasterrank.app/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain', 'CF-Connecting-IP': '203.0.113.8' },
        body: 'events',
      }),
      env,
    )
    expect(text.status).toBe(415)
    const junk = await handleSessionsRequest(
      new Request('https://coasterrank.app/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' },
        body: '{not json',
      }),
      env,
    )
    expect(junk.status).toBe(400)
  })
})
