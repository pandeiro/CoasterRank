import { useQuery, type QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import {
  serializeParkLocation,
  validateEditSubmission,
  validateNewSubmission,
  validationSummary,
  type ParkLocationInput,
} from './submission-validation'
import type {
  CoasterMaterial,
  CoasterStatus,
  Park,
  RankingBoardPayload,
  RankingRow,
} from './board-types'

// The board payload types live in ./board-types (also imported by the worker)
// and are re-exported here so callers keep their existing import paths.
export type {
  CoasterMaterial,
  CoasterStatus,
  Park,
  RankingBoardPayload,
  RankingRow,
} from './board-types'

// Data access strategy (see PLAN §4.4 / Phase 4) — the "why" behind how the
// board and detail pages load data:
//
// - The board batch-fetches the FULL `v_coaster_rankings` dataset once (via
//   the edge-cached `/api/ranking` worker endpoint, falling back to direct
//   Supabase queries — see the board-data section below), then filters and
//   filters and paginates in the browser (see filterCoasters / BoardPage).
//   The dataset is small enough for this (~1k coasters today, up to ~6.6k if
//   we adopt the full RCDB list), and it makes every filter change instant
//   pure JS with no server round-trip. The tradeoff is a heavier first load
//   (~3 MB raw / ~500 KB gzipped at 6.6k rows); if the catalog ever grows far
//   beyond that, revisit server-side filtering.
//
// - The view is DENORMALIZED for the board: each row carries its park name /
//   slug / country, manufacturer name, and alias list, so search and filtering
//   need no reference lookups (see filterCoasters — it takes rows only).
//   Reference hooks below (useParks, useManufacturers, …) remain for the
//   detail/admin pages, which fetch them independently if deep-linked.
//
// - Incremental rendering (250-row slices via an IntersectionObserver
//   sentinel) keeps the initial DOM small even though all rows are already
//   in memory.

export const PAGE_SIZE = 250
export const FEW_VOTES_THRESHOLD = 10
// Mirrors the RLS insert policy on coaster_submissions (migration
// submission_cap): a user may have at most this many PENDING submissions.
export const SUBMISSION_PENDING_CAP = 5

export const COASTER_STATUSES: readonly CoasterStatus[] = [
  'operating',
  'defunct',
  'sbno',
  'under_construction',
  'relocated',
  'unknown',
]

export const COASTER_MATERIALS: readonly CoasterMaterial[] = ['steel', 'wood', 'hybrid', 'other']

export type AdminPark = Park & {
  lat: number | null
  lng: number | null
  source: string
  external_id: string | null
  coaster_count: number
}

export type Manufacturer = {
  id: string
  name: string
  slug: string
}

// Full manufacturer lineage of a board row, canonical order (position asc,
// added_at desc — same rule the sync_primary_manufacturer trigger and the
// view use). manufacturer_names is optional so app/view deploy skew degrades
// gracefully: a pre-migration view row still yields its single primary name.
export function lineageNames(
  row: Pick<RankingRow, 'manufacturer_names' | 'manufacturer_name'>,
): string[] {
  if (row.manufacturer_names && row.manufacturer_names.length > 0) {
    return row.manufacturer_names.filter((n): n is string => Boolean(n))
  }
  return row.manufacturer_name ? [row.manufacturer_name] : []
}

export function lineageIds(
  row: Pick<RankingRow, 'manufacturer_ids' | 'manufacturer_id'>,
): string[] {
  if (row.manufacturer_ids && row.manufacturer_ids.length > 0) {
    return row.manufacturer_ids.filter((id): id is string => Boolean(id))
  }
  return row.manufacturer_id ? [row.manufacturer_id] : []
}

// materialView: 'wood' = wooden only; 'steel' = steel + hybrids (hybrids ride
// as steel for filtering); 'everything' = all rows including material=other.
export type MaterialView = 'everything' | 'wood' | 'steel'

// allStatuses: true (the default) shows every status; false shows operating
// coasters only. country/manufacturer hold display names straight off the row.
export type RankingFilters = {
  q?: string
  allStatuses: boolean
  materialView: MaterialView
  country?: string
  manufacturer?: string
}

export const DEFAULT_FILTERS: RankingFilters = { allStatuses: true, materialView: 'everything' }

export function isCoasterStatus(value: unknown): value is CoasterStatus {
  return typeof value === 'string' && (COASTER_STATUSES as readonly string[]).includes(value)
}

export function isCoasterMaterial(value: unknown): value is CoasterMaterial {
  return typeof value === 'string' && (COASTER_MATERIALS as readonly string[]).includes(value)
}

// Parse URL search params into filters. Default (no params) = all statuses,
// all materials. status=running (or legacy operating) shows operating only;
// status=all is explicit all (also the default); any other value (legacy
// status=defunct, bogus, etc.) falls back to the default (all).
export function filtersFromSearchParams(params: URLSearchParams): RankingFilters {
  const materialView = params.get('material')
  const statusParam = params.get('status')
  const allStatuses = statusParam === 'running' || statusParam === 'operating' ? false : true
  return {
    q: params.get('q') ?? undefined,
    allStatuses,
    materialView: materialView === 'wood' || materialView === 'steel' ? materialView : 'everything',
    country: params.get('country') ?? undefined,
    manufacturer: params.get('manufacturer') ?? undefined,
  }
}

// Serialize filters to URL search params. The default view (all statuses)
// produces an empty querystring so the canonical board URL stays clean;
// filtering to operating-only writes status=running.
export function filtersToSearchParams(filters: RankingFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (!filters.allStatuses) params.set('status', 'running')
  if (filters.materialView !== 'everything') params.set('material', filters.materialView)
  if (filters.country) params.set('country', filters.country)
  if (filters.manufacturer) params.set('manufacturer', filters.manufacturer)
  return params
}

// Pure client-side filtering over the batch-fetched dataset. Park name/slug/
// country, manufacturer names, and aliases are denormalized onto each row by
// the view, so no reference lookups are needed. The search term matches the
// coaster name, its park, and any former name (alias). The manufacturer
// filter matches ANY lineage entry, so a multi-manufacturer coaster (e.g.
// Top Thrill 2) shows up under both Intamin and Zamperla.
export function filterCoasters(rows: RankingRow[], filters: RankingFilters): RankingRow[] {
  return rows.filter((row) => {
    if (!filters.allStatuses && row.status !== 'operating') return false
    if (filters.materialView === 'wood' && row.material !== 'wood') return false
    if (filters.materialView === 'steel' && row.material !== 'steel' && row.material !== 'hybrid')
      return false
    if (filters.country && row.park_country !== filters.country) return false
    if (filters.manufacturer && !lineageNames(row).includes(filters.manufacturer)) return false
    if (filters.q) {
      const term = filters.q.toLowerCase()
      const haystack = [row.name, row.park_name, ...(row.aliases ?? [])]
      if (!haystack.some((value) => value?.toLowerCase().includes(term))) return false
    }
    return true
  })
}

export function buildParkMap(parks: Park[]): Map<string, Park> {
  return new Map(parks.map((p) => [p.id, p]))
}

// Typeahead search ranking for the /me add-coaster input (previously there
// was NO explicit ordering: matches simply kept the board's incoming order —
// BT score desc — so high-scoring park-name matches crowded out exact-ish
// name matches; e.g. typing "silver" surfaced Silver Dollar City coasters
// ahead of Silver Bullet itself. The user's own ranking has never been a
// factor and still isn't.)
//
// Tiered scoring, cheapest wins:
//   0. coaster name starts with the query
//   1. coaster name contains the query
//   2. an alias (former/regional name, e.g. "Intimidator 305") contains it
//   3. the park name contains it
// Within a tier, operating coasters float above the rest (defunct/sbno/etc.
// all tie): when several coasters match the same way, the rideable ones are
// the likelier intent. Not a filter — defunct rides are legitimately addable
// on a ridden list, they just sort lower. Within (tier, status), board order
// (BT score desc, nulls last) is preserved — Array#sort is stable, so equal
// keys keep their input sequence.
export function filterAndRankCoasters(
  rows: RankingRow[],
  term: string,
  parkMap: Map<string, Park>,
  existingCoasterIds: Set<string>,
): RankingRow[] {
  const q = term.toLowerCase()
  const scored: { row: RankingRow; tier: number; penalty: 0 | 1 }[] = []
  for (const row of rows) {
    if (existingCoasterIds.has(row.id)) continue
    const name = row.name.toLowerCase()
    let tier: number
    if (name.startsWith(q)) tier = 0
    else if (name.includes(q)) tier = 1
    else if (row.aliases?.some((alias) => alias.toLowerCase().includes(q))) tier = 2
    else if (parkMap.get(row.park_id)?.name.toLowerCase().includes(q)) tier = 3
    else continue
    scored.push({ row, tier, penalty: row.status === 'operating' ? 0 : 1 })
  }
  return scored.sort((a, b) => a.tier - b.tier || a.penalty - b.penalty).map((s) => s.row)
}

// Synthetic park the importer uses for coasters with no usable location
// (scripts/import-coasters). Display surfaces substitute a neutral label
// instead of showing this name verbatim (issue #91); matching by name is the
// established convention — see getOtherParkId.
export const OTHER_PARK_NAME = 'Other (unknown location)'

// Compact-surface park label (search results, list rows): the park's name, or
// the fallback for both missing parks and the synthetic "Other" park.
export function parkLabel(park: Park | undefined, fallback: string): string {
  if (!park) return fallback
  return park.name === OTHER_PARK_NAME ? fallback : park.name
}

export function isFewVotes(comparisons: number | null): boolean {
  return comparisons !== null && comparisons < FEW_VOTES_THRESHOLD
}

// First-place votes on the board are gated so the column stays meaningful
// (and non-identifying) while the community is small: data appears once more
// than FIRST_PLACE_MIN_USERS users have submitted a ranking, and only for the
// FIRST_PLACE_TOP_N coasters with the most #1 votes — rules that hold whether
// there are 30 users or 30,000.
export const FIRST_PLACE_MIN_USERS = 30
export const FIRST_PLACE_TOP_N = 10

// "#1 votes" cell value: the raw count plus the share of the coaster's
// rankers who put it first. null when the coaster has no ranked participants.
export function firstPlaceLabel(
  votes: number | null,
  participants: number | null,
): { votes: number; pct: number } | null {
  if (votes === null || participants === null || participants <= 0) return null
  return { votes, pct: Math.round((votes / participants) * 100) }
}

// Ids of rows whose first-place cell shows data: the top N coasters by #1
// votes (ties broken by board rank, at least one vote required), and only
// once the community gate is met.
export function firstPlaceVisibleIds(rows: RankingRow[], rankedUsers: number): Set<string> {
  if (rankedUsers <= FIRST_PLACE_MIN_USERS) return new Set()
  return new Set(
    rows
      .filter((r) => (r.first_place_votes ?? 0) > 0)
      .sort(
        (a, b) =>
          (b.first_place_votes ?? 0) - (a.first_place_votes ?? 0) ||
          (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
          0,
      )
      .slice(0, FIRST_PLACE_TOP_N)
      .map((r) => r.id),
  )
}

export type CountryOption = { country: string; count: number; pinned: boolean }

// Country dropdown ordering: United States pinned first (it dominates the
// catalog and would otherwise be buried), then the rest of the five most
// common countries, then everything else alphabetically. `pinned` marks the
// "Most coasters" optgroup for the UI.
export function countryOptions(rows: RankingRow[]): CountryOption[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    if (!row.park_country) continue
    counts.set(row.park_country, (counts.get(row.park_country) ?? 0) + 1)
  }
  const byCount = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  const pinned = new Set<string>()
  const us = byCount.find(([country]) => country === 'United States')
  if (us) pinned.add('United States')
  for (const [country] of byCount) {
    if (pinned.size >= 5) break
    pinned.add(country)
  }
  const toOption = ([country, count]: [string, number]): CountryOption => ({
    country,
    count,
    pinned: pinned.has(country),
  })
  const top = [
    ...(us ? [us] : []),
    ...byCount.filter(([country]) => pinned.has(country) && country !== 'United States'),
  ]
  const rest = byCount
    .filter(([country]) => !pinned.has(country))
    .sort((a, b) => a[0].localeCompare(b[0]))
  return [...top, ...rest].map(toOption)
}

// Distinct manufacturer names on the board, alphabetically. Unions EVERY
// lineage entry so secondary manufacturers (e.g. the re-track builder) are
// selectable in the filter dropdown too.
export function manufacturerOptions(rows: RankingRow[]): string[] {
  return [...new Set(rows.flatMap((r) => lineageNames(r)))].sort((a, b) => a.localeCompare(b))
}

// URL-safe slug from a display name: lowercase, spaces → dashes, strip the
// rest. Used for admin-created parks/coasters and approved submissions.
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// Coaster slugs are now globally unique (migration coasters_slug_key).
// Historical `UNIQUE(park_id,slug)` allowed e.g. `pteranodon-flyers` at two
// parks; detail page `/coasters/:slug` uses maybeSingle() so those broke.
// New helpers disambiguate with park slug, then manufacturer token, then
// numeric suffix – mirrors the 2026-09-04 ad-hoc fix (see
// docs/audit/2026-09-04-slug-dedup.md).
async function fetchExistingCoasterSlugs(base: string): Promise<Set<string>> {
  const existing = new Set<string>()
  // slugs are `base` or `base-%`; like `base%` is a tight prefix filter,
  // JS then checks exact / dash-prefix so `baseFoo` doesn't count.
  const { data, error } = await supabase
    .from('coasters')
    .select('slug')
    .like('slug', `${base}%`)
    .range(0, 9999)
  if (error) throw error
  for (const row of data as { slug: string }[]) {
    if (row.slug === base || row.slug.startsWith(`${base}-`)) existing.add(row.slug)
  }
  return existing
}

function pickUniqueSlug(
  base: string,
  parkSlug: string | null,
  manufacturerSlug: string | null,
  existing: Set<string>,
): string {
  if (!existing.has(base)) return base
  const parkCandidate = parkSlug && parkSlug !== 'other' ? `${base}-${parkSlug}` : null
  if (parkCandidate && !existing.has(parkCandidate)) return parkCandidate
  const manuCandidate = manufacturerSlug ? `${base}-${manufacturerSlug}` : null
  if (manuCandidate && !existing.has(manuCandidate)) return manuCandidate
  // If park candidate existed but manu was different, try park+manu
  if (parkCandidate && manuCandidate) {
    const combined = `${parkCandidate}-${manufacturerSlug}`
    if (!existing.has(combined)) return combined
  }
  // Numeric suffix fallback (base-2, parkCandidate-2, etc.)
  const stem = parkCandidate ?? manuCandidate ?? base
  let n = 2
  while (existing.has(`${stem}-${n}`)) n++
  return `${stem}-${n}`
}

async function resolveUniqueCoasterSlug(
  base: string,
  parkId: string,
  manufacturerId: string | null = null,
): Promise<string> {
  const [{ data: park, error: parkError }, manuResult, existing] = await Promise.all([
    supabase.from('parks').select('slug').eq('id', parkId).maybeSingle(),
    manufacturerId
      ? supabase.from('manufacturers').select('slug').eq('id', manufacturerId).maybeSingle()
      : Promise.resolve({ data: null } as never),
    fetchExistingCoasterSlugs(base),
  ])
  if (parkError) throw parkError
  if (manuResult.error) throw manuResult.error
  const parkSlug = (park as { slug?: string } | null)?.slug ?? null
  const manuSlug = (manuResult.data as { slug?: string } | null)?.slug ?? null
  return pickUniqueSlug(base, parkSlug, manuSlug, existing)
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' ')
}

// Raw BT strengths hover in a ±3% band around the 1.0 anchor (field average),
// so every surface displays them on one index scale — score × 100, one
// decimal, 100 = community average. Single shared formatter: the board, the
// detail-page hero, and the admin weighting tab must never drift apart (the
// detail page once showed raw 1.03 where the board showed 102.9).
export function formatScore(score: number): string {
  return (score * 100).toFixed(1)
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

export function yearFromDate(date: string | null): number | null {
  if (!date) return null
  const year = Number(date.slice(0, 4))
  return Number.isFinite(year) ? year : null
}

// Optional stats a user suggests for a new coaster (stored as jsonb on
// coaster_submissions.suggested_fields). The five stat keys are always sent
// (null = not suggested); the descriptive keys ride along when provided —
// the DB payload CHECK allows exactly this extended set for kind='new'.
export type SuggestedFields = {
  height_m: number | null
  speed_kmh: number | null
  length_m: number | null
  inversions: number | null
  material: CoasterMaterial | null
  /** Legacy single manufacturer; kept so older pending payloads stay valid. */
  manufacturer_id?: string | null
  /** Proposed lineage (ordered id list); approval REPLACES the lineage. */
  manufacturer_ids?: string[] | null
  /**
   * Manufacturers NOT in the catalog yet, proposed by the submitter.
   * position is the index in the MERGED lineage (0 = primary) — approval
   * creates the rows and interleaves them with manufacturer_ids.
   */
  proposed_manufacturers?: ProposedManufacturer[] | null
  /** Location metadata for a park that does not exist yet (park_id null). */
  park_location?: ParkLocation | null
  status?: CoasterStatus | null
  model?: string | null
  type?: string | null
  opening_date?: string | null
}

/** Proposed new manufacturer: name + slot in the merged lineage (0 = primary). */
export type ProposedManufacturer = { name: string; position: number }

export type { ParkLocation } from './submission-validation'
import type { ParkLocation } from './submission-validation'

/** A lineage entry from the multi picker: an existing manufacturer (id) or a proposed one (id null). */
export type ManufacturerPick = { id: string; name: string } | { id: null; name: string }

/**
 * Serialize the picker's merged ordered list into the two payload keys:
 * existing picks → manufacturer_ids (relative order kept), proposed picks →
 * proposed_manufacturers with their position in the merged list. Nulls mean
 * "absent" per the payload CHECK.
 */
export function serializeManufacturerPicks(picks: ManufacturerPick[]): {
  manufacturer_ids: string[] | null
  proposed_manufacturers: ProposedManufacturer[] | null
} {
  const ids: string[] = []
  const proposals: ProposedManufacturer[] = []
  picks.forEach((pick, position) => {
    // A pick without an id is a proposal (defensive: legacy callers may pass
    // {name} without the id key).
    if (pick.id === null || pick.id === undefined) {
      proposals.push({ name: pick.name.trim(), position })
    } else {
      ids.push(pick.id)
    }
  })
  return {
    manufacturer_ids: ids.length > 0 ? ids : null,
    proposed_manufacturers: proposals.length > 0 ? proposals : null,
  }
}

export type SubmissionKind = 'new' | 'edit'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// Audit C-01, Option B: the ONLY keys from a new-coaster payload that may
// reach the coasters INSERT. The DB CHECK
// (coaster_submissions_payload_check) is the load-bearing guard; this is
// defense in depth so a hostile key can never silently override reviewed
// columns (name/slug/park_id/source/…) via the spread below.
const APPROVABLE_SUBMISSION_FIELDS = [
  'height_m',
  'speed_kmh',
  'length_m',
  'inversions',
  'material',
  'manufacturer_id',
  'manufacturer_ids',
  'status',
  'model',
  'type',
  'opening_date',
] as const

// Extract the proposed manufacturer lineage from a submission payload
// (defense in depth mirroring the DB CHECK's uuid shape rules):
//   undefined        — the payload doesn't touch manufacturers (no write)
//   []               — an explicit clear (replace with nothing)
//   string[]         — the proposed ordered lineage (well-formed ids only)
// The legacy single manufacturer_id normalizes to a one-element list.
export function proposedLineageIds(fields: Record<string, unknown>): string[] | undefined {
  if (Array.isArray(fields.manufacturer_ids)) {
    return fields.manufacturer_ids.filter(
      (id): id is string => typeof id === 'string' && UUID_RE.test(id),
    )
  }
  if (typeof fields.manufacturer_id === 'string' && UUID_RE.test(fields.manufacturer_id)) {
    return [fields.manufacturer_id]
  }
  if (fields.manufacturer_id === null) return []
  return undefined
}

// Builds the INSERT fragment for approving a NEW-coaster submission. Stats
// are sanitized to valid-or-null (nullable columns); material/status are
// OMITTED when absent or malformed so the coasters defaults ('other' /
// 'unknown') apply — writing an explicit null would violate the NOT NULL
// constraint and make the submission unapprovable (e.g. a stats-less
// suggestion like Turbo Track). Descriptive values are re-validated so a
// malformed payload degrades to "field not set" instead of failing (or
// worse, poisoning) the coaster row. Manufacturer lineage does NOT ride on
// the row: it is resolved separately (resolveProposedLineage) into the
// junction table — the primary pointer is trigger-maintained.
function approvableStat(value: unknown, max: number, integer = false): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0 || value > max) return null
  if (integer && !Number.isInteger(value)) return null
  return value
}

function approvableSuggestedFields(fields: SuggestedFields): Partial<SuggestedFields> {
  const row: Partial<SuggestedFields> = {
    height_m: approvableStat(fields.height_m, 500),
    speed_kmh: approvableStat(fields.speed_kmh, 500),
    length_m: approvableStat(fields.length_m, 10000),
    inversions: approvableStat(fields.inversions, 30, true),
  }
  if (isCoasterMaterial(fields.material)) row.material = fields.material
  if (fields.status && isCoasterStatus(fields.status)) row.status = fields.status
  if (typeof fields.model === 'string' && fields.model.length > 0 && fields.model.length <= 120) {
    row.model = fields.model
  }
  if (typeof fields.type === 'string' && fields.type.length > 0 && fields.type.length <= 120) {
    row.type = fields.type
  }
  if (fields.opening_date && ISO_DATE_RE.test(fields.opening_date)) {
    row.opening_date = fields.opening_date
  }
  return row
}

// Scalar fields a user may propose changing on an EXISTING coaster
// (kind='edit'). Stored as a DIFF — only changed keys are present. A park
// move rides on the top-level park_id/park_name columns, never in here;
// slug is never user-editable (detail URLs must stay stable).
export const EDITABLE_SUBMISSION_FIELDS = [...APPROVABLE_SUBMISSION_FIELDS, 'name'] as const

export type EditSuggestedFields = {
  height_m?: number | null
  speed_kmh?: number | null
  length_m?: number | null
  inversions?: number | null
  material?: CoasterMaterial | null
  /** Legacy single manufacturer; kept so older pending payloads stay valid. */
  manufacturer_id?: string | null
  /** Proposed lineage (ordered id list); approval REPLACES the lineage. */
  manufacturer_ids?: string[] | null
  /** Proposed new manufacturers — see SuggestedFields.proposed_manufacturers. */
  proposed_manufacturers?: ProposedManufacturer[] | null
  /** Location metadata for a new-park proposal (park_id null) — see SuggestedFields. */
  park_location?: ParkLocation | null
  status?: CoasterStatus | null
  model?: string | null
  type?: string | null
  opening_date?: string | null
  name?: string | null
}

// The user-editable columns of a coaster, used as the "current" side of an
// edit diff. manufacturer_ids is the current lineage (canonical order) —
// optional so pre-lineage callers / view rows (where the array rides as an
// optional column) still satisfy the type.
export type EditableCoasterSnapshot = Pick<
  Coaster,
  | 'name'
  | 'park_id'
  | 'status'
  | 'material'
  | 'height_m'
  | 'speed_kmh'
  | 'length_m'
  | 'inversions'
  | 'manufacturer_id'
  | 'model'
  | 'type'
  | 'opening_date'
> & { manufacturer_ids?: string[] | null }

// Raw edited values from the suggest-edit form. manufacturerPicks is the
// full ordered lineage list from the multi picker (NOT a diff — the form
// always knows the whole list; entries without an id are proposed new
// manufacturers); diffEditProposal reduces it to a change or nothing.
// park_id is null when the edit proposes a NEW park (parkLocation carries
// its optional location metadata).
export type EditProposalInput = {
  name: string
  park_id: string | null
  status: string
  material: string
  height_m: string
  speed_kmh: string
  length_m: string
  inversions: string
  manufacturerPicks: ManufacturerPick[]
  parkLocation: ParkLocationInput
  model: string
  type: string
  opening_date: string
}

function normalizeNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' && value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

// Pure diff builder (unit-tested): returns only the keys whose proposed value
// differs from current. Empty text clears nullable columns; name requires a
// non-empty value. Park moves are reported separately — the caller carries
// the proposed park on the top-level columns.
export function diffEditProposal(
  current: EditableCoasterSnapshot,
  proposal: EditProposalInput,
): { diff: EditSuggestedFields; parkChanged: boolean } {
  const diff: EditSuggestedFields = {}

  for (const key of ['height_m', 'speed_kmh', 'length_m', 'inversions'] as const) {
    const proposed = normalizeNullableNumber(proposal[key])
    if (proposed !== normalizeNullableNumber(current[key])) diff[key] = proposed
  }

  if (proposal.material !== current.material && isCoasterMaterial(proposal.material)) {
    diff.material = proposal.material
  }
  if (proposal.status !== current.status && isCoasterStatus(proposal.status)) {
    diff.status = proposal.status
  }

  for (const key of ['model', 'type'] as const) {
    const proposed = proposal[key].trim() || null
    if (proposed !== (current[key] ?? null)) diff[key] = proposed
  }

  // Manufacturer lineage rides as the ordered pick list from the multi
  // picker (existing ids + proposed names). Order matters (it decides the
  // primary), so any difference in ids OR sequence is a change; any proposed
  // entry is a change by definition (current lineages never contain
  // proposals). When proposals exist, the id list MUST ride along so
  // approval can replace the lineage with the full merged list.
  // [] = "propose no manufacturers" (explicit clear).
  const serialized = serializeManufacturerPicks(proposal.manufacturerPicks)
  const proposedIds = serialized.manufacturer_ids ?? []
  const currentIds = (current.manufacturer_ids ?? []).filter((id) => Boolean(id))
  const idsChanged =
    proposedIds.length !== currentIds.length || proposedIds.some((id, i) => id !== currentIds[i])
  const hasProposals = (serialized.proposed_manufacturers?.length ?? 0) > 0
  if (idsChanged || hasProposals) {
    diff.manufacturer_ids = proposedIds
    if (hasProposals) diff.proposed_manufacturers = serialized.proposed_manufacturers
  }

  // Location metadata only applies to a NEW park (park_id null).
  if (proposal.park_id === null) {
    const location = serializeParkLocation(proposal.parkLocation)
    if (location) diff.park_location = location
  }

  const proposedName = proposal.name.trim()
  if (proposedName && proposedName !== current.name) diff.name = proposedName

  const proposedDate = proposal.opening_date.trim() || null
  if (proposedDate !== (current.opening_date ?? null)) diff.opening_date = proposedDate

  return { diff, parkChanged: proposal.park_id !== current.park_id }
}

export type CoasterSubmission = {
  id: string
  kind: SubmissionKind
  coaster_id: string | null
  coaster_name: string
  park_name: string
  park_id: string | null
  suggested_fields: SuggestedFields
  note?: string | null
  submitted_by: string
  status: 'pending' | 'approved' | 'rejected'
  reviewer_note: string | null
  reviewed_by: string | null
  created_at: string
  reviewed_at: string | null
  seen_by_submitter_at: string | null
  profiles?: { id: string; avatar_url: string | null; username: string | null } | null
}

export async function submitCoaster(data: {
  coaster_name: string
  park_name: string
  park_id: string | null
  suggested_fields: SuggestedFields
  note?: string | null
}) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  // Schema chokepoint (defense in depth behind the form-level validation in
  // SubmitPage): invalid payloads never reach the DB CHECK as cryptic
  // PostgREST errors, and can never become pending rows an admin cannot
  // accept.
  const errors = validateNewSubmission({
    coaster_name: data.coaster_name,
    park_name: data.park_name,
    park_id: data.park_id,
    suggested_fields: data.suggested_fields as unknown as Record<string, unknown>,
    note: data.note ?? null,
  })
  const summary = validationSummary(errors)
  if (summary) throw new Error(summary)

  const { data: submission, error } = await supabase
    .from('coaster_submissions')
    .insert({
      coaster_name: data.coaster_name,
      park_name: data.park_name,
      park_id: data.park_id,
      suggested_fields: data.suggested_fields,
      note: data.note ?? null,
      submitted_by: user.id,
    })
    .select()
    .single()

  if (error) throw error
  return submission
}

// Suggest changes to an EXISTING coaster (kind='edit'). suggested_fields
// carries only the changed scalar keys (see diffEditProposal); a park move
// is expressed via park_id/park_name — park_id is null together with a
// park_location payload when the edit proposes a park that does not exist
// yet. The DB payload CHECK rejects anything outside the edit allowlist.
export async function submitEditSuggestion(data: {
  coaster_id: string
  coaster_name: string
  park_name: string
  park_id: string | null
  suggested_fields: EditSuggestedFields
  note?: string | null
}) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  // Schema chokepoint (defense in depth behind the form-level validation in
  // SuggestEditPage) — see submitCoaster above.
  const errors = validateEditSubmission({
    coaster_id: data.coaster_id,
    park_id: data.park_id,
    suggested_fields: data.suggested_fields as unknown as Record<string, unknown>,
    note: data.note ?? null,
  })
  const summary = validationSummary(errors)
  if (summary) throw new Error(summary)

  const { data: submission, error } = await supabase
    .from('coaster_submissions')
    .insert({
      kind: 'edit',
      coaster_id: data.coaster_id,
      coaster_name: data.coaster_name,
      park_name: data.park_name,
      park_id: data.park_id,
      suggested_fields: data.suggested_fields,
      note: data.note ?? null,
      submitted_by: user.id,
    })
    .select()
    .single()

  if (error) throw error
  return submission
}

export async function getPendingSubmissions() {
  const { data, error } = await supabase
    .from('coaster_submissions')
    .select('*, profiles!submitted_by(id, avatar_url, username)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as CoasterSubmission[]
}

// The caller's own submissions (RLS filters select to submitted_by = uid for
// non-admins), newest first — shown on /submit so users can track status.
export async function getMySubmissions() {
  const { data, error } = await supabase
    .from('coaster_submissions')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as CoasterSubmission[]
}

// Full coaster rows by id (coasters has a public-read policy) — used by the
// admin queue to render the current side of edit diffs. The lineage rides
// along (ordered ids) so manufacturer diffs show names instead of uuids.
export type CoasterWithLineage = Coaster & { manufacturer_ids: string[] }

export async function getCoastersByIds(ids: string[]): Promise<CoasterWithLineage[]> {
  if (ids.length === 0) return []
  const { data, error } = await supabase
    .from('coasters')
    .select('*, coaster_manufacturers(manufacturer_id, position)')
    .in('id', ids)
    .range(0, 9999)
  if (error) throw error
  return (
    data as Array<
      Coaster & { coaster_manufacturers: { manufacturer_id: string; position: number }[] | null }
    >
  ).map(({ coaster_manufacturers, ...coaster }) => ({
    ...coaster,
    manufacturer_ids: (coaster_manufacturers ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((row) => row.manufacturer_id),
  }))
}

export type SubmitterTrust = {
  submitted_by: string
  approved: number
  rejected: number
  pending: number
}

// Per-submitter outcome tallies for the admin queue's trust chip. Admins can
// select every submission row, so this is one query regardless of queue size.
// (Non-admin callers only ever see their own rows via RLS.)
export async function getSubmitterTrust(ids: string[]): Promise<Map<string, SubmitterTrust>> {
  const trust = new Map<string, SubmitterTrust>()
  const unique = [...new Set(ids)]
  if (unique.length === 0) return trust
  const { data, error } = await supabase
    .from('coaster_submissions')
    .select('submitted_by, status')
    .in('submitted_by', unique)
  if (error) throw error
  for (const row of data as Array<{ submitted_by: string; status: string }>) {
    const entry = trust.get(row.submitted_by) ?? {
      submitted_by: row.submitted_by,
      approved: 0,
      rejected: 0,
      pending: 0,
    }
    if (row.status === 'approved') entry.approved += 1
    else if (row.status === 'rejected') entry.rejected += 1
    else entry.pending += 1
    trust.set(row.submitted_by, entry)
  }
  return trust
}

// Marks the caller's reviewed outcomes as seen (drives the "new result"
// badge on /submit). The security-definer RPC only touches the caller's own
// reviewed, unseen rows — submitters have no direct UPDATE grant.
export async function markMySubmissionsSeen() {
  const { error } = await supabase.rpc('mark_own_submissions_seen')
  if (error) throw error
}

async function markSubmissionApproved(id: string, reviewerId: string) {
  const { error } = await supabase
    .from('coaster_submissions')
    .update({
      status: 'approved',
      reviewed_by: reviewerId,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

export async function rejectSubmission(id: string, note: string) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  const { error } = await supabase
    .from('coaster_submissions')
    .update({
      status: 'rejected',
      reviewer_note: note,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (error) throw error
}

// Reuse an existing park by slug: a new-park submission for a park that a
// prior approval already created (parks.slug is UNIQUE) must link to it
// rather than fail. Returns null when no park has that slug.
async function findParkIdBySlug(slug: string): Promise<string | null> {
  const { data, error } = await supabase.from('parks').select('id').eq('slug', slug).maybeSingle()
  if (error) throw error
  return (data as { id: string } | null)?.id ?? null
}

// Sanitized park_location from a submission payload (defense in depth
// mirroring the DB CHECK): null when absent or fully malformed, so a hostile
// key can never reach the parks INSERT. Valid fields trim/clip individually.
function proposedParkLocation(fields: Record<string, unknown>): ParkLocation | null {
  const raw = fields.park_location
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }
  const source = raw as Record<string, unknown>
  const out: ParkLocation = {}
  for (const key of ['city', 'region', 'country'] as const) {
    const value = source[key]
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed.length >= 1 && trimmed.length <= 120) out[key] = trimmed
    }
  }
  const lat = source.lat
  if (typeof lat === 'number' && Number.isFinite(lat) && lat >= -90 && lat <= 90) out.lat = lat
  const lng = source.lng
  if (typeof lng === 'number' && Number.isFinite(lng) && lng >= -180 && lng <= 180) {
    out.lng = lng
  }
  return Object.keys(out).length > 0 ? out : null
}

// Create-or-reuse the park a submission is homed to. park_id set → link as
// is; free-text park name → reuse the community park a prior approval may
// have already minted, else create it with the submitter's proposed location
// metadata attached. Returns null when no park could be resolved.
async function ensureParkForSubmission(submission: CoasterSubmission): Promise<string | null> {
  if (submission.park_id) return submission.park_id
  const parkSlug = slugify(submission.park_name)
  const location = proposedParkLocation(
    (submission.suggested_fields ?? {}) as unknown as Record<string, unknown>,
  )
  const existingId = await findParkIdBySlug(parkSlug)
  if (existingId) return existingId
  const { data: park, error: parkError } = await supabase
    .from('parks')
    .insert({
      name: submission.park_name,
      slug: parkSlug,
      source: 'community',
      ...(location ?? {}),
    })
    .select()
    .single()
  if (!parkError) return (park as { id: string }).id
  if (parkError.code !== '23505') throw parkError
  // Race: another approval created the park between our lookup and insert
  // (e.g. two "Rowdy Bear" submissions in one queue) — resolve the winner
  // by slug and reuse it.
  return findParkIdBySlug(parkSlug)
}

// Create-or-reuse a manufacturer by slug (proposed by a submitter; approval
// runs as an admin, which holds the manufacturers write grant).
async function ensureManufacturerId(name: string): Promise<string> {
  const trimmed = name.trim()
  const slug = slugify(trimmed)
  const { data: existing, error: fetchError } = await supabase
    .from('manufacturers')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (fetchError) throw fetchError
  if (existing) return (existing as { id: string }).id
  const { data: created, error } = await supabase
    .from('manufacturers')
    .insert({ name: trimmed, slug })
    .select('id')
    .single()
  if (!error) return (created as { id: string }).id
  if (error.code !== '23505') throw error
  // Race: another approval minted it first — resolve the winner by slug.
  const winner = await supabase.from('manufacturers').select('id').eq('slug', slug).maybeSingle()
  if (winner.error) throw winner.error
  const id = (winner.data as { id: string } | null)?.id
  if (!id) throw error
  return id
}

// Defense-in-depth parse of a payload's proposed_manufacturers array
// (mirrors the DB CHECK): well-formed {name, position} entries only.
export function parseProposedManufacturers(
  raw: unknown,
): Array<{ name: string; position: number }> {
  return (Array.isArray(raw) ? raw : [])
    .filter(
      (entry): entry is Record<string, unknown> =>
        entry !== null && typeof entry === 'object' && !Array.isArray(entry),
    )
    .map((entry) => ({
      name: typeof entry.name === 'string' ? entry.name.trim() : '',
      position: typeof entry.position === 'number' ? entry.position : -1,
    }))
    .filter(
      (p): p is { name: string; position: number } =>
        p.name.length >= 1 &&
        p.name.length <= 80 &&
        Number.isInteger(p.position) &&
        p.position >= 0 &&
        p.position <= 9,
    )
}

// Pure slot-merge shared by approval (resolveProposedLineage) and the admin
// queue display: entries are manufacturer ids (existing rows) or proposed
// names, each at its slot in the MERGED lineage. Extra slots (a proposal
// positioned past the current count) are backfilled with the remaining ids.
function mergeLineageSlots(
  ids: string[],
  proposals: Array<{ name: string; position: number }>,
): Array<string | { name: string }> {
  const total = ids.length + proposals.length
  // Proposals positioned past the merged size are unplaceable — drop them
  // (validators and the DB CHECK forbid this; defense in depth for rows
  // written before the rule existed).
  const usable = proposals.filter((p) => p.position < total)
  const size = Math.max(total, ...usable.map((p) => p.position + 1), 0)
  const slots: Array<string | { name: string } | null> = Array(size).fill(null)
  // First proposal wins a disputed slot (the DB CHECK forbids duplicates —
  // this is defense in depth for rows written before the rule existed).
  for (const proposal of usable) {
    if (slots[proposal.position] === null) slots[proposal.position] = { name: proposal.name }
  }
  let nextId = 0
  return slots.map((slot) => {
    if (slot) return slot
    const id = ids[nextId++]
    return id ?? ''
  })
}

// Merge a submission's manufacturer payload into one ordered id list:
// manufacturer_ids (existing rows, relative order kept) plus
// proposed_manufacturers (created on demand) placed at their `position`
// slots in the merged lineage — a proposal at position 0 becomes the
// primary. Returns
//   undefined  — the payload doesn't touch manufacturers (no lineage write)
//   string[]   — the merged, ordered lineage for setCoasterLineage
async function resolveProposedLineage(
  fields: Record<string, unknown>,
): Promise<string[] | undefined> {
  const ids = proposedLineageIds(fields)
  const proposals = parseProposedManufacturers(fields.proposed_manufacturers)
  if (ids === undefined && proposals.length === 0) return undefined

  const slots = mergeLineageSlots(ids ?? [], proposals)
  const merged: string[] = []
  for (const slot of slots) {
    merged.push(typeof slot === 'string' ? slot : await ensureManufacturerId(slot.name))
  }
  return merged
}

// Merged lineage for DISPLAY (admin queue): existing ids resolved to names
// via nameById, proposed entries rendered as "Name (new)". Returns null when
// the payload doesn't touch manufacturers.
export function mergedLineageDisplay(
  fields: Record<string, unknown>,
  nameById?: Map<string, string>,
): string | null {
  const ids = proposedLineageIds(fields)
  const proposals = parseProposedManufacturers(fields.proposed_manufacturers)
  if (ids === undefined && proposals.length === 0) return null
  return mergeLineageSlots(ids ?? [], proposals)
    .map((slot) =>
      typeof slot === 'string' ? (nameById?.get(slot) ?? slot) : `${slot.name} (new)`,
    )
    .join(' · ')
}

export async function approveSubmission(id: string, submission: CoasterSubmission) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  // Logic to create/link park and manufacturer.
  // 1. Park: existing link, else community mint (with proposed location).
  const parkId = await ensureParkForSubmission(submission)
  if (!parkId) throw new Error(`Could not create park "${submission.park_name}".`)

  // 2. Create Coaster — globally unique slug (park suffix fallback).
  // Manufacturer lineage (existing ids + proposed entries) rides via
  // coaster_manufacturers AFTER the row lands (the coasters row no longer
  // carries a manufacturer column; the primary pointer is trigger-maintained).
  const approved = approvableSuggestedFields(submission.suggested_fields)
  const baseSlug = slugify(submission.coaster_name)
  let coasterSlug = await resolveUniqueCoasterSlug(baseSlug, parkId, null)
  let coasterError: { code?: string; message: string } | null = null
  let createdCoasterId: string | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: created, error } = await supabase
      .from('coasters')
      .insert({
        park_id: parkId,
        name: submission.coaster_name,
        slug: coasterSlug,
        source: 'community',
        // C-01: explicit allowlist — never spread the raw payload, so a
        // hostile key (park_id/name/slug/source/…) cannot override reviewed
        // columns.
        ...approved,
      })
      .select('id')
      .single()
    if (!error) {
      coasterError = null
      createdCoasterId = (created as { id: string }).id
      break
    }
    if (error.code !== '23505') {
      coasterError = error
      break
    }
    // Race: another insert claimed the slug between our check and insert.
    // Re-resolve with fresh DB state and retry (numeric suffix path).
    const existing = await fetchExistingCoasterSlugs(baseSlug)
    const parkRes = await supabase.from('parks').select('slug').eq('id', parkId).maybeSingle()
    if (parkRes.error) throw parkRes.error
    const parkSlug = (parkRes.data as { slug?: string } | null)?.slug ?? null
    coasterSlug = pickUniqueSlug(baseSlug, parkSlug, null, existing)
    // force numeric on second retry if still taken
    if (attempt === 1 && existing.has(coasterSlug)) {
      let n = 2
      while (existing.has(`${coasterSlug}-${n}`)) n++
      coasterSlug = `${coasterSlug}-${n}`
    }
    coasterError = error
  }

  if (coasterError) {
    throw coasterError.code === '23505'
      ? new Error(
          `A coaster named "${submission.coaster_name}" already exists (slug ${coasterSlug} is taken).`,
        )
      : coasterError
  }

  // 3. Lineage: existing ids + proposed manufacturers (minted on demand).
  if (createdCoasterId) {
    const lineage = await resolveProposedLineage(
      (submission.suggested_fields ?? {}) as unknown as Record<string, unknown>,
    )
    if (lineage && lineage.length > 0) {
      await setCoasterLineage(createdCoasterId, lineage, 'submission')
    }
  }

  // 4. Update Submission Status
  await markSubmissionApproved(id, user.id)
}

// Approve an edit suggestion: apply the allowlisted diff onto the target
// coaster row. Park moves come from the top-level park_id column (never the
// payload — C-01); a null park_id with a park_name is a NEW-park proposal,
// which ensureParkForSubmission mints (with the proposed park_location).
// Slug is deliberately untouched so detail URLs stay stable.
// (last_verified_at was removed from coasters in
// 20260823023126_remove_track_a_dedup_infrastructure.sql — do not write it.)
export async function approveEditSubmission(id: string, submission: CoasterSubmission) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')
  if (!submission.coaster_id) throw new Error('Edit submission is missing its coaster.')

  // Defense in depth mirroring the DB CHECK: only allowlisted keys leave the
  // payload, and enum/text values are re-validated before the UPDATE.
  const fields = (submission.suggested_fields ?? {}) as Record<string, unknown>
  const updates: Record<string, number | string | null> = {}

  for (const key of ['height_m', 'speed_kmh', 'length_m', 'inversions'] as const) {
    const raw = fields[key]
    if (raw === undefined) continue
    if (raw === null) {
      updates[key] = null
    } else if (typeof raw === 'number' && Number.isFinite(raw)) {
      updates[key] = raw
    }
    // Anything else failed the DB CHECK already; skip rather than apply.
  }

  if (typeof fields.material === 'string' && isCoasterMaterial(fields.material)) {
    updates.material = fields.material
  }
  if (typeof fields.status === 'string' && isCoasterStatus(fields.status)) {
    updates.status = fields.status
  }
  for (const key of ['model', 'type'] as const) {
    const raw = fields[key]
    if (raw === null) updates[key] = null
    else if (typeof raw === 'string' && raw.length <= 120) updates[key] = raw
  }
  if (typeof fields.name === 'string' && fields.name.length >= 1 && fields.name.length <= 120) {
    updates.name = fields.name
  }
  if (typeof fields.opening_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fields.opening_date)) {
    updates.opening_date = fields.opening_date
  } else if (fields.opening_date === null) {
    updates.opening_date = null
  }

  // Park move (existing id) or new-park proposal (null id + park_name).
  const parkId = await ensureParkForSubmission(submission)
  if (!parkId) throw new Error('Edit submission is missing its park.')
  updates.park_id = parkId

  const { error } = await supabase.from('coasters').update(updates).eq('id', submission.coaster_id)
  if (error) throw error

  // An accepted manufacturer proposal REPLACES the whole lineage with the
  // merged list (decided 2026-09; existing ids + proposed entries) —
  // undefined means the payload didn't touch manufacturers, so leave it
  // alone.
  const lineage = await resolveProposedLineage(fields)
  if (lineage !== undefined) {
    await setCoasterLineage(submission.coaster_id, lineage, 'submission')
  }

  await markSubmissionApproved(id, user.id)
}

export type Coaster = {
  id: string
  park_id: string
  name: string
  slug: string
  manufacturer_id: string | null
  model: string | null
  opening_date: string | null
  status: CoasterStatus
  material: CoasterMaterial
  height_m: number | null
  speed_kmh: number | null
  length_m: number | null
  inversions: number | null
  type: string | null
  source: string
  external_id: string | null
}

// A coaster row as the admin console sees it: the full row plus the joined
// park name, manufacturer name, ride count, and the ordered lineage ids the
// edit modal's multi picker seeds from.
export type AdminCoaster = Coaster & {
  parks: { name: string; slug: string } | null
  manufacturers: { name: string } | null
  ride_count: number
  coaster_manufacturers: { manufacturer_id: string; position: number }[]
}

export async function getAllCoastersAdmin() {
  // Ride counts come from the admin-gated security-definer RPC: the previous
  // `ride_count:user_rides(count)` aggregate embed ran under the CALLER's RLS
  // (user_rides is own-rows-only), so admins saw 0 rides for every coaster
  // they hadn't personally ridden. `coaster_ride_counts()` (migration
  // 20260911000300) bypasses RLS but returns an empty set for non-admins.
  const [rows, counts] = await Promise.all([
    supabase
      .from('coasters')
      .select(
        // `manufacturers` MUST be pinned to the direct FK: since
        // coaster_manufacturers (the lineage junction) also links coasters →
        // manufacturers, the bare embed is ambiguous (PostgREST PGRST201) and
        // the whole admin query 400s without the `!coasters_manufacturer_id_fkey`
        // hint. Same pin in lib/rides.ts.
        '*, parks(name, slug), manufacturers!coasters_manufacturer_id_fkey(name), ' +
          'coaster_manufacturers(manufacturer_id, position)',
      )
      .order('name')
      .range(0, 9999),
    // The RPC ships in the same merge; on deploy skew (app up, db push
    // lagging) degrade to zeros instead of failing the whole panel.
    rideCountsBestEffort(),
  ])
  if (rows.error) throw rows.error
  const ridesByCoasterId = new Map(counts.map((row) => [row.coaster_id, row.rides]))
  return (
    rows.data as unknown as Array<
      Omit<AdminCoaster, 'coaster_manufacturers' | 'ride_count'> & {
        coaster_manufacturers: { manufacturer_id: string; position: number }[] | null
      }
    >
  ).map((c) => ({
    ...c,
    coaster_manufacturers: (c.coaster_manufacturers ?? [])
      .slice()
      .sort((a, b) => a.position - b.position),
    ride_count: ridesByCoasterId.get(c.id) ?? 0,
  }))
}

// Per-coaster ride counts for the admin console. Any failure (RPC missing on
// deploy skew, network) logs a warning and yields an empty map — the panel
// still loads, counts just read as 0 until the next reload.
async function rideCountsBestEffort(): Promise<Array<{ coaster_id: string; rides: number }>> {
  try {
    const { data, error } = await supabase.rpc('coaster_ride_counts')
    if (error) throw error
    return (data ?? []) as Array<{ coaster_id: string; rides: number }>
  } catch (err) {
    console.warn('[admin] coaster_ride_counts failed:', err instanceof Error ? err.message : err)
    return []
  }
}

// Replace a coaster's manufacturer lineage with an ordered id list. Ids are
// deduped and positions resequenced 0..n-1, so explicit order always wins
// over the "newest added" default once a save happens. The primary pointer
// (coasters.manufacturer_id) is maintained by the sync_primary_manufacturer
// trigger — never write that column directly. An empty list clears the
// lineage (pointer becomes NULL).
export async function setCoasterLineage(
  coasterId: string,
  manufacturerIds: string[],
  source: 'admin' | 'submission',
): Promise<void> {
  const ids = [...new Set(manufacturerIds)].filter((id) => UUID_RE.test(id))

  const { data: existing, error: fetchError } = await supabase
    .from('coaster_manufacturers')
    .select('manufacturer_id')
    .eq('coaster_id', coasterId)
    .range(0, 999)
  if (fetchError) throw fetchError

  const stale = [...new Set((existing ?? []).map((row) => row.manufacturer_id))].filter(
    (id) => !ids.includes(id),
  )
  if (stale.length > 0) {
    const { error } = await supabase
      .from('coaster_manufacturers')
      .delete()
      .eq('coaster_id', coasterId)
      .in('manufacturer_id', stale)
    if (error) throw error
  }

  if (ids.length > 0) {
    const { error } = await supabase.from('coaster_manufacturers').upsert(
      ids.map((manufacturer_id, position) => ({
        coaster_id: coasterId,
        manufacturer_id,
        position,
        source,
      })),
      { onConflict: 'coaster_id,manufacturer_id' },
    )
    if (error) throw error
  }
}

export async function updateCoaster(id: string, updates: Partial<Coaster>) {
  // If slug is being set explicitly ensure global uniqueness (e.g. admin rename)
  if (updates.slug) {
    const existing = await fetchExistingCoasterSlugs(
      updates.slug.replace(/-\d+$/, '').replace(/-[a-z0-9-]+$/, updates.slug)
        ? updates.slug
        : updates.slug,
    )
    // simpler: just check exact slug exists for another coaster
    const { data, error } = await supabase
      .from('coasters')
      .select('id')
      .eq('slug', updates.slug)
      .neq('id', id)
      .maybeSingle()
    if (error) throw error
    if (data) {
      // auto-disambiguate: keep caller's slug as base and add numeric suffix
      let n = 2
      let candidate = `${updates.slug}-${n}`
      while (true) {
        const { data: clash, error: clashError } = await supabase
          .from('coasters')
          .select('id')
          .eq('slug', candidate)
          .maybeSingle()
        if (clashError) throw clashError
        if (!clash) break
        n++
        candidate = `${updates.slug}-${n}`
      }
      updates = { ...updates, slug: candidate }
    }
    void existing // keep helper reachable for future use
  }
  const { error } = await supabase.from('coasters').update(updates).eq('id', id)
  if (error) throw error
}

export async function createCoaster(data: Partial<Coaster>, lineageIds?: string[]) {
  if (data.name && data.park_id) {
    const base = data.slug ? data.slug : slugify(data.name)
    const unique = await resolveUniqueCoasterSlug(
      base,
      data.park_id,
      (data.manufacturer_id as string | null) ?? null,
    )
    data = { ...data, slug: unique }
  }
  // The primary pointer is trigger-maintained from coaster_manufacturers —
  // never write manufacturer_id on the row itself.
  const { manufacturer_id: _ignored, ...row } = data
  void _ignored
  let lastError: { code?: string } | null = null
  let attemptSlug = row.slug as string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: result, error } = await supabase.from('coasters').insert(row).select().single()
    if (!error) {
      if (lineageIds && lineageIds.length > 0) {
        await setCoasterLineage(result.id, lineageIds, 'admin')
      }
      return result
    }
    if (error.code !== '23505' || !attemptSlug || !row.park_id) throw error
    lastError = error
    const existing = await fetchExistingCoasterSlugs(attemptSlug.replace(/-\d+$/, ''))
    let n = 2
    while (existing.has(`${attemptSlug}-${n}`)) n++
    attemptSlug = `${attemptSlug}-${n}`
    row.slug = attemptSlug
  }
  throw lastError ?? new Error('Failed to create coaster')
}

export async function deleteCoaster(id: string) {
  const { error } = await supabase.from('coasters').delete().eq('id', id)
  if (error) throw error
}

// Park admin CRUD ----------------------------------------------------------

export async function getAllParksAdmin() {
  const { data, error } = await supabase
    .from('parks')
    .select('*, coaster_count:coasters(count)')
    .order('name')
    .range(0, 9999)
  if (error) throw error
  return (data as Array<AdminPark & { coaster_count: [{ count: number }] }>).map((p) => ({
    ...p,
    coaster_count: p.coaster_count?.[0]?.count ?? 0,
  }))
}

export async function updatePark(id: string, updates: Partial<AdminPark>) {
  const { error } = await supabase.from('parks').update(updates).eq('id', id)
  if (error) throw error
}

export async function createPark(data: Partial<AdminPark>) {
  const { data: result, error } = await supabase.from('parks').insert(data).select().single()
  if (error) throw error
  return result as AdminPark
}

export async function deletePark(id: string) {
  const { error } = await supabase.from('parks').delete().eq('id', id)
  if (error) throw error
}

// Re-home helpers ----------------------------------------------------------

export async function getOtherParkId() {
  const { data, error } = await supabase
    .from('parks')
    .select('id')
    .eq('name', OTHER_PARK_NAME)
    .maybeSingle()
  if (error) throw error
  return data?.id
}

export async function getCoastersInPark(parkId: string) {
  const { data, error } = await supabase
    .from('coasters')
    .select('*')
    .eq('park_id', parkId)
    .order('name')
    .range(0, 9999)
  if (error) throw error
  return data as Coaster[]
}

export async function moveCoasterToPark(coasterId: string, newParkId: string) {
  const { error } = await supabase
    .from('coasters')
    .update({ park_id: newParkId })
    .eq('id', coasterId)
  if (error) throw error
}

// The whole board dataset (rankings + parks) --------------------------------
//
// Fetch path (Phase 4.2): the edge-cached worker endpoint `/api/ranking`
// (Cloudflare Cache API, 15-minute TTL — mirrors the pg_cron recompute
// cadence) so board/homepage loads skip Supabase entirely. Falls back to
// direct Supabase queries when the worker is unavailable (Vite dev server,
// worker outage) so the board degrades gracefully.
//
// One query powers both slices: useAllCoasters and useParks share the
// ['board-data'] cache entry (select projects each slice), so a page mounting
// both — e.g. the search bar — triggers a single network fetch. staleTime
// matches the 15-minute recompute cadence: refetching more often than the
// data can change is pure waste. Mutations that need immediate freshness
// (admin flows) call refreshBoardData(), which bypasses the edge cache.
export const BOARD_QUERY_KEY = ['board-data'] as const
export const BOARD_STALE_TIME_MS = 15 * 60_000

async function fetchBoardDataFromSupabase(): Promise<RankingBoardPayload> {
  const [rankings, parks, boardMeta] = await Promise.all([
    supabase
      .from('v_coaster_rankings')
      .select('*')
      .order('score', { ascending: false, nullsFirst: false })
      .range(0, 9999),
    supabase.from('parks').select('id, name, slug, country, region, city').order('name'),
    // Best-effort (same RPC the worker reads): board-meta extras must never
    // block the board itself, so failure resolves to nulls. During the
    // ranked_user_count rollout the RPC may return 2 columns; treat missing as
    // null (gate closed) for back-compat.
    (async () => {
      const { data, error } = await supabase.rpc('public_board_meta')
      if (error) {
        // Best-effort: don't block board on meta RPC failure; log for
        // observability and degrade to nulls (gate closed / users hidden).
        console.warn('[board] public_board_meta failed:', error.message)
        return {
          last_recomputed_at: null,
          real_user_count: null,
          ranked_user_count: null,
        } as Pick<
          RankingBoardPayload,
          'last_recomputed_at' | 'real_user_count' | 'ranked_user_count'
        >
      }
      const row = Array.isArray(data) ? data[0] : (data as Record<string, unknown> | null)
      // toCount is intentionally duplicated with worker.ts:400 — keep the
      // two bundles independent (board-types is types-only, no shared runtime
      // util) to avoid cross-contaminating the edge bundle.
      const toCount = (raw: unknown) => {
        if (raw == null) return null
        const n = Number(raw as number | string)
        return Number.isFinite(n) ? n : null
      }
      return {
        last_recomputed_at:
          (row as { last_recomputed_at?: string | null } | null)?.last_recomputed_at ?? null,
        real_user_count: toCount((row as { real_user_count?: unknown } | null)?.real_user_count),
        ranked_user_count: toCount(
          (row as { ranked_user_count?: unknown } | null)?.ranked_user_count,
        ),
      } as Pick<RankingBoardPayload, 'last_recomputed_at' | 'real_user_count' | 'ranked_user_count'>
    })(),
  ])
  if (rankings.error) throw rankings.error
  if (parks.error) throw parks.error
  return {
    rankings: rankings.data as RankingRow[],
    parks: parks.data as Park[],
    generated_at: new Date().toISOString(),
    last_recomputed_at: boardMeta.last_recomputed_at,
    real_user_count: boardMeta.real_user_count,
    ranked_user_count: boardMeta.ranked_user_count,
  }
}

async function fetchBoardData(): Promise<RankingBoardPayload> {
  try {
    const response = await fetch('/api/ranking')
    if (response.ok) {
      const payload = (await response.json()) as RankingBoardPayload
      if (Array.isArray(payload.rankings) && Array.isArray(payload.parks)) return payload
    }
  } catch {
    // Worker unreachable (dev server, outage) — fall through to Supabase.
  }
  return fetchBoardDataFromSupabase()
}

// Post-mutation freshness for admin flows: refetches straight from Supabase
// (bypassing the worker's edge cache) and seeds the ['board-data'] cache, so
// the board reflects the change immediately — a plain invalidateQueries would
// refetch through the edge cache and could serve up-to-15-minute-old data.
export async function refreshBoardData(queryClient: QueryClient): Promise<void> {
  const data = await fetchBoardDataFromSupabase()
  queryClient.setQueryData(BOARD_QUERY_KEY, data)
}

// The whole rankings dataset, fetched once. Ordered by BT score so filtering
// preserves the ranking. Filters and pagination happen client-side.
// refetchInterval (aligned with the 15-min recompute cadence): a tab that
// sits open still lands each recompute within ~30 min (edge TTL + interval),
// which is what powers the board's turnover detection (useRankTurnover) —
// without polling, the page would never show rank movement on its own.
// refetchIntervalInBackground stays false: hidden tabs pick changes up on
// focus instead.
export function useAllCoasters() {
  return useQuery({
    queryKey: BOARD_QUERY_KEY,
    queryFn: fetchBoardData,
    staleTime: BOARD_STALE_TIME_MS,
    refetchInterval: BOARD_STALE_TIME_MS,
    select: (data) => data.rankings,
  })
}

export function useCoaster(slug: string | undefined) {
  return useQuery({
    queryKey: ['coaster', slug],
    enabled: Boolean(slug),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_coaster_rankings')
        .select('*')
        .eq('slug', slug!)
        .maybeSingle()
      if (error) throw error
      return data as RankingRow | null
    },
  })
}

export function usePark(slug: string | undefined) {
  return useQuery({
    queryKey: ['park', slug],
    enabled: Boolean(slug),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parks')
        .select('*')
        .eq('slug', slug!)
        .maybeSingle()
      if (error) throw error
      return data as Park | null
    },
  })
}

export function useParks() {
  return useQuery({
    queryKey: BOARD_QUERY_KEY,
    queryFn: fetchBoardData,
    staleTime: BOARD_STALE_TIME_MS,
    select: (data) => data.parks,
  })
}

export function useManufacturers() {
  return useQuery({
    queryKey: ['manufacturers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('manufacturers')
        .select('id, name, slug')
        .order('name')
      if (error) throw error
      return data as Manufacturer[]
    },
  })
}

// Board meta (real/ranked user counts + last recompute time) from the same
// ['board-data'] cache entry as useAllCoasters/useParks — one cached payload
// powers every slice, so no extra RPC is needed. ranked_user_count drives
// the first-place gate; real_user_count the status-line users pill.
// Previously useRankedUserCount() called the dedicated ranked_user_count() RPC
// per page load — now folded into public_board_meta() via /api/ranking.
export function useBoardMeta() {
  return useQuery({
    queryKey: BOARD_QUERY_KEY,
    queryFn: fetchBoardData,
    staleTime: BOARD_STALE_TIME_MS,
    select: (data) => ({
      last_recomputed_at: data.last_recomputed_at,
      real_user_count: data.real_user_count,
      ranked_user_count: data.ranked_user_count,
      generated_at: data.generated_at,
    }),
  })
}

// Detail-page freshness: the same public_board_meta() RPC the board reads, but
// fetched standalone under its OWN query key — deliberately NOT BOARD_QUERY_KEY,
// which would drag the entire /api/ranking payload (all rankings + parks) onto
// pages that only need one timestamp. Best-effort like the board's copy: an RPC
// failure resolves to null and the UI hides the freshness marker instead of
// erroring the page. (coaster_ratings.updated_at is NOT a usable source — the
// recompute upsert never writes it, so it holds first-insert values.)
const RECOMPUTE_META_STALE_TIME_MS = 5 * 60_000

export function useRecomputeFreshness() {
  return useQuery({
    queryKey: ['recompute-meta'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase.rpc('public_board_meta')
      if (error) {
        console.warn('[board] public_board_meta failed:', error.message)
        return null
      }
      const row = Array.isArray(data) ? data[0] : (data as Record<string, unknown> | null)
      return (row as { last_recomputed_at?: string | null } | null)?.last_recomputed_at ?? null
    },
    staleTime: RECOMPUTE_META_STALE_TIME_MS,
  })
}

// Back-compat alias — prefers the cached payload's ranked_user_count so the
// first-place gate shares the same staleness as the board itself (BOARD_STALE_TIME_MS
// = 15m client + 15m edge TTL → worst-case ≤30m stale, intentional per PR;
// previous standalone hook used default staleTime 0). Hard-removed the per-load
// ranked_user_count() RPC (now served via public_board_meta + /api/ranking);
// this shim keeps the call-site signature stable during the rollout.
// Shares BOARD_QUERY_KEY with useBoardMeta — React Query dedups the fetch and
// applies each observer's select independently.
export function useRankedUserCount() {
  return useQuery({
    queryKey: BOARD_QUERY_KEY,
    queryFn: fetchBoardData,
    staleTime: BOARD_STALE_TIME_MS,
    select: (data) => data.ranked_user_count ?? 0,
  })
}

// Coaster aliases -----------------------------------------------------------

export type CoasterAlias = {
  id: string
  coaster_id: string
  name: string
  created_at: string
}

export function useCoasterAliases(coasterId: string | undefined) {
  return useQuery({
    queryKey: ['coaster-aliases', coasterId],
    enabled: Boolean(coasterId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coaster_aliases')
        .select('*')
        .eq('coaster_id', coasterId!)
        .order('name')
      if (error) throw error
      return data as CoasterAlias[]
    },
  })
}

export async function addAlias(coasterId: string, name: string) {
  const { error } = await supabase.from('coaster_aliases').insert({ coaster_id: coasterId, name })
  if (error) throw error
}

export async function updateAlias(id: string, name: string) {
  const { error } = await supabase.from('coaster_aliases').update({ name }).eq('id', id)
  if (error) throw error
}

export async function deleteAlias(id: string) {
  const { error } = await supabase.from('coaster_aliases').delete().eq('id', id)
  if (error) throw error
}
