// Shared analytics wire schema (client beacon ↔ worker validation).
// No DOM/Worker dependencies — imported by lib/analytics.ts (browser) and
// sessions-endpoint.ts (worker), and tested from both sides.
//
// Privacy posture (docs/research/SESSION_ANALYTICS.md): every field is a
// coarse bucket or a count/boolean. No IDs, no URLs, no free text, no
// session identifier. The event-name allowlist is the privacy policy in
// code — a new name is a deliberate, reviewed addition to both allowlists
// below plus the client-side session aggregation in lib/analytics.ts.

export const ANALYTICS_EVENT_NAMES = [
  'mark_mode_entered',
  'coaster_marked',
  'coaster_unmarked',
  'park_bulk_add_committed',
  'search_used',
  'filter_used',
  'board_scrolled',
  'board_scrolled_deep',
  'rank_entered',
  'rank_reordered',
  'rank_item_removed',
  'guest_import_applied',
  'save_started',
] as const

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number]

/** Coarse size buckets for the three events that carry one bucket prop. */
export const BULK_ADD_BUCKETS = ['1-3', '4-10', '11+'] as const
export const IMPORT_ROWS_BUCKETS = ['1-10', '11-50', '51+'] as const
export const SAVE_RIDES_BUCKETS = ['1-4', '5-14', '15+'] as const

export type AnalyticsEventProps = {
  bulk_add_bucket?: (typeof BULK_ADD_BUCKETS)[number]
  rows_bucket?: (typeof IMPORT_ROWS_BUCKETS)[number]
  rides_bucket?: (typeof SAVE_RIDES_BUCKETS)[number]
}

/** Summary dimensions: fixed blob positions per Analytics Engine dataset. */
export const ENTRY_SURFACES = ['board', 'rank', 'rider_share', 'coaster', 'park', 'other'] as const
export type EntrySurface = (typeof ENTRY_SURFACES)[number]

export const SESSION_VIEWPORTS = ['mobile', 'desktop'] as const
export type SessionViewport = (typeof SESSION_VIEWPORTS)[number]

export const MAX_SCROLL_BUCKETS = ['none', 'shallow', 'mid', 'deep'] as const
export type MaxScrollBucket = (typeof MAX_SCROLL_BUCKETS)[number]

export const REACHED_STEPS = ['none', 'mark', 'rank', 'save'] as const
export type ReachedStep = (typeof REACHED_STEPS)[number]

export const AUTH_STATES = ['guest', 'authed'] as const
export type AuthState = (typeof AUTH_STATES)[number]

/** ms sentinels: −1 = the thing never happened (never 0, which means instant). */
export type AnalyticsSummaryWire = {
  entry_surface: EntrySurface
  viewport: SessionViewport
  max_scroll: MaxScrollBucket
  reached: ReachedStep
  auth_state: AuthState
  /** page load → first pointer/keyboard interaction; −1 if never. */
  ms_to_first_interaction: number
  /** page load → first ride addition (mark, bulk-add, or import); −1 if never. */
  ms_to_first_mark: number
  /** init → pagehide. */
  duration_ms: number
  mark_count: number
  reorder_count: number
  did_search: 0 | 1
  did_filter: 0 | 1
}

export type AnalyticsEventWire = {
  name: AnalyticsEventName
  props: AnalyticsEventProps
}

export type AnalyticsPayloadWire = {
  events: AnalyticsEventWire[]
  summary: AnalyticsSummaryWire | null
}

const BUCKET_PROPS = ['bulk_add_bucket', 'rows_bucket', 'rides_bucket'] as const

function isBucketValid(name: AnalyticsEventName, props: AnalyticsEventProps): boolean {
  switch (name) {
    case 'park_bulk_add_committed':
      return BULK_ADD_BUCKETS.includes((props.bulk_add_bucket ?? null) as never)
    case 'guest_import_applied':
      return IMPORT_ROWS_BUCKETS.includes((props.rows_bucket ?? null) as never)
    case 'save_started':
      return SAVE_RIDES_BUCKETS.includes((props.rides_bucket ?? null) as never)
    default:
      // No other event carries props.
      return Object.keys(props).length === 0
  }
}

// The ms/duration/count fields are finite non-negative, except the two
// ms_to_* fields which additionally allow the −1 sentinel.
function isSummaryNumberValid(value: unknown, allowSentinel: boolean): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false
  if (value < 0) return allowSentinel && value === -1
  return value <= 2 ** 40 / 1 // generous ceiling; guards garbage payloads
}

/**
 * Validates an untrusted POST /api/sessions body. Returns the normalized
 * payload or null (reject at the worker; the client only ever builds valid
 * payloads, so null on the client means a programming error).
 */
export function parseAnalyticsPayload(body: unknown): AnalyticsPayloadWire | null {
  if (typeof body !== 'object' || body === null) return null
  const raw = body as Record<string, unknown>
  const rawEvents = raw.events
  const rawSummary = raw.summary

  if (!Array.isArray(rawEvents)) return null
  if (rawEvents.length > 50) return null

  const events: AnalyticsEventWire[] = []
  for (const rawEvent of rawEvents) {
    if (typeof rawEvent !== 'object' || rawEvent === null) return null
    const event = rawEvent as Record<string, unknown>
    const name = event.name
    if (typeof name !== 'string' || !(ANALYTICS_EVENT_NAMES as readonly string[]).includes(name)) {
      return null
    }
    const rawProps = event.props ?? {}
    if (typeof rawProps !== 'object' || rawProps === null) return null
    // Drop unknown keys, then type each known one.
    const props: AnalyticsEventProps = {}
    for (const key of BUCKET_PROPS) {
      const value = (rawProps as Record<string, unknown>)[key]
      if (value === undefined) continue
      if (typeof value !== 'string') return null
      ;(props as Record<string, unknown>)[key] = value
    }
    const typed = { name: name as AnalyticsEventName, props }
    if (!isBucketValid(typed.name, typed.props)) return null
    events.push(typed)
  }

  let summary: AnalyticsSummaryWire | null = null
  if (rawSummary !== undefined && rawSummary !== null) {
    if (typeof rawSummary !== 'object') return null
    const s = rawSummary as Record<string, unknown>
    const enumCheck = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
      typeof value === 'string' && allowed.includes(value as T)
    if (
      !enumCheck(s.entry_surface, ENTRY_SURFACES) ||
      !enumCheck(s.viewport, SESSION_VIEWPORTS) ||
      !enumCheck(s.max_scroll, MAX_SCROLL_BUCKETS) ||
      !enumCheck(s.reached, REACHED_STEPS) ||
      !enumCheck(s.auth_state, AUTH_STATES)
    ) {
      return null
    }
    if (
      !isSummaryNumberValid(s.ms_to_first_interaction, true) ||
      !isSummaryNumberValid(s.ms_to_first_mark, true) ||
      !isSummaryNumberValid(s.duration_ms, false) ||
      !isSummaryNumberValid(s.mark_count, false) ||
      !isSummaryNumberValid(s.reorder_count, false)
    ) {
      return null
    }
    const intFlag = (value: unknown) => value === 0 || value === 1
    if (!intFlag(s.did_search) || !intFlag(s.did_filter)) return null
    const num = (value: unknown) => value as number
    summary = {
      entry_surface: s.entry_surface,
      viewport: s.viewport,
      max_scroll: s.max_scroll,
      reached: s.reached,
      auth_state: s.auth_state,
      ms_to_first_interaction: num(s.ms_to_first_interaction),
      ms_to_first_mark: num(s.ms_to_first_mark),
      duration_ms: num(s.duration_ms),
      mark_count: num(s.mark_count),
      reorder_count: num(s.reorder_count),
      did_search: s.did_search as 0 | 1,
      did_filter: s.did_filter as 0 | 1,
    }
  }

  return { events, summary }
}
