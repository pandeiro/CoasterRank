import { useQuery } from '@tanstack/react-query'
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
 * every later call/mount/tab returns false. Dismiss is session-local UI
 * state; no "dismissed" write exists.
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
