import { describe, expect, it } from 'vitest'
import { computeRankings, type Pair } from './mm'

function pair(winner: string, loser: string, weight = 1): Pair {
  return { winner, loser, weight, wins: 1 }
}

function scoresOf(result: { rows: { coasterId: string; score: number }[] }) {
  return new Map(result.rows.map((r) => [r.coasterId, r.score]))
}

describe('computeRankings', () => {
  it('returns empty output for empty input without iterating', () => {
    const result = computeRankings([])
    expect(result.rows).toEqual([])
    expect(result.iterations).toBe(0)
    expect(result.converged).toBe(true)
  })

  it('scores a consistent winner above a consistent loser', () => {
    const result = computeRankings([pair('a', 'b'), pair('a', 'b')])
    const scores = scoresOf(result)
    expect(scores.get('a')!).toBeGreaterThan(scores.get('b')!)
    expect(result.rows[0]!.coasterId).toBe('a')
  })

  it('produces (near-)equal strengths for a perfectly symmetric cycle', () => {
    const result = computeRankings([pair('a', 'b'), pair('b', 'c'), pair('c', 'a')])
    const scores = scoresOf(result)
    const values = [...scores.values()]
    const spread = Math.max(...values) - Math.min(...values)
    expect(spread).toBeLessThan(1e-6)
  })

  it('aggregates both directions between the same pair', () => {
    // a beats b with weight 3, b beats a with weight 1 -> a should win out,
    // but by less than a sweep of the same magnitude would.
    const contested = computeRankings([pair('a', 'b', 3), pair('b', 'a', 1)])
    const sweep = computeRankings([pair('a', 'b', 3)])
    const contestedGap =
      scoresOf(contested).get('a')! - scoresOf(contested).get('b')!
    const sweepGap = scoresOf(sweep).get('a')! - scoresOf(sweep).get('b')!
    expect(contestedGap).toBeGreaterThan(0)
    expect(contestedGap).toBeLessThan(sweepGap)
  })

  it('keeps an undefeated coaster finite (anchor regularization)', () => {
    const pairs: Pair[] = []
    for (let i = 0; i < 100; i++) {
      pairs.push({ winner: 'a', loser: `l${i}`, weight: 1, wins: 1 })
    }
    const result = computeRankings(pairs)
    const score = scoresOf(result).get('a')!
    expect(Number.isFinite(score)).toBe(true)
    expect(score).toBeLessThan(100)
  })

  it('scores a winless coaster below the average anchor but above zero', () => {
    const result = computeRankings([pair('a', 'b', 10)])
    const loserScore = scoresOf(result).get('b')!
    expect(loserScore).toBeGreaterThan(0)
    expect(loserScore).toBeLessThan(1)
  })

  it('spreads scores wider as comparison weight grows against the anchor', () => {
    const light = computeRankings([pair('a', 'b', 0.1)])
    const heavy = computeRankings([pair('a', 'b', 100)])
    const gap = (r: ReturnType<typeof computeRankings>) =>
      scoresOf(r).get('a')! - scoresOf(r).get('b')!
    expect(gap(heavy)).toBeGreaterThan(gap(light))
  })

  it('reports raw win/comparison diagnostics summed across both directions', () => {
    const result = computeRankings([
      { winner: 'a', loser: 'b', weight: 0.5, wins: 3 },
      { winner: 'b', loser: 'c', weight: 0.25, wins: 2 },
    ])
    const byId = new Map(result.rows.map((r) => [r.coasterId, r]))
    expect(byId.get('a')).toMatchObject({ wins: 3, comparisons: 3 })
    expect(byId.get('b')).toMatchObject({ wins: 2, comparisons: 5 })
    expect(byId.get('c')).toMatchObject({ wins: 0, comparisons: 2 })
  })

  it('converges on small well-behaved inputs', () => {
    const result = computeRankings([
      pair('a', 'b'),
      pair('b', 'c'),
      pair('a', 'c'),
      pair('d', 'a'),
      pair('d', 'c', 2),
    ])
    expect(result.converged).toBe(true)
    expect(result.iterations).toBeLessThan(result.rows.length * 50)
  })

  it('orders a transitive dominance chain monotonically', () => {
    const result = computeRankings([
      pair('a', 'b', 5),
      pair('b', 'c', 5),
      pair('a', 'c', 5),
    ])
    expect(result.rows.map((r) => r.coasterId)).toEqual(['a', 'b', 'c'])
  })

  it('is deterministic for the same input', () => {
    const pairs = [pair('x', 'y', 3), pair('y', 'z'), pair('z', 'x', 0.5)]
    expect(computeRankings(pairs)).toEqual(computeRankings(pairs))
  })

  it('ignores non-positive-weight pairs', () => {
    const result = computeRankings([pair('a', 'b', 0), { ...pair('c', 'd', -1) }])
    expect(result.rows).toEqual([])
  })
})
