import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  fetchRankingSchedule,
  getNextActiveRun,
  formatCountdown,
  formatTimeUntil,
  type RankingSchedule,
} from './rankingSchedule'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
}))

describe('rankingSchedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('fetchRankingSchedule', () => {
    it('returns schedule data on successful RPC call', async () => {
      const mockData: RankingSchedule = {
        schedule: '*/5 * * * *',
        active: true,
        cadence_ms: 300000,
        next_run: '2026-09-19T02:00:00Z',
        next_runs: ['2026-09-19T02:00:00Z', '2026-09-19T02:05:00Z'],
      }
      vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: mockData, error: null } as never)

      const result = await fetchRankingSchedule()
      expect(supabase.rpc).toHaveBeenCalledWith('ranking_schedule')
      expect(result).toEqual(mockData)
    })

    it('returns null on RPC error', async () => {
      vi.mocked(supabase.rpc).mockResolvedValueOnce({
        data: null,
        error: { message: 'Network error' },
      } as never)

      const result = await fetchRankingSchedule()
      expect(result).toBeNull()
    })
  })

  describe('getNextActiveRun', () => {
    const baseSchedule: RankingSchedule = {
      schedule: '*/5 * * * *',
      active: true,
      cadence_ms: 300000,
      next_run: '2026-09-19T02:00:00Z',
      next_runs: ['2026-09-19T02:00:00Z', '2026-09-19T02:05:00Z', '2026-09-19T02:10:00Z'],
    }

    it('returns null when schedule is null, undefined, or inactive', () => {
      expect(getNextActiveRun(null, Date.now())).toBeNull()
      expect(getNextActiveRun(undefined, Date.now())).toBeNull()
      expect(getNextActiveRun({ ...baseSchedule, active: false }, Date.now())).toBeNull()
    })

    it('returns the next run when it is in the future', () => {
      const nowMs = new Date('2026-09-19T01:58:00Z').getTime()
      expect(getNextActiveRun(baseSchedule, nowMs)).toBe('2026-09-19T02:00:00Z')
    })

    it('keeps returning the current run within the grace period (during compute execution)', () => {
      // 10 seconds past the scheduled target
      const nowMs = new Date('2026-09-19T02:00:10Z').getTime()
      expect(getNextActiveRun(baseSchedule, nowMs, 30_000)).toBe('2026-09-19T02:00:00Z')
    })

    it('advances to subsequent run when past the grace period', () => {
      // 35 seconds past the first run (> 30s grace period)
      const nowMs = new Date('2026-09-19T02:00:35Z').getTime()
      expect(getNextActiveRun(baseSchedule, nowMs, 30_000)).toBe('2026-09-19T02:05:00Z')
    })
  })

  describe('formatCountdown', () => {
    it('returns null for missing or invalid timestamps', () => {
      expect(formatCountdown(null, Date.now())).toBeNull()
      expect(formatCountdown(undefined, Date.now())).toBeNull()
      expect(formatCountdown('not-a-date', Date.now())).toBeNull()
    })

    it('formats remaining minutes and seconds', () => {
      const target = '2026-09-19T02:05:00Z'
      const nowMs = new Date('2026-09-19T02:01:45Z').getTime() // 3m 15s remaining
      const result = formatCountdown(target, nowMs)
      expect(result).toEqual({ label: 'in 3m 15s', isNow: false })
    })

    it('formats remaining seconds when under a minute', () => {
      const target = '2026-09-19T02:05:00Z'
      const nowMs = new Date('2026-09-19T02:04:18Z').getTime() // 42s remaining
      const result = formatCountdown(target, nowMs)
      expect(result).toEqual({ label: 'in 42s', isNow: false })
    })

    it('returns "now" when countdown is exhausted (at exact target)', () => {
      const target = '2026-09-19T02:05:00Z'
      const nowMs = new Date('2026-09-19T02:05:00Z').getTime()
      const result = formatCountdown(target, nowMs)
      expect(result).toEqual({ label: 'now', isNow: true })
    })

    it('returns "now" when within the grace period after target has arrived', () => {
      const target = '2026-09-19T02:05:00Z'
      const nowMs = new Date('2026-09-19T02:05:12Z').getTime() // 12s after
      const result = formatCountdown(target, nowMs, 30_000)
      expect(result).toEqual({ label: 'now', isNow: true })
    })

    it('returns null when past the grace period', () => {
      const target = '2026-09-19T02:05:00Z'
      const nowMs = new Date('2026-09-19T02:05:35Z').getTime() // 35s after
      const result = formatCountdown(target, nowMs, 30_000)
      expect(result).toBeNull()
    })
  })

  describe('formatTimeUntil', () => {
    it('returns "now" for past or immediate timestamps', () => {
      const now = 1_000_000
      expect(formatTimeUntil(new Date(now).toISOString(), now)).toBe('now')
      expect(formatTimeUntil(new Date(now - 5000).toISOString(), now)).toBe('now')
    })

    it('formats seconds when under a minute', () => {
      const now = 1_000_000
      expect(formatTimeUntil(new Date(now + 35_000).toISOString(), now)).toBe('in 35s')
    })

    it('formats minutes and seconds when under an hour', () => {
      const now = 1_000_000
      expect(formatTimeUntil(new Date(now + 135_000).toISOString(), now)).toBe('in 2m 15s')
      expect(formatTimeUntil(new Date(now + 120_000).toISOString(), now)).toBe('in 2m')
    })

    it('formats hours and minutes when over an hour', () => {
      const now = 1_000_000
      expect(formatTimeUntil(new Date(now + 3_720_000).toISOString(), now)).toBe('in 1h 2m')
      expect(formatTimeUntil(new Date(now + 3_600_000).toISOString(), now)).toBe('in 1h')
    })
  })
})
