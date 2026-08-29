import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

// Data access strategy (see PLAN §4.4 / Phase 4) — the "why" behind how the
// board and detail pages load data:
//
// - The board batch-fetches the FULL `v_coaster_rankings` view once, then
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

export const COASTER_STATUSES = [
  'operating',
  'defunct',
  'sbno',
  'under_construction',
  'relocated',
  'unknown',
] as const

export const COASTER_MATERIALS = ['steel', 'wood', 'hybrid', 'other'] as const

export type CoasterStatus = (typeof COASTER_STATUSES)[number]
export type CoasterMaterial = (typeof COASTER_MATERIALS)[number]

// A row of v_coaster_rankings: the coaster plus BT metrics and its live rank.
// Park/manufacturer display fields and aliases are denormalized onto the row
// by the view so the board can filter and search without reference lookups.
export type RankingRow = {
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
  park_name: string | null
  park_slug: string | null
  park_country: string | null
  park_city: string | null
  manufacturer_name: string | null
  aliases: string[] | null
  score: number | null
  comparisons: number | null
  participants: number | null
  first_place_votes: number | null
  rank: number | null
}

export type Park = {
  id: string
  name: string
  slug: string
  country: string | null
  region: string | null
  city: string | null
}

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

// allStatuses: false (the default) shows operating coasters only; true shows
// every status. country/manufacturer hold display names straight off the row.
export type RankingFilters = {
  q?: string
  allStatuses: boolean
  materialView: MaterialView
  country?: string
  manufacturer?: string
}

export const DEFAULT_FILTERS: RankingFilters = { allStatuses: false, materialView: 'everything' }

export function isCoasterStatus(value: unknown): value is CoasterStatus {
  return typeof value === 'string' && (COASTER_STATUSES as readonly string[]).includes(value)
}

export function isCoasterMaterial(value: unknown): value is CoasterMaterial {
  return typeof value === 'string' && (COASTER_MATERIALS as readonly string[]).includes(value)
}

// Parse URL search params into filters. Default (no params) = operating-only,
// all materials. Legacy links with a specific status (e.g. status=defunct)
// fall back to the operating-only default; status=all includes everything.
export function filtersFromSearchParams(params: URLSearchParams): RankingFilters {
  const materialView = params.get('material')
  return {
    q: params.get('q') ?? undefined,
    allStatuses: params.get('status') === 'all',
    materialView: materialView === 'wood' || materialView === 'steel' ? materialView : 'everything',
    country: params.get('country') ?? undefined,
    manufacturer: params.get('manufacturer') ?? undefined,
  }
}

// Serialize filters to URL search params. The default view produces an empty
// querystring so the canonical board URL stays clean.
export function filtersToSearchParams(filters: RankingFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.allStatuses) params.set('status', 'all')
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
  } = await supabase.auth.getUser()
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
  } = await supabase.auth.getUser()
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
  } = await supabase.auth.getUser()
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

  // 2. Create Coaster
  const { error: coasterError } = await supabase.from('coasters').insert({
    park_id: parkId,
    name: submission.coaster_name,
    slug: slugify(submission.coaster_name),
    source: 'community',
    ...submission.suggested_fields,
  })

  if (coasterError) {
    // coasters UNIQUE(park_id, slug) — same name already in that park.
    throw coasterError.code === '23505'
      ? new Error(`A coaster named "${submission.coaster_name}" already exists in that park.`)
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
  const { error } = await supabase.from('coasters').update(updates).eq('id', id)
  if (error) throw error
}

export async function createCoaster(data: Partial<Coaster>) {
  const { data: result, error } = await supabase.from('coasters').insert(data).select().single()
  if (error) throw error
  return result
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

// Re-home helpers ----------------------------------------------------------

export async function getOtherParkId() {
  const { data, error } = await supabase
    .from('parks')
    .select('id')
    .eq('name', 'Other (unknown location)')
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

// The whole board dataset, fetched once. Ordered by BT score so filtering
// preserves the ranking. Filters and pagination happen client-side.
export function useAllCoasters() {
  return useQuery({
    queryKey: ['rankings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_coaster_rankings')
        .select('*')
        .order('score', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as RankingRow[]
    },
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
    queryKey: ['parks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parks')
        .select('id, name, slug, country, region, city')
        .order('name')
      if (error) throw error
      return data as Park[]
    },
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

// Total users with at least one ranked ride — drives the board's first-place
// visibility gate (see FIRST_PLACE_MIN_USERS). A pure aggregate over
// user_rides, exposed via the ranked_user_count() RPC.
export function useRankedUserCount() {
  return useQuery({
    queryKey: ['ranked-user-count'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ranked_user_count')
      if (error) throw error
      return Number(data ?? 0)
    },
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
