import { describe, it, expect, vi, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import {
  MOVEMENT_EVAPORATION_MS,
  MOVEMENT_LINGER_MS,
  prefersReducedMotion,
  useMovementLinger,
  useRankTurnover,
  weekDelta,
} from './rankMovement'
import type { RankingRow } from './board-types'

function row(id: string, rank: number | null): RankingRow {
  return {
    id,
    park_id: 'park',
    name: id,
    slug: id,
    manufacturer_id: null,
    model: null,
    opening_date: null,
    status: 'operating',
    material: 'steel',
    height_m: null,
    speed_kmh: null,
    length_m: null,
    inversions: null,
    type: null,
    park_name: null,
    park_slug: null,
    park_country: null,
    park_city: null,
    manufacturer_name: null,
    aliases: [],
    score: rank === null ? null : 1,
    comparisons: 1,
    participants: 1,
    first_place_votes: 0,
    rank,
    rank_last_week: null,
  }
}

const idle = { movement: new Map<string, number>(), turnoverId: null as string | null }

describe('weekDelta', () => {
  it('is positive when the coaster climbed', () => {
    expect(weekDelta({ ...row('a', 3), rank_last_week: 5 })).toBe(2)
  })

  it('is negative when the coaster dropped', () => {
    expect(weekDelta({ ...row('a', 5), rank_last_week: 3 })).toBe(-2)
  })

  it('is zero when nothing moved', () => {
    expect(weekDelta({ ...row('a', 3), rank_last_week: 3 })).toBe(0)
  })

  it('is null without a current rank or a baseline', () => {
    expect(weekDelta({ ...row('a', null), rank_last_week: 5 })).toBeNull()
    expect(weekDelta({ ...row('a', 3), rank_last_week: null })).toBeNull()
  })
})

describe('useRankTurnover', () => {
  const rowsA = [row('a', 1), row('b', 2), row('c', 3)]

  it('treats the first observation as a baseline, not a turnover', () => {
    const { result } = renderHook(() => useRankTurnover(rowsA, 't1'))
    expect(result.current).toEqual(idle)
  })

  it('ignores refetches of the same recompute', () => {
    const { result, rerender } = renderHook(
      ({ rows, ts }: { rows: RankingRow[]; ts: string }) => useRankTurnover(rows, ts),
      { initialProps: { rows: rowsA, ts: 't1' } },
    )
    // Same recompute timestamp, payload object swapped (e.g. cache refill).
    const rowsSwapped = [rowsA[1], rowsA[0], rowsA[2]]
    rerender({ rows: rowsSwapped, ts: 't1' })
    expect(result.current).toEqual(idle)
  })

  it('emits rank diffs when the recompute timestamp moves', () => {
    const { result, rerender } = renderHook(
      ({ rows, ts }: { rows: RankingRow[]; ts: string }) => useRankTurnover(rows, ts),
      { initialProps: { rows: rowsA, ts: 't1' } },
    )
    // a climbed 2, b dropped 1, c dropped 1.
    const rowsB = [row('b', 1), row('a', 3), row('c', 4), row('d', 2)]
    rerender({ rows: rowsB, ts: 't2' })
    expect(result.current.turnoverId).toBe('t2')
    expect(result.current.movement.get('a')).toBe(-2)
    expect(result.current.movement.get('b')).toBe(1)
    expect(result.current.movement.get('c')).toBe(-1)
    // New coasters have no previous rank → no movement entry.
    expect(result.current.movement.has('d')).toBe(false)
  })

  it('keeps the last turnover visible until the next one', () => {
    const { result, rerender } = renderHook(
      ({ rows, ts }: { rows: RankingRow[]; ts: string }) => useRankTurnover(rows, ts),
      { initialProps: { rows: rowsA, ts: 't1' } },
    )
    rerender({ rows: [row('b', 1), row('a', 2), row('c', 3)], ts: 't2' })
    expect(result.current.movement.get('a')).toBe(-1)
    // A third payload with the same recompute timestamp keeps the turnover.
    rerender({ rows: [row('b', 1), row('a', 2), row('c', 3)], ts: 't2' })
    expect(result.current.movement.get('a')).toBe(-1)
  })

  it('stays idle while last_recomputed_at is unavailable', () => {
    const { result, rerender } = renderHook(
      ({ rows, ts }: { rows: RankingRow[] | undefined; ts: string | null }) =>
        useRankTurnover(rows, ts),
      { initialProps: { rows: rowsA, ts: null } },
    )
    rerender({ rows: [row('b', 1), row('a', 2), row('c', 3)], ts: null })
    expect(result.current).toEqual(idle)
  })

  it('is idempotent for identical inputs (StrictMode double render)', () => {
    const { result, rerender } = renderHook(
      ({ rows, ts }: { rows: RankingRow[]; ts: string }) => useRankTurnover(rows, ts),
      { initialProps: { rows: rowsA, ts: 't1' } },
    )
    rerender({ rows: [row('b', 1), row('a', 2), row('c', 3)], ts: 't2' })
    const first = result.current
    rerender({ rows: [row('b', 1), row('a', 2), row('c', 3)], ts: 't2' })
    expect(result.current).toBe(first)
  })
})

describe('useMovementLinger', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears the movement map once the evaporation tail completes', () => {
    vi.useFakeTimers()
    const movement = new Map([['a', 1]])
    const { result, rerender } = renderHook(
      ({ turnoverId }: { turnoverId: string | null }) =>
        useMovementLinger({ movement, turnoverId }),
      { initialProps: { turnoverId: 't1' as string | null } },
    )
    expect(result.current.get('a')).toBe(1)
    act(() => {
      vi.advanceTimersByTime(MOVEMENT_LINGER_MS + MOVEMENT_EVAPORATION_MS - 1)
    })
    expect(result.current.get('a')).toBe(1)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.size).toBe(0)
    // A new turnover resets the window.
    rerender({ turnoverId: 't2' })
    expect(result.current.get('a')).toBe(1)
  })

  it('is a no-op without a turnover', () => {
    vi.useFakeTimers()
    const { result } = renderHook(() =>
      useMovementLinger({ movement: new Map([['a', 1]]), turnoverId: null }),
    )
    act(() => {
      vi.advanceTimersByTime(MOVEMENT_LINGER_MS * 3)
    })
    expect(result.current.get('a')).toBe(1)
  })
})

describe('prefersReducedMotion', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('defaults to false when matchMedia is unavailable (jsdom)', () => {
    expect(prefersReducedMotion()).toBe(false)
  })

  it('follows the media query when available', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
      })),
    )
    expect(prefersReducedMotion()).toBe(true)
  })
})
