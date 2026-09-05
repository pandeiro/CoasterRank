// Rank-movement plumbing (PLAN §11 "Rank movement indicators").
//
// Two layers share this module:
//
// 1. WEEKLY (persistent): the view exposes `rank_last_week` (the previous ISO
//    week's final rank from `rank_weekly_snapshots`); the delta is plain
//    arithmetic at render time — see `weekDelta`. Renders on every page load.
//
// 2. LIVE (ephemeral): the board refetches every 15 minutes; when the payload's
//    `last_recomputed_at` moves, that is a "turnover" — the moment a recompute
//    became visible. `useRankTurnover` diffs the previous payload's global
//    ranks against the new ones (client-side, so the delta is honest about
//    "changed since you last looked" even when several recomputes passed
//    between refetches) and hands the table a movement map. Movement is
//    suppressed on first load — it must be earned by a live turnover.
import { useEffect, useRef, useState } from 'react'
import type { RankingRow } from './board-types'

// Weekly delta: positive = climbed. NULL either side → no baseline (first
// week of the feature, coaster newly ranked, or unrated now).
export function weekDelta(row: RankingRow): number | null {
  if (row.rank === null || row.rank_last_week === null) return null
  return row.rank_last_week - row.rank
}

// How long live movement chips stay on screen before "evaporating". Tunable
// heartbeat vs clutter dial; ~10s of presence + a ~2s fade.
export const MOVEMENT_LINGER_MS = 10_000
// The CSS evaporation animation runs this long after a built-in delay, so
// unmounting the chips cleanly must wait for its tail.
export const MOVEMENT_EVAPORATION_MS = 2_000

export type RankTurnover = {
  // coaster id → position delta (positive = climbed), for rows that actually
  // moved during this turnover. Empty when there is nothing to show.
  movement: Map<string, number>
  // Identifies the turnover (the new last_recomputed_at). Consumers key their
  // animations on it so a repeated render never restarts them; null before
  // the first turnover.
  turnoverId: string | null
}

const IDLE_TURNOVER: RankTurnover = { movement: new Map(), turnoverId: null }

type TurnoverState = {
  seen: string | null
  prevRanks: Map<string, number>
  result: RankTurnover
}

// Detects board turnovers by watching `last_recomputed_at` and diffs global
// ranks across the change. Deliberately render-time (refs, not effects) so the
// commit that swaps to the new ranks ALSO carries the movement map — the FLIP
// animation needs both in the same commit (a useEffect-based version would
// measure "before" positions one render too late). Idempotent under
// StrictMode's double render: the ref is stamped per seen timestamp, so a
// repeat render with the same inputs returns the cached result.
export function useRankTurnover(
  rows: RankingRow[] | undefined,
  lastRecomputedAt: string | null,
): RankTurnover {
  const state = useRef<TurnoverState>({
    seen: null,
    prevRanks: new Map(),
    result: IDLE_TURNOVER,
  })

  if (rows && lastRecomputedAt !== state.current.seen) {
    // First observation only establishes the baseline — no movement on load.
    if (state.current.seen !== null) {
      const movement = new Map<string, number>()
      for (const row of rows) {
        if (row.rank === null) continue
        const prev = state.current.prevRanks.get(row.id)
        if (prev !== undefined && prev !== row.rank) {
          movement.set(row.id, prev - row.rank)
        }
      }
      state.current = {
        seen: lastRecomputedAt,
        prevRanks: currentRanks(rows),
        result: { movement, turnoverId: lastRecomputedAt },
      }
    } else {
      state.current = {
        seen: lastRecomputedAt,
        prevRanks: currentRanks(rows),
        result: IDLE_TURNOVER,
      }
    }
  }

  return state.current.result
}

function currentRanks(rows: RankingRow[]): Map<string, number> {
  const ranks = new Map<string, number>()
  for (const row of rows) {
    if (row.rank !== null) ranks.set(row.id, row.rank)
  }
  return ranks
}

// Clears a turnover's movement after the chips have fully evaporated, so they
// unmount instead of lingering invisible in the DOM until the next turnover.
// Returns a copy of the input that goes empty once `turnoverId` has aged out.
export function useMovementLinger(turnover: RankTurnover): Map<string, number> {
  const [expired, setExpired] = useState(false)
  useEffect(() => {
    if (!turnover.turnoverId) {
      setExpired(false)
      return
    }
    setExpired(false)
    const timer = setTimeout(() => setExpired(true), MOVEMENT_LINGER_MS + MOVEMENT_EVAPORATION_MS)
    return () => clearTimeout(timer)
  }, [turnover.turnoverId])
  return expired ? new Map() : turnover.movement
}

// prefers-reduced-motion guard for the live movement layer. Defaults to
// "motion allowed" only when matchMedia genuinely says so; any jsdom /
// unsupported environment reduces to static rendering.
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}
