import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

// Data access strategy (see PLAN §4.4 / Phase 4): the board batch-fetches the
// full `v_coaster_rankings` view once and filters/paginates in the browser.
// Reference data (parks, manufacturers, countries) is small and fetched in
// parallel on load, cached by TanStack Query, and joined client-side — the view
// stays normalized (no park/manufacturer names repeated per row). This keeps
// filter changes instant (pure JS) and avoids refetching on every filter.

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
