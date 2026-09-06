import { useQuery, type QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
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
// country, manufacturer name, and aliases are denormalized onto each row by
// the view, so no reference lookups are needed. The search term matches the
// coaster name, its park, and any former name (alias).
export function filterCoasters(rows: RankingRow[], filters: RankingFilters): RankingRow[] {
  return rows.filter((row) => {
    if (!filters.allStatuses && row.status !== 'operating') return false
    if (filters.materialView === 'wood' && row.material !== 'wood') return false
    if (filters.materialView === 'steel' && row.material !== 'steel' && row.material !== 'hybrid')
      return false
    if (filters.country && row.park_country !== filters.country) return false
    if (filters.manufacturer && row.manufacturer_name !== filters.manufacturer) return false
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
// Within a tier, board order (BT score desc, nulls last) is preserved —
// Array#sort is stable, so equal tiers keep their input sequence.
export function filterAndRankCoasters(
  rows: RankingRow[],
  term: string,
  parkMap: Map<string, Park>,
  existingCoasterIds: Set<string>,
): RankingRow[] {
  const q = term.toLowerCase()
  const scored: { row: RankingRow; tier: number }[] = []
  for (const row of rows) {
    if (existingCoasterIds.has(row.id)) continue
    const name = row.name.toLowerCase()
    let tier: number
    if (name.startsWith(q)) tier = 0
    else if (name.includes(q)) tier = 1
    else if (row.aliases?.some((alias) => alias.toLowerCase().includes(q))) tier = 2
    else if (parkMap.get(row.park_id)?.name.toLowerCase().includes(q)) tier = 3
    else continue
    scored.push({ row, tier })
  }
  return scored.sort((a, b) => a.tier - b.tier).map((s) => s.row)
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

// Distinct manufacturer names on the board, alphabetically.
export function manufacturerOptions(rows: RankingRow[]): string[] {
  return [...new Set(rows.map((r) => r.manufacturer_name).filter((v): v is string => !!v))].sort(
    (a, b) => a.localeCompare(b),
  )
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

export function formatScore(score: number): string {
  return score.toFixed(2)
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
// coaster_submissions.suggested_fields and spread into the coaster row on
// approval).
export type SuggestedFields = {
  height_m: number | null
  speed_kmh: number | null
  length_m: number | null
  inversions: number | null
  material: CoasterMaterial | null
}

export type CoasterSubmission = {
  id: string
  coaster_name: string
  park_name: string
  park_id: string | null
  suggested_fields: SuggestedFields
  submitted_by: string
  status: 'pending' | 'approved' | 'rejected'
  reviewer_note: string | null
  reviewed_by: string | null
  created_at: string
  reviewed_at: string | null
  profiles?: { id: string; avatar_url: string | null; username: string | null } | null
}

export async function submitCoaster(data: {
  coaster_name: string
  park_name: string
  park_id: string | null
  suggested_fields: SuggestedFields
}) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  const { data: submission, error } = await supabase
    .from('coaster_submissions')
    .insert({
      coaster_name: data.coaster_name,
      park_name: data.park_name,
      park_id: data.park_id,
      suggested_fields: data.suggested_fields,
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

export async function approveSubmission(id: string, submission: CoasterSubmission) {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()
  if (userError) throw userError
  if (!user) throw new Error('Not authenticated')

  // Logic to create/link park and manufacturer.
  // 1. Handle Park
  let parkId = submission.park_id
  if (!parkId) {
    const { data: park, error: parkError } = await supabase
      .from('parks')
      .insert({
        name: submission.park_name,
        slug: slugify(submission.park_name),
        source: 'community',
      })
      .select()
      .single()
    if (parkError) {
      // parks.slug UNIQUE — a near-identical park name already exists.
      throw parkError.code === '23505'
        ? new Error(`A park named "${submission.park_name}" already exists.`)
        : parkError
    }
    parkId = park.id
  }

  // 2. Create Coaster — globally unique slug (park suffix fallback)
  const baseSlug = slugify(submission.coaster_name)
  if (!parkId) throw new Error('Missing park')
  let coasterSlug = await resolveUniqueCoasterSlug(baseSlug, parkId, null)
  let coasterError: { code?: string; message: string } | null = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await supabase.from('coasters').insert({
      park_id: parkId,
      name: submission.coaster_name,
      slug: coasterSlug,
      source: 'community',
      ...submission.suggested_fields,
    })
    if (!error) {
      coasterError = null
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

  // 3. Update Submission Status
  const { error: statusError } = await supabase
    .from('coaster_submissions')
    .update({
      status: 'approved',
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', id)
  if (statusError) throw statusError
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
// park name, manufacturer name, and ride count.
export type AdminCoaster = Coaster & {
  parks: { name: string; slug: string } | null
  manufacturers: { name: string } | null
  ride_count: number
}

export async function getAllCoastersAdmin() {
  const { data, error } = await supabase
    .from('coasters')
    .select('*, parks(name, slug), manufacturers(name), ride_count:user_rides(count)')
    .order('name')
    .range(0, 9999)
  if (error) throw error
  return (data as Array<AdminCoaster & { ride_count: [{ count: number }] }>).map((c) => ({
    ...c,
    ride_count: c.ride_count?.[0]?.count ?? 0,
  }))
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

export async function createCoaster(data: Partial<Coaster>) {
  if (data.name && data.park_id) {
    const base = data.slug ? data.slug : slugify(data.name)
    const unique = await resolveUniqueCoasterSlug(
      base,
      data.park_id,
      (data.manufacturer_id as string | null) ?? null,
    )
    data = { ...data, slug: unique }
  }
  let lastError: { code?: string } | null = null
  let attemptSlug = data.slug as string | undefined
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data: result, error } = await supabase.from('coasters').insert(data).select().single()
    if (!error) return result
    if (error.code !== '23505' || !attemptSlug || !data.park_id) throw error
    lastError = error
    const existing = await fetchExistingCoasterSlugs(attemptSlug.replace(/-\d+$/, ''))
    let n = 2
    while (existing.has(`${attemptSlug}-${n}`)) n++
    attemptSlug = `${attemptSlug}-${n}`
    data = { ...data, slug: attemptSlug }
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
