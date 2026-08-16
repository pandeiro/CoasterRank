import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth-context'

export type UserRideCoaster = {
  id: string
  name: string
  slug: string
  status: string
  material: string
  park_id: string
  score: number | null
  comparisons: number | null
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
          'coaster_id, rank, coasters(id, name, slug, status, material, park_id, score, comparisons)',
        )
        .order('rank', { ascending: true, nullsFirst: false })
      if (error) throw error
      return (
        data as {
          coaster_id: string
          rank: number | null
          coasters: UserRideCoaster[]
        }[]
      ).map((row) => ({
        coaster_id: row.coaster_id,
        rank: row.rank,
        coaster: row.coasters[0],
      }))
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['myRides', user?.id] })
    },
  })
}
