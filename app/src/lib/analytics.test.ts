import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  initAnalytics,
  setAnalyticsAuth,
  track,
  __resetAnalyticsForTests,
  __analyticsStateForTests,
  __flushAnalyticsForTests,
  __setAnalyticsLocationForTests,
} from './analytics'

type SendBeaconMock = ReturnType<typeof vi.fn>

// jsdom lacks navigator.sendBeacon and a configurable doNotTrack; stub both
// per-test. sessionStorage exists in jsdom (per-origin) but starts empty.
function stubNavigator(options: {
  sendBeacon?: SendBeaconMock | null
  doNotTrack?: string | null
  gpc?: boolean
}) {
  // Plain object on purpose: a Navigator inheriting jsdom's IDL prototype
  // brand-checks (throws) on any property access through a fake receiver.
  vi.stubGlobal('navigator', {
    sendBeacon: options.sendBeacon ?? (() => true),
    doNotTrack: options.doNotTrack ?? null,
    globalPrivacyControl: options.gpc ?? false,
  })
}

function configResponse(enabled = true, sampleRate = 100): Response {
  return new Response(JSON.stringify({ enabled, sampleRate }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
  vi.unstubAllGlobals()
})

function beaconBodies(beacon: ReturnType<typeof vi.fn>): Promise<string[]> {
  // sendBeacon receives Blobs; decode them all to strings for assertions.
  return Promise.all(
    beacon.mock.calls.map(([, blob]) =>
      typeof blob === 'string' ? Promise.resolve(blob) : Blob.prototype.text.call(blob),
    ),
  )
}

afterEach(() => {
  __resetAnalyticsForTests()
  __setAnalyticsLocationForTests(null)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('analytics: eligibility gates', () => {
  it('stays fully inactive on a localhost origin (no fetch of config)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    __setAnalyticsLocationForTests('http://localhost:5173/')
    await initAnalytics()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(__analyticsStateForTests()).toBeNull()
  })

  it('does nothing at all when DNT is set — no UUID, no fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    __setAnalyticsLocationForTests('https://coasterrank.app/')
    stubNavigator({ doNotTrack: '1' })
    await initAnalytics()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(__analyticsStateForTests()).toBeNull()
    // track is a silent no-op on never-initialized sessions
    track('coaster_marked')
    expect(__analyticsStateForTests()).toBeNull()
  })

  it('does nothing when GPC is set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    __setAnalyticsLocationForTests('https://coasterrank.app/')
    stubNavigator({ gpc: true })
    await initAnalytics()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(__analyticsStateForTests()).toBeNull()
  })

  it('skips headless UAs', async () => {
    vi.stubGlobal('navigator', { userAgent: 'HeadlessChrome/120' })
    vi.stubGlobal('fetch', vi.fn())
    __setAnalyticsLocationForTests('https://coasterrank.app/')
    await initAnalytics()
    expect(__analyticsStateForTests()).toBeNull()
  })

  it('stays ineligible when collection is off (config disabled)', async () => {
    const fetchMock = vi.fn(async () => configResponse(false, 100))
    vi.stubGlobal('fetch', fetchMock)
    stubNavigator({})
    __setAnalyticsLocationForTests('https://coasterrank.app/')
    await initAnalytics()
    expect(fetchMock).toHaveBeenCalledWith('/api/sessions', expect.anything())
    const s = __analyticsStateForTests()
    expect(s?.started).toBe(true)
    expect(s?.eligible).toBe(false)
    // capture still rolls up locally, nothing buffers
    track('coaster_marked')
    expect(__analyticsStateForTests()?.markCount).toBe(1)
    expect(__analyticsStateForTests()?.buffer).toHaveLength(0)
  })

  it('stays ineligible when the config endpoint is unreachable (fail closed)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 502 })),
    )
    stubNavigator({})
    __setAnalyticsLocationForTests('https://coasterrank.app/')
    await initAnalytics()
    expect(__analyticsStateForTests()?.eligible).toBe(false)
  })

  it('rate 0 → ineligible and nothing stored anywhere', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => configResponse(true, 0)),
    )
    stubNavigator({})
    __setAnalyticsLocationForTests('https://coasterrank.app/')
    await initAnalytics()
    expect(window.sessionStorage.getItem('cr.analytics-session')).toBeNull()
    expect(window.localStorage.getItem('cr.analytics-session')).toBeNull()
    expect(__analyticsStateForTests()?.eligible).toBe(false)
  })
})

describe('analytics: session aggregation (eligible session)', () => {
  beforeEach(async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => configResponse(true, 100)),
    )
    stubNavigator({})
    __setAnalyticsLocationForTests('https://coasterrank.app/')
    await initAnalytics()
  })

  it('marks an eligible session and stores nothing in web storage', () => {
    const s = __analyticsStateForTests()
    expect(s?.started).toBe(true)
    expect(s?.eligible).toBe(true)
    // No sampling key exists at all — not even a local-only identifier.
    expect(window.sessionStorage.length).toBe(0)
  })

  it('rolls up marks, reorders, search/filter flags, and reached step', () => {
    track('coaster_marked')
    track('rank_entered')
    track('rank_reordered')
    track('save_started')
    track('search_used')
    track('filter_used')
    const s = __analyticsStateForTests()
    expect(s?.markCount).toBe(1)
    expect(s?.reorderCount).toBe(1)
    expect(s?.didSearch).toBe(true)
    expect(s?.didFilter).toBe(true)
    expect(s?.reached).toBe('save')
    // Every fired event also lands in the event buffer.
    expect(s?.buffer.map((e) => e.name)).toEqual([
      'coaster_marked',
      'rank_entered',
      'rank_reordered',
      'save_started',
      'search_used',
      'filter_used',
    ])
  })

  it('unmark decrements the local mark count but buffers both events', () => {
    track('coaster_marked')
    track('coaster_unmarked')
    const s = __analyticsStateForTests()
    expect(s?.markCount).toBe(0)
    expect(s?.buffer.map((e) => e.name)).toEqual(['coaster_marked', 'coaster_unmarked'])
  })

  it('search_used dedupes per session: a 15-keystroke query buffers one event', () => {
    // "Steel Vengeance", one keystroke at a time — a naive per-callsite fire
    // would flood the 50-event window (companion test to a backend review).
    const query = 'Steel Vengeance'
    const chars = query.split('')
    const noise: string[] = []
    for (const _ of chars) {
      track('search_used') // one per keystroke
      noise.push('x')
    }
    track('filter_used')
    track('filter_used') // repeated theme: same first-per-session shape
    const s = __analyticsStateForTests()
    expect(s?.didSearch).toBe(true)
    expect(s?.didFilter).toBe(true)
    expect(s?.buffer.filter((e) => e.name === 'search_used')).toHaveLength(1)
    expect(s?.buffer.filter((e) => e.name === 'filter_used')).toHaveLength(1)
    expect(noise).toHaveLength(15) // sanity: we really did fire 15 times
  })

  it('pagehide in bfcache (persisted=true) skips the summary beacon', async () => {
    const beacon = vi.fn((_url: string, _body: string) => true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
    track('coaster_marked')
    const bfcacheEvent = new Event('pagehide')
    Object.defineProperty(bfcacheEvent, 'persisted', { value: true })
    window.dispatchEvent(bfcacheEvent)
    expect(beacon).not.toHaveBeenCalled()
    // A real unload still flushes after the skipped bfcache freeze.
    track('rank_reordered')
    const realUnload = new Event('pagehide')
    Object.defineProperty(realUnload, 'persisted', { value: false })
    window.dispatchEvent(realUnload)
    const bodies = await beaconBodies(beacon)
    expect(JSON.parse(bodies.find((b) => b.includes('"summary"'))!).summary.reached).toBe('mark')
    // The bfcache-skipped call did NOT flush the earlier mark; it flushes now.
    expect(
      (
        JSON.parse(bodies.find((b) => !b.includes('"summary"'))!) as { events: { name: string }[] }
      ).events.map((e) => e.name),
    ).toEqual(['coaster_marked', 'rank_reordered'])
  })

  it('records the entry surface from the landing path', async () => {
    __resetAnalyticsForTests()
    __setAnalyticsLocationForTests('https://coasterrank.app/riders/someone')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => configResponse(true, 100)),
    )
    stubNavigator({})
    await initAnalytics()
    expect(__analyticsStateForTests()?.entrySurface).toBe('rider_share')
  })

  it('auth segment stays coarse and updatable', async () => {
    setAnalyticsAuth(true)
    const beacon = vi.fn((_url: string, _body: string) => true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
    __flushAnalyticsForTests(true)
    const bodies = await beaconBodies(beacon)
    const summaryPayload = bodies.map((body) => JSON.parse(body)).find((p) => p.summary)
    expect(summaryPayload.summary.auth_state).toBe('authed')
  })

  it('flush sends buffered events via sendBeacon and clears the buffer', async () => {
    const beacon = vi.fn((_url: string, _body: string) => true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
    track('coaster_marked')
    track('search_used')
    __flushAnalyticsForTests()
    expect(beacon).toHaveBeenCalledTimes(1)
    const payload = JSON.parse((await beaconBodies(beacon))[0])
    expect(payload.events.map((e: { name: string }) => e.name)).toEqual([
      'coaster_marked',
      'search_used',
    ])
    expect(__analyticsStateForTests()?.buffer).toHaveLength(0)
  })

  it('summary carries the rolled-up funnel answer set', async () => {
    const beacon = vi.fn((_url: string, _body: string) => true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
    track('coaster_marked')
    __flushAnalyticsForTests(true)
    const bodies = await beaconBodies(beacon)
    const { summary } = bodies.map((body) => JSON.parse(body)).find((p) => p.summary)
    expect(summary.entry_surface).toBe('board')
    expect(summary.max_scroll).toBe('none')
    expect(summary.reached).toBe('mark')
    expect(summary.ms_to_first_mark).toBeGreaterThanOrEqual(0)
    expect(summary.mark_count).toBe(1)
    expect(summary.did_search).toBe(0)
    expect(summary.did_filter).toBe(0)
    expect(summary.auth_state).toBe('guest')
  })

  it('summary reports −1 sentinels when the visitor never added or interacted', async () => {
    const beacon = vi.fn((_url: string, _body: string) => true)
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: beacon })
    __flushAnalyticsForTests(true)
    const bodies = await beaconBodies(beacon)
    const { summary } = bodies.map((body) => JSON.parse(body)).find((p) => p.summary)
    expect(summary.ms_to_first_mark).toBe(-1)
    expect(summary.reached).toBe('none')
    expect(summary.mark_count).toBe(0)
  })

  it('debug mode beacons nothing but still logs', async () => {
    __resetAnalyticsForTests()
    __setAnalyticsLocationForTests('https://coasterrank.app/?analytics=debug')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    stubNavigator({})
    await initAnalytics()
    track('coaster_marked')
    __flushAnalyticsForTests()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(__analyticsStateForTests()?.buffer).toHaveLength(0)
  })
})
