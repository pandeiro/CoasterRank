import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'

export type RankingSchedule = {
  schedule: string
  active: boolean
  cadence_ms: number | null
  next_run: string | null
  next_runs: string[]
}

export const RANKING_SCHEDULE_QUERY_KEY = ['ranking-schedule'] as const

/**
 * Fetch the next scheduled runs of ranking compute via the unauthenticated
 * public.ranking_schedule() RPC. Returns null on error.
 */
export async function fetchRankingSchedule(): Promise<RankingSchedule | null> {
  const { data, error } = await supabase.rpc('ranking_schedule')
  if (error) {
    console.warn('[ranking-schedule] ranking_schedule RPC failed:', error.message)
    return null
  }
  return data as RankingSchedule | null
}

/**
 * React Query hook for the ranking compute schedule.
 * Only triggers network fetches when enabled (e.g. while the live popunder is open).
 */
export function useRankingSchedule(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: RANKING_SCHEDULE_QUERY_KEY,
    queryFn: fetchRankingSchedule,
    enabled: options?.enabled ?? true,
    staleTime: 30_000,
  })
}

/**
 * Determines the immediate next active run from a schedule payload.
 * If the current next_run has passed but is within gracePeriodMs, it is still returned.
 * If it has exceeded gracePeriodMs and next_runs has subsequent slots, the next slot is chosen.
 */
export function getNextActiveRun(
  schedule: RankingSchedule | null | undefined,
  nowMs: number,
  gracePeriodMs: number = 30_000,
): string | null {
  if (!schedule || !schedule.active) return null

  if (schedule.next_runs && schedule.next_runs.length > 0) {
    for (const runIso of schedule.next_runs) {
      const targetMs = new Date(runIso).getTime()
      if (!Number.isNaN(targetMs) && targetMs - nowMs >= -gracePeriodMs) {
        return runIso
      }
    }
  }

  if (schedule.next_run) {
    const targetMs = new Date(schedule.next_run).getTime()
    if (!Number.isNaN(targetMs) && targetMs - nowMs >= -gracePeriodMs) {
      return schedule.next_run
    }
  }

  return null
}

export type CountdownResult = {
  label: string
  isNow: boolean
}

/**
 * Formats a tiny relative countdown to the scheduled run.
 * - Future: returns 'in 3m 42s', 'in 45s', etc.
 * - At or past target within gracePeriodMs: countdown exhausted -> 'now'.
 * - Exceeded gracePeriodMs or missing: returns null.
 */
export function formatCountdown(
  nextRunIso: string | null | undefined,
  nowMs: number,
  gracePeriodMs: number = 30_000,
): CountdownResult | null {
  if (!nextRunIso) return null
  const targetMs = new Date(nextRunIso).getTime()
  if (Number.isNaN(targetMs)) return null

  const diffMs = targetMs - nowMs

  if (diffMs <= 0) {
    if (diffMs >= -gracePeriodMs) {
      return { label: 'now', isNow: true }
    }
    return null
  }

  const totalSeconds = Math.max(0, Math.floor(diffMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes > 0) {
    return { label: `in ${minutes}m ${seconds}s`, isNow: false }
  }
  return { label: `in ${seconds}s`, isNow: false }
}

/**
 * Human-readable relative time until a target timestamp (for Admin view).
 */
export function formatTimeUntil(dateStr: string, nowMs: number = Date.now()): string {
  const diffMs = new Date(dateStr).getTime() - nowMs
  if (diffMs <= 0) return 'now'
  const seconds = Math.floor(diffMs / 1000)
  if (seconds < 60) return `in ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) {
    const remSec = seconds % 60
    return remSec > 0 ? `in ${minutes}m ${remSec}s` : `in ${minutes}m`
  }
  const hours = Math.floor(minutes / 60)
  const remMin = minutes % 60
  return remMin > 0 ? `in ${hours}h ${remMin}m` : `in ${hours}h`
}
