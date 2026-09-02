import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth-context'

// Columns of the coasters TABLE (not the v_coaster_rankings view) — this type
// mirrors what the user_rides embed can actually return. score/comparisons
// exist only on the view; selecting them here makes PostgREST reject the
// query with 42703 (issue #91 Blocker 1).
export type UserRideCoaster = {
  id: string
  name: string
  slug: string
  status: string
  material: string
  park_id: string
  manufacturer_name: string | null
  park_country: string | null
}

export type UserRide = {
  coaster_id: string
  rank: number | null
  coaster: UserRideCoaster
}

export function renumberRanks(coasterIds: string[]): { coaster_id: string; rank: number }[] {
  return coasterIds.map((id, i) => ({ coaster_id: id, rank: i + 1 }))
}

export function insertIdAt(ids: string[], newId: string, index: number): string[] {
  const clamped = Math.max(0, Math.min(index, ids.length))
  return [...ids.slice(0, clamped), newId, ...ids.slice(clamped)]
}

export function useMyRides() {
  const { user } = useAuth()
  return useQuery({
    queryKey: ['myRides', user?.id],
    enabled: Boolean(user),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_rides')
        .select(
          'coaster_id, rank, coasters(id, name, slug, status, material, park_id, manufacturers(name), parks(country))',
        )
        .order('rank', { ascending: true, nullsFirst: false })
      if (error) throw error
      // PostgREST returns a many-to-one embed as an object; older code assumed
      // an array and crashed on `park_id` reads (issue #91 Blocker 2). Accept
      // both shapes so a payload quirk degrades gracefully instead of throwing.
      type CoasterRow = {
        id: string
        name: string
        slug: string
        status: string
        material: string
        park_id: string
        manufacturers: { name: string } | { name: string }[] | null
        parks: { country: string } | { country: string }[] | null
      }
      return (
        data as {
          coaster_id: string
          rank: number | null
          coasters: CoasterRow | CoasterRow[]
        }[]
      ).map((row) => {
        const raw = Array.isArray(row.coasters) ? row.coasters[0] : row.coasters
        const mfg = Array.isArray(raw.manufacturers) ? raw.manufacturers[0] : raw.manufacturers
        const park = Array.isArray(raw.parks) ? raw.parks[0] : raw.parks
        return {
          coaster_id: row.coaster_id,
          rank: row.rank,
          coaster: {
            id: raw.id,
            name: raw.name,
            slug: raw.slug,
            status: raw.status,
            material: raw.material,
            park_id: raw.park_id,
            manufacturer_name: mfg?.name ?? null,
            park_country: park?.country ?? null,
          },
        }
      })
    },
  })
}

export function useRemoveRide() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (coasterId: string) => {
      if (!user) throw new Error('Not authenticated')
      const { error } = await supabase
        .from('user_rides')
        .delete()
        .eq('user_id', user.id)
        .eq('coaster_id', coasterId)
      if (error) throw error
    },
    // Retry transient failures before the caller's rollback kicks in.
    retry: 2,
    retryDelay: (attempt) => 500 * 2 ** attempt,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myRides', user?.id] })
    },
  })
}

export function useSaveRanks() {
  const { user } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (ranks: { coaster_id: string; rank: number }[]) => {
      if (!user) throw new Error('Not authenticated')
      const { error } = await supabase.from('user_rides').upsert(
        ranks.map((r) => ({
          user_id: user.id,
          coaster_id: r.coaster_id,
          rank: r.rank,
          ridden: true,
        })),
        { onConflict: 'user_id,coaster_id' },
      )
      if (error) throw error
    },
    // Retry transient failures before the caller's rollback kicks in.
    retry: 2,
    retryDelay: (attempt) => 500 * 2 ** attempt,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myRides', user?.id] })
    },
  })
}
