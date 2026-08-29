import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import { USERNAME_RE } from './validation'

/**
 * Public read model for /riders/<username>, served by the
 * `public_rider_page()` RPC (migration rider_public_pages). Only exists for
 * riders who opted in via profiles.public_list; a NULL result means either
 * "unknown user" or "sharing off" — callers show the same not-found state.
 */
export type RiderProfile = {
  username: string
  display_name: string | null
  avatar_url: string | null
  member_since: string | null
}

export type RiderRide = {
  coaster_id: string
  rank: number
  name: string
  slug: string
  material: string
  status: string
  park_name: string | null
  park_slug: string | null
  score: number | null
}

export type RiderPageData = {
  profile: RiderProfile
  rides: RiderRide[]
}

export function isValidRiderUsername(username: string | undefined): boolean {
  return typeof username === 'string' && USERNAME_RE.test(username)
}

export async function fetchRiderPage(username: string): Promise<RiderPageData | null> {
  if (!isValidRiderUsername(username)) return null
  const { data, error } = await supabase.rpc('public_rider_page', { p_username: username })
  if (error) throw error
  return (data as RiderPageData | null) ?? null
}

export function useRiderPage(username: string | undefined) {
  return useQuery({
    queryKey: ['riderPage', username?.toLowerCase()],
    queryFn: () => fetchRiderPage(username!),
    enabled: isValidRiderUsername(username),
    staleTime: 60_000,
  })
}

/** The canonical public URL for a rider page (no trailing slash). */
export function riderPageUrl(username: string): string {
  return `${window.location.origin}/riders/${username}`
}
