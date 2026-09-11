import { useQuery, type QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import { useAuth } from './auth-context'

export type ShareNudgeEligibility = {
  eligible: boolean
  ranked_count: number
}

/**
 * One-shot share-nudge gate, fetched ONLY at the My Coasters mount — never on
 * the board or coaster/park detail pages (the RPC claims on the first
 * eligible call, so a speculative call elsewhere would burn the nudge).
 *
 * The RPC decides AND claims atomically: eligible=true means this call won
 * the guarded UPDATE race and profiles.share_nudge_shown_at is now set, so
 * every later call/mount/tab returns false. Dismiss is session-local state:
 * the banner's own hide is local, and dismissShareNudge writes the verdict
 * into this cache so remounts don't resurrect it (no server "dismissed"
 * write exists).
 */
export async function fetchShareNudgeEligibility(): Promise<ShareNudgeEligibility> {
  const { data, error } = await supabase.rpc('share_nudge_eligibility')
  if (error) throw error
  // RETURNS TABLE arrives as a row array; accept a bare object defensively.
  const row = Array.isArray(data) ? data[0] : data
  return {
    eligible: Boolean(row?.eligible),
    ranked_count: Number(row?.ranked_count ?? 0),
  }
}

export function useShareNudge() {
  const { user, isConfirmed } = useAuth()
  return useQuery({
    queryKey: ['shareNudge', user?.id],
    enabled: Boolean(user) && isConfirmed,
    // Eligibility is one-shot server-side; session-long caching keeps
    // remounts from re-calling the claiming RPC for a verdict we already have.
    staleTime: Infinity,
    queryFn: fetchShareNudgeEligibility,
  })
}

/**
 * Marks the nudge handled for the rest of the session by writing
 * eligible=false into the react-query cache — staleTime Infinity then serves
 * it on every /me remount. Without this, the cached eligible=true verdict
 * resurrects the dismissed banner on SPA navigate-away-and-back (the exact
 * bug pandeiro hit: the cache is what blocks the refetch that would now
 * return false). Also called when sharing is toggled on the profile page, so
 * a user who just did the intended action isn't re-nagged on their next /me
 * visit. A real refetch — only after the ~5-min gc or a full reload — returns
 * false from the RPC anyway once shown_at is set.
 */
export function dismissShareNudge(qc: QueryClient, userId: string | undefined) {
  qc.setQueryData<ShareNudgeEligibility>(['shareNudge', userId], (prev) =>
    prev ? { ...prev, eligible: false } : prev,
  )
}
