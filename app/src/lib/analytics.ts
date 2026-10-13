// Anonymous session analytics capture + gated export (SESSION_ANALYTICS.md).
//
// Capture is always-side-effect-free-until-eligible: nothing exists (not even
// the local sampling UUID) unless the visitor is on a production origin, not
// a bot, hasn't opted out via DNT/GPC, the runtime config says collection is
// on, and the session-level sample chose this tab. Even then the only
// outbound traffic is a batched POST /api/sessions to OUR Worker → Analytics
// Engine — browsers never touch Supabase for analytics, and no session ID,
// URL, IP, or entity leaves the tab. The Worker is the privacy boundary:
// it re-validates everything (lib/analytics-schema.ts) and hard-gates
// Sec-GPC/DNT requests.
//
// The local UUID lives in sessionStorage, is regenerated per tab, is NEVER
// sent anywhere in v1, and is used only to make session-level sampling
// deterministic. No cross-session or cross-tab identifier exists.

import {
  BULK_ADD_BUCKETS,
  IMPORT_ROWS_BUCKETS,
  MAX_SCROLL_BUCKETS,
  SAVE_RIDES_BUCKETS,
  type AnalyticsEventName,
  type AnalyticsEventProps,
  type AnalyticsSummaryWire,
  type EntrySurface,
  type MaxScrollBucket,
  type ReachedStep,
} from './analytics-schema'

export type { AnalyticsEventName, AnalyticsEventProps } from './analytics-schema'

const FLUSH_INTERVAL_MS = 15_000
const CONFIG_TIMEOUT_MS = 8_000
// Buckets for max_scroll (fraction of the page scrolled): none = no scroll
// event at all, shallow <1/3, mid <~3/4, deep ≥3/4.
const MID_SCROLL_FRACTION = 1 / 3
const DEEP_SCROLL_FRACTION = 0.75
const SCROLL_SAMPLE_MS = 250

interface AnalyticsSessionState {
  /** initAnalytics() has run (in dev/test it may decide to stay off). */
  started: boolean
  /** Eligible sessions have a local UUID, are sampled, and export is live. */
  eligible: boolean
  /** Config echo from GET /api/sessions (observability only). */
  enabled: boolean
  sampleRate: number
  debug: boolean
  authState: 'guest' | 'authed'

  entrySurface: EntrySurface
  viewport: 'mobile' | 'desktop'
  maxScroll: MaxScrollBucket
  reached: number // index into REACHED_STEPS-equivalent ordering
  startedAt: number
  firstInteractionAt: number | null
  firstMarkAt: number | null

  markCount: number
  reorderCount: number
  didSearch: boolean
  didFilter: boolean

  buffer: { name: AnalyticsEventName; props: AnalyticsEventProps }[]
  firedOnce: Set<AnalyticsEventName>
  flushTimer: number | null
  listenersInstalled: boolean
}

// REACHED_STEPS order mirrored for index comparisons (schema import is
// avoided here only to keep this module's hot path tiny; both stay in sync).
const REACHED_ORDER: ReachedStep[] = ['none', 'mark', 'rank', 'save']

let state: AnalyticsSessionState | null = null

// Test-only: jsdom cannot change the window origin, so tests aim the module
// at a fake URL via this override instead of history.replaceState.
let testLocationHref: string | null = null
export function __setAnalyticsLocationForTests(href: string | null): void {
  testLocationHref = href
}

// ── Eligibility gates ───────────────────────────────────────────────────────

function isLocalOrTestOrigin(hostname: string, protocol: string): boolean {
  if (protocol !== 'https:') return true
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.test')
  )
}

function looksLikeBot(userAgent: string): boolean {
  // Headless browsers used for previews/E2E — prerendered crawler traffic
  // never reaches the SPA anyway; this keeps test and scraper sessions out.
  return /HeadlessChrome|PhantomJS|Electron/i.test(userAgent)
}

function optedOut(navigatorObj: Navigator): boolean {
  const gpc = (navigatorObj as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl
  if (gpc === true) return true
  const dnt = (navigatorObj as Navigator & { doNotTrack?: string }).doNotTrack
  return dnt === '1'
}

function entrySurfaceFromPath(pathname: string): EntrySurface {
  if (pathname === '/' || pathname === '') return 'board'
  if (pathname.startsWith('/rank')) return 'rank'
  if (pathname.startsWith('/riders/') || pathname.startsWith('/@')) return 'rider_share'
  if (pathname.startsWith('/coasters/')) return 'coaster'
  if (pathname.startsWith('/parks/')) return 'park'
  return 'other'
}

function readViewport(): 'mobile' | 'desktop' {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia('(min-width: 640px)').matches ? 'desktop' : 'mobile'
  }
  return 'desktop'
}

// Session-level sampling draw. One random draw per init (init runs once per
// tab) replaces any stored sampling key — nothing exists in web storage at
// all, so there is no identifier, even local-only, to police or leak.
interface FetchConfigResult {
  enabled: boolean
  sampleRate: number
}

async function fetchConfig(): Promise<FetchConfigResult | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS)
    const response = await fetch('/api/sessions', {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    })
    clearTimeout(timer)
    if (!response.ok) return null
    const body = (await response.json()) as { enabled?: unknown; sampleRate?: unknown }
    const enabled = body.enabled === true
    const rate = Number(body.sampleRate)
    return {
      enabled,
      sampleRate: Number.isFinite(rate) ? Math.min(100, Math.max(0, rate)) : 100,
    }
  } catch {
    return null
  }
}

// ── Flush / transport ───────────────────────────────────────────────────────

function buildSummary(now: number): AnalyticsSummaryWire | null {
  if (!state) return null
  const startedAt = state.startedAt
  const ms = (at: number | null) => (at === null ? -1 : Math.max(0, at - startedAt))
  return {
    entry_surface: state.entrySurface,
    viewport: state.viewport,
    max_scroll: state.maxScroll,
    reached: REACHED_ORDER[state.reached],
    auth_state: state.authState,
    ms_to_first_interaction: ms(state.firstInteractionAt),
    ms_to_first_mark: ms(state.firstMarkAt),
    duration_ms: Math.max(0, now - state.startedAt),
    mark_count: state.markCount,
    reorder_count: state.reorderCount,
    did_search: state.didSearch ? 1 : 0,
    did_filter: state.didFilter ? 1 : 0,
  }
}

function send(body: string): void {
  if (!state) return
  if (state.debug) {
    console.info('[analytics:debug]', body)
    return
  }
  try {
    if (typeof navigator.sendBeacon === 'function') {
      // Blob with an explicit type so the beacon carries application/json.
      const blob = new Blob([body], { type: 'application/json' })
      navigator.sendBeacon('/api/sessions', blob)
      return
    }
    void fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    })
  } catch {
    // Analytics must never throw into a user flow.
  }
}

interface FlushOptions {
  includeSummary?: boolean
}

async function flush(options: FlushOptions = {}): Promise<void> {
  if (!state || !state.eligible) return
  const body: { events: unknown[]; summary?: AnalyticsSummaryWire } = {
    events: [],
  }
  const events = state.buffer.splice(0, state.buffer.length)
  while (events.length > 0) {
    // Max 50 events per batch (schema parse limit).
    body.events = events.splice(0, 50)
    send(JSON.stringify(body))
  }
  if (options.includeSummary) {
    const summary = buildSummary(Date.now())
    if (summary) send(JSON.stringify({ events: [], summary }))
  }
}

// ── Interaction/scroll observers ────────────────────────────────────────────

function updateScrollBucket(): void {
  if (!state || state.maxScroll === 'deep') return
  const doc = document.documentElement
  const scrollable = doc.scrollHeight - window.innerHeight
  if (scrollable <= 0) return
  const fraction = Math.max(0, (window.scrollY + window.innerHeight) / doc.scrollHeight)
  const current: MaxScrollBucket =
    fraction >= DEEP_SCROLL_FRACTION ? 'deep' : fraction >= MID_SCROLL_FRACTION ? 'mid' : 'shallow'
  if (orderOfBucket(current) > orderOfBucket(state.maxScroll)) state.maxScroll = current
}

function orderOfBucket(bucket: MaxScrollBucket): number {
  return MAX_SCROLL_BUCKETS.indexOf(bucket)
}

function installListeners(): void {
  if (!state || state.listenersInstalled) return
  state.listenersInstalled = true

  const firstInteraction = () => {
    if (state && state.firstInteractionAt === null) {
      state.firstInteractionAt = Date.now()
    }
  }
  window.addEventListener('pointerdown', firstInteraction, { passive: true, once: true })
  window.addEventListener('keydown', firstInteraction, { passive: true, once: true })

  let lastSampled = 0
  const onScroll = () => {
    const now = Date.now()
    if (now - lastSampled < SCROLL_SAMPLE_MS) return
    lastSampled = now
    updateScrollBucket()
    if (state && state.eligible) {
      // First-scroll + deep events fire at most once per session.
      if (!state.firedOnce.has('board_scrolled')) {
        state.firedOnce.add('board_scrolled')
        track('board_scrolled')
      }
      if (state.maxScroll === 'deep' && !state.firedOnce.has('board_scrolled_deep')) {
        state.firedOnce.add('board_scrolled_deep')
        track('board_scrolled_deep')
      }
    }
  }
  window.addEventListener('scroll', onScroll, { passive: true })

  if (state) {
    state.flushTimer = window.setInterval(() => {
      if (state?.eligible && state.buffer.length > 0) void flush()
    }, FLUSH_INTERVAL_MS)
  }

  // pagehide covers navigation away, tab close, and (via bfcache semantics)
  // is more reliable than beforeunload for beacons.
  window.addEventListener('pagehide', () => {
    if (state?.eligible) void flush({ includeSummary: true })
  })
}

// ── Public API ──────────────────────────────────────────────────────────────

function makeSessionState(overrides: {
  eligible: boolean
  enabled: boolean
  sampleRate: number
  debug: boolean
}): AnalyticsSessionState {
  return {
    started: true,
    ...overrides,
    authState: 'guest',
    entrySurface: entrySurfaceFromPath(new URL(testLocationHref ?? window.location.href).pathname),
    viewport: readViewport(),
    maxScroll: 'none',
    reached: 0,
    startedAt: Date.now(),
    firstInteractionAt: null,
    firstMarkAt: null,
    markCount: 0,
    reorderCount: 0,
    didSearch: false,
    didFilter: false,
    buffer: [],
    firedOnce: new Set(),
    flushTimer: null,
    listenersInstalled: false,
  }
}

/**
 * Boots analytics for this tab. Safe to call multiple times; does nothing on
 * non-browser environments and never throws. Export stays OFF unless every
 * gate passes.
 */
export async function initAnalytics(): Promise<void> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return
  if (state?.started) return
  // GPC/DNT precede everything: an opted-out tab has zero analytics state.
  if (optedOut(navigator)) {
    state = null
    return
  }
  try {
    const location = new URL(testLocationHref ?? window.location.href)
    const dbg = location.searchParams.get('analytics') === 'debug'
    const localOrigin = isLocalOrTestOrigin(location.hostname, location.protocol)
    // UA read is guarded: exotic test fakes can't satisfy the Navigator brand
    // check; a non-string UA is treated as unknown (not a bot).
    const userAgent =
      typeof window.navigator.userAgent === 'string' ? window.navigator.userAgent : ''
    if (looksLikeBot(userAgent) || (localOrigin && !dbg)) {
      state = null
      return
    }

    // ?analytics=debug: capture rolls up + logs to console, but never fetches
    // config or beacons — a local dev aid that cannot reach the network.
    if (dbg) {
      state = makeSessionState({
        eligible: false,
        enabled: false,
        sampleRate: 0,
        debug: true,
      })
      return
    }

    const config = await fetchConfig()
    if (!config || !config.enabled) {
      // Fail closed: unreachable/disabled collection leaves rollup-only state.
      state = makeSessionState({
        eligible: false,
        enabled: false,
        sampleRate: 0,
        debug: false,
      })
      return
    }

    const sampled = Math.random() * 100 < config.sampleRate
    state = makeSessionState({
      eligible: sampled,
      enabled: config.enabled,
      sampleRate: config.sampleRate,
      debug: false,
    })
    installListeners()
  } catch (error) {
    console.error('[analytics] init failed:', error)
    state = null
  }
}

/** Auth segment (coarse): called by Layout on auth state changes. */
export function setAnalyticsAuth(authed: boolean): void {
  if (state) state.authState = authed ? 'authed' : 'guest'
}

function rollupReached(step: ReachedStep): void {
  if (!state) return
  const index = REACHED_ORDER.indexOf(step)
  if (index > state.reached) state.reached = index
}

function noteFirstMark(): void {
  if (state && state.firstMarkAt === null) state.firstMarkAt = Date.now()
}

/**
 * Records an allowlisted event. No-ops until the module is initialized
 * (tests/components can call it freely pre-init) and no-ops entirely for
 * ineligible sessions — handlers only ever fire it for local capture;
 * network cost appears only for sampled, enabled sessions.
 */
export function track(name: AnalyticsEventName, props: AnalyticsEventProps = {}): void {
  if (!state || !state.started) return

  // Session rollups (answers funnel questions without identity):
  // search/filter flags, first-add timing, highest funnel step.
  if (name === 'search_used') state.didSearch = true
  if (name === 'filter_used') state.didFilter = true
  if (name === 'mark_mode_entered') rollupReached('mark')
  if (name === 'coaster_marked') {
    state.markCount += 1
    noteFirstMark()
    rollupReached('mark')
  }
  if (name === 'coaster_unmarked' && state.markCount > 0) state.markCount -= 1
  if (name === 'rank_entered') rollupReached('rank')
  if (name === 'save_started') rollupReached('save')
  if (name === 'rank_reordered') state.reorderCount += 1
  if (name === 'park_bulk_add_committed') {
    noteFirstMark()
    rollupReached('mark')
  }
  if (name === 'guest_import_applied') {
    noteFirstMark()
    rollupReached('mark')
  }

  if (state.debug) {
    console.info(`[analytics:debug] ${name}`, props)
  }
  if (!state.eligible) return

  state.buffer.push({ name, props })
  // Soft cap per buffer window; flush drops overflow (sampling protects us).
  if (state.buffer.length > 50) state.buffer.splice(0, state.buffer.length - 50)
}

// ── Test hooks (not part of the runtime contract) ───────────────────────────

/** Resets all module state. Test-only. */
export function __resetAnalyticsForTests(): void {
  if (state?.flushTimer !== null && state?.flushTimer !== undefined) {
    window.clearInterval(state.flushTimer)
  }
  state = null
}

/** Inspect current session aggregation. Test-only. */
export function __analyticsStateForTests(): {
  eligible: boolean
  started: boolean
  markCount: number
  reorderCount: number
  didSearch: boolean
  didFilter: boolean
  maxScroll: MaxScrollBucket
  reached: ReachedStep
  entrySurface: EntrySurface
  buffer: { name: AnalyticsEventName; props: AnalyticsEventProps }[]
} | null {
  if (!state) return null
  return {
    eligible: state.eligible,
    started: state.started,
    markCount: state.markCount,
    reorderCount: state.reorderCount,
    didSearch: state.didSearch,
    didFilter: state.didFilter,
    maxScroll: state.maxScroll,
    reached: REACHED_ORDER[state.reached],
    entrySurface: state.entrySurface,
    buffer: state.buffer,
  }
}

/** Force a flush (events + optional summary). Test-only. */
export function __flushAnalyticsForTests(includeSummary = false): void {
  void flush({ includeSummary })
}

/** Import row-count bucket for guest-import commits (call sites in stores). */
export function importRowsBucket(count: number): (typeof IMPORT_ROWS_BUCKETS)[number] {
  if (count >= 51) return '51+'
  if (count >= 11) return '11-50'
  return '1-10'
}

/** Rides-at-save bucket for the save funnel step. */
export function saveRidesBucket(count: number): (typeof SAVE_RIDES_BUCKETS)[number] {
  if (count >= 15) return '15+'
  if (count >= 5) return '5-14'
  return '1-4'
}

/** Add-count bucket for park bulk-add commits. */
export function bulkAddBucket(count: number): (typeof BULK_ADD_BUCKETS)[number] {
  if (count >= 11) return '11+'
  if (count >= 4) return '4-10'
  return '1-3'
}
