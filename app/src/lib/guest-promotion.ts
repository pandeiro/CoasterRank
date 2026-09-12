import type { User } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { readGuestRanking, type GuestRankingState } from './guest-rides'

// GUEST_UX.md Part II §4: the auth bridge. The client owns materialization —
// the first SIGNED_IN / login after email confirmation consumes
// pending_guest_rides out of auth metadata. No server-side trigger
// (supabase_auth_admin has no JWT, so auth.uid() RPCs are unusable there).

export const PENDING_GUEST_RIDES_KEY = 'pending_guest_rides'

/**
 * The RPC raises the coverage-guard failure with this dedicated SQLSTATE so
 * the client can distinguish "stale payload" (wipe + continue) from generic
 * failures (keep the payload for a later retry).
 */
export const GUEST_STALE_ERRCODE = 'PGRD1'

/**
 * Ladder ceiling, aligned with apply_imported_rides (5000): the payload is
 * the COMPLETE merged ladder, and a returning spreadsheet importer can
 * legitimately rank thousands — the guest cap (150) only bounds the guest
 * portion, never the whole payload.
 */
export const GUEST_PAYLOAD_CEILING = 5000

export type GuestPromotionKind = 'materialize' | 'merge_append' | 'fast_add'

export interface PendingGuestPayload {
  ids: string[]
  /** ISO 8601 — a raw epoch integer would make PostgREST reject the RPC. */
  started_at: string | null
}

export function buildPendingGuestPayload(state: GuestRankingState): PendingGuestPayload {
  return {
    ids: state.orderedIds,
    started_at: new Date(state.createdAt).toISOString(),
  }
}

/** The exact options.data shape /signup packs onto the signUp call. */
export function buildSignupMetadata(state: GuestRankingState): {
  pending_guest_rides: PendingGuestPayload
} {
  return { pending_guest_rides: buildPendingGuestPayload(state) }
}

function parsePendingPayload(value: unknown): PendingGuestPayload | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (!Array.isArray(record.ids)) return null
  const ids = record.ids.filter((id): id is string => typeof id === 'string')
  return {
    ids,
    started_at: typeof record.started_at === 'string' ? record.started_at : null,
  }
}

export function readPendingGuestPayload(user: User | null): PendingGuestPayload | null {
  const raw = user?.user_metadata?.[PENDING_GUEST_RIDES_KEY]
  const payload = parsePendingPayload(raw)
  if (!payload || payload.ids.length === 0) return null
  return payload
}

export function isGuestStaleError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  return (error as { code?: unknown }).code === GUEST_STALE_ERRCODE
}

/** Calls the Phase 4 RPC with the complete ordered ladder (§4.3). */
export async function materializeGuestRides(
  ids: string[],
  kind: GuestPromotionKind,
  startedAtIso: string | null,
): Promise<number> {
  if (ids.length > GUEST_PAYLOAD_CEILING) {
    throw new Error(`Guest payload too large: ${ids.length} ids`)
  }
  const { data, error } = await supabase.rpc('materialize_guest_rides', {
    p_rides: ids,
    p_kind: kind,
    p_started_at: startedAtIso,
  })
  if (error) throw error
  return typeof data === 'number' ? data : 0
}

export async function logGuestMergeDecision(): Promise<void> {
  const { error } = await supabase.rpc('log_guest_merge_decision', { p_kind: 'merge_discard' })
  if (error) throw error
}

/** One-time execution marker: wipes the payload from auth metadata. */
export async function wipePendingGuestPayload(): Promise<void> {
  const { error } = await supabase.auth.updateUser({
    data: { [PENDING_GUEST_RIDES_KEY]: null },
  })
  if (error) throw error
}

/**
 * The user's complete ranked ladder, oldest rank first — the merge paths
 * need it to build `remoteIds ++ guestOnlyIds` (the RPC's coverage guard
 * refuses partial payloads). Paginated per the repo's 1000-row convention.
 */
export async function fetchMyRankedRideIds(): Promise<string[]> {
  const ids: string[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('user_rides')
      .select('coaster_id, rank')
      .not('rank', 'is', null)
      .order('rank', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data ?? []) ids.push(row.coaster_id)
    if (!data || data.length < PAGE) break
  }
  return ids
}

// ── Triage (§4.4 + §3.3 seed mode): pure decision shared by the login page
// and the /me reconciliation safety net.

export type GuestTriage =
  | { action: 'noop' }
  | { action: 'silent_clear' }
  | { action: 'materialize' }
  | { action: 'conflict'; guestOnlyIds: string[]; guestState: GuestRankingState }

export function triageGuestState(remoteIds: string[]): GuestTriage {
  const guestState = readGuestRanking()
  if (!guestState || guestState.orderedIds.length === 0) return { action: 'noop' }
  const remote = new Set(remoteIds)
  const guestOnlyIds = guestState.orderedIds.filter((id) => !remote.has(id))
  if (guestOnlyIds.length === 0) return { action: 'silent_clear' }
  if (remoteIds.length === 0) return { action: 'materialize' }
  return { action: 'conflict', guestOnlyIds, guestState }
}
