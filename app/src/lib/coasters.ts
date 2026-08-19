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
// - Reference tables (parks, manufacturers, countries) are small and fetched
//   in PARALLEL with the coasters on load, then cached by TanStack Query and
//   joined client-side (buildParkMap, filterCoasters). The DB view stays
//   NORMALIZED — park/manufacturer names are not repeated on every coaster
//   row — which keeps the batch payload lean and gives us a single source of
//   truth for display names. Detail pages reuse the same cached reference
//   data (their own query hooks fire independently if deep-linked).
//
// - Incremental rendering (250-row slices via an IntersectionObserver
//   sentinel) keeps the initial DOM small even though all rows are already
//   in memory.

export const PAGE_SIZE = 250
export const FEW_VOTES_THRESHOLD = 10

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
// Park/manufacturer details live in their own tables and are joined client-side.
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
  score: number | null
  comparisons: number | null
  participants: number | null
  rank: number
}

export type Park = {
  id: string
  name: string
  slug: string
  country: string | null
  region: string | null
  city: string | null
}

export type Manufacturer = {
  id: string
  name: string
  slug: string
}

// status: the default (no querystring) is operating-only; 'all' shows every
// status. Every other filter is optional and matches exactly one value.
export type RankingFilters = {
  q?: string
  park?: string
  country?: string
  manufacturer?: string
  material?: CoasterMaterial
  status: CoasterStatus | 'all'
}

export const DEFAULT_FILTERS: RankingFilters = { status: 'operating' }

function isCoasterStatus(value: string | null): value is CoasterStatus {
  return value !== null && (COASTER_STATUSES as readonly string[]).includes(value)
}

// Parse URL search params into filters. Default (no status param) = operating.
export function filtersFromSearchParams(params: URLSearchParams): RankingFilters {
  const status = params.get('status')
  return {
    q: params.get('q') ?? undefined,
    park: params.get('park') ?? undefined,
    country: params.get('country') ?? undefined,
    manufacturer: params.get('manufacturer') ?? undefined,
    material: (params.get('material') as CoasterMaterial) ?? undefined,
    status: status === 'all' ? 'all' : isCoasterStatus(status) ? status : 'operating',
  }
}

// Serialize filters to URL search params. The default (operating) produces an
// empty querystring so the canonical board URL stays clean.
export function filtersToSearchParams(filters: RankingFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.park) params.set('park', filters.park)
  if (filters.country) params.set('country', filters.country)
  if (filters.manufacturer) params.set('manufacturer', filters.manufacturer)
  if (filters.material) params.set('material', filters.material)
  if (filters.status !== 'operating') params.set('status', filters.status)
  return params
}

// Pure client-side filtering over the batch-fetched dataset. `refs` supplies the
// reference data needed to resolve park/country/manufacturer filters (which are
// expressed as slugs) down to coaster foreign keys.
export function filterCoasters(
  rows: RankingRow[],
  filters: RankingFilters,
  refs: { parks: Park[]; manufacturers: Manufacturer[] },
): RankingRow[] {
  const parkIdsByCountry = filters.country
    ? new Set(refs.parks.filter((p) => p.country === filters.country).map((p) => p.id))
    : null
  const parkId = filters.park ? refs.parks.find((p) => p.slug === filters.park)?.id : undefined
  const manufacturerId = filters.manufacturer
    ? refs.manufacturers.find((m) => m.slug === filters.manufacturer)?.id
    : undefined

  return rows.filter((row) => {
    if (filters.status !== 'all' && row.status !== filters.status) return false
    if (filters.material && row.material !== filters.material) return false
    if (filters.country && (!parkIdsByCountry || !parkIdsByCountry.has(row.park_id))) return false
    if (filters.park && row.park_id !== parkId) return false
    if (filters.manufacturer && row.manufacturer_id !== manufacturerId) return false
    if (filters.q) {
      const term = filters.q.toLowerCase()
      if (!row.name.toLowerCase().includes(term)) return false
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

// ... existing types ...
export type CoasterSubmission = {
  id: string
  coaster_name: string
  park_name: string
  park_id: string | null
  suggested_fields: any
  submitted_by: string
  status: 'pending' | 'approved' | 'rejected'
  reviewer_note: string | null
  reviewed_by: string | null
  created_at: string
  reviewed_at: string | null
}

export async function submitCoaster(data: {
  coaster_name: string
  park_name: string
  park_id: string | null
  suggested_fields: any
}) {
  const { data: { user } } = await supabase.auth.getUser()
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
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data as CoasterSubmission[]
}

export async function rejectSubmission(id: string, note: string) {
  const { data: { user } } = await supabase.auth.getUser()
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Logic to create/link park and manufacturer.
  // 1. Handle Park
  let parkId = submission.park_id
  if (!parkId) {
    const { data: park, error: parkError } = await supabase
      .from('parks')
      .insert({ 
        name: submission.park_name, 
        slug: submission.park_name.toLowerCase().replace(/\s+/g, '-'), 
        source: 'community' 
      })
      .select()
      .single()
    if (parkError) throw parkError
    parkId = park.id
  }

  // 2. Create Coaster
  const { error: coasterError } = await supabase
    .from('coasters')
    .insert({
      park_id: parkId,
      name: submission.coaster_name,
      slug: submission.coaster_name.toLowerCase().replace(/\s+/g, '-'),
      source: 'community',
      ...submission.suggested_fields,
    })

  if (coasterError) throw coasterError

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

// ... existing types ...
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

export async function getAllCoastersAdmin() {
  const { data, error } = await supabase
    .from('coasters')
    .select('*, parks(name)')
    .order('name')
  if (error) throw error
  return data as any[]
}

export async function updateCoaster(id: string, updates: Partial<Coaster>) {
  const { error } = await supabase
    .from('coasters')
    .update(updates)
    .eq('id', id)
  if (error) throw error
}

export async function createCoaster(data: Partial<Coaster>) {
  const { data: result, error } = await supabase
    .from('coasters')
    .insert(data)
    .select()
    .single()
  if (error) throw error
  return result
}

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
// ... rest of file ...
// ... rest of file ...
// ... rest of file ...
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

export function useCountries() {
  return useQuery({
    queryKey: ['countries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('parks')
        .select('country')
        .not('country', 'is', null)
      if (error) throw error
      const countries = [...new Set((data as { country: string }[]).map((r) => r.country))]
      return countries.sort()
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
