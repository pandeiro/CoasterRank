import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

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
  park_name: string
  park_slug: string
  park_country: string | null
  park_city: string | null
  manufacturer_name: string | null
  manufacturer_slug: string | null
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

// Live board: infinite scroll over v_coaster_rankings, 250 rows per page.
export function useRankings(filters: RankingFilters) {
  return useInfiniteQuery({
    queryKey: ['rankings', JSON.stringify(filters)],
    queryFn: async ({ pageParam }) => {
      let query = supabase
        .from('v_coaster_rankings')
        .select('*')
        .order('score', { ascending: false, nullsFirst: false })
      if (filters.q) query = query.ilike('name', `%${filters.q.trim()}%`)
      if (filters.park) query = query.eq('park_slug', filters.park)
      if (filters.country) query = query.eq('park_country', filters.country)
      if (filters.manufacturer) query = query.eq('manufacturer_slug', filters.manufacturer)
      if (filters.material) query = query.eq('material', filters.material)
      if (filters.status !== 'all') query = query.eq('status', filters.status)
      const { data, error } = await query.range(
        pageParam * PAGE_SIZE,
        pageParam * PAGE_SIZE + PAGE_SIZE - 1,
      )
      if (error) throw error
      return data as RankingRow[]
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length < PAGE_SIZE ? undefined : allPages.length,
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

export function useParkCoasters(slug: string | undefined) {
  return useQuery({
    queryKey: ['park-coasters', slug],
    enabled: Boolean(slug),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_coaster_rankings')
        .select('*')
        .eq('park_slug', slug!)
        .order('score', { ascending: false, nullsFirst: false })
      if (error) throw error
      return data as RankingRow[]
    },
  })
}

export function useParks() {
  return useQuery({
    queryKey: ['parks'],
    queryFn: async () => {
      const { data, error } = await supabase.from('parks').select('id, name, slug').order('name')
      if (error) throw error
      return data as { id: string; name: string; slug: string }[]
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
      return data as { id: string; name: string; slug: string }[]
    },
  })
}
