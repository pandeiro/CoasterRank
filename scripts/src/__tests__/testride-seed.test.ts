import { describe, it, expect } from 'vitest'
import { makeRng } from '../testride/rand.js'
import {
  assignQualities,
  orderForUser,
  planRides,
  realisticRankedCount,
  weightedSample,
} from '../testride/seed.js'

interface FakeUser {
  id: string
  email: string
  username: string
  displayName: string
  ranked: number
  unranked: number
}

function fakeUsers(n: number, ranked: number, unranked = 0): FakeUser[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `user-${i}`,
    email: `mock_${i}@test.coasterrank.dev`,
    username: `mock_${i}`,
    displayName: `Mock Rider ${i}`,
    ranked,
    unranked,
  }))
}

function idByEmail(users: readonly FakeUser[]): Map<string, string> {
  return new Map(users.map((u) => [u.email, u.id]))
}

function coasterIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `coaster-${String(i).padStart(4, '0')}`)
}

describe('gaussian', () => {
  it('is deterministic per seed and approximately standard normal', () => {
    const a = makeRng(7)
    const b = makeRng(7)
    expect(Array.from({ length: 10 }, () => a.gaussian(0, 1))).toEqual(
      Array.from({ length: 10 }, () => b.gaussian(0, 1)),
    )
    const rng = makeRng(7)
    const draws = Array.from({ length: 10_000 }, () => rng.gaussian(0, 1))
    const mean = draws.reduce((s, x) => s + x, 0) / draws.length
    const variance = draws.reduce((s, x) => s + (x - mean) ** 2, 0) / draws.length
    expect(mean).toBeCloseTo(0, 1)
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1)
  })
})

describe('realisticRankedCount', () => {
  it('stays exact for fixed bounds and empty ranges', () => {
    const rng = makeRng(1)
    expect(realisticRankedCount(rng, { min: 10, max: 10 })).toBe(10)
    expect(realisticRankedCount(rng, { min: 0, max: 0 })).toBe(0)
  })

  it('clamps into the range and skews well below the midpoint', () => {
    const rng = makeRng(42)
    const draws = Array.from({ length: 500 }, () => realisticRankedCount(rng, { min: 3, max: 60 }))
    for (const d of draws) {
      expect(d).toBeGreaterThanOrEqual(3)
      expect(d).toBeLessThanOrEqual(60)
    }
    const mean = draws.reduce((s, x) => s + x, 0) / draws.length
    // Midpoint of [3,60] is 31.5; lognormal(median ~10) must skew far below it.
    expect(mean).toBeLessThan(20)
    expect(mean).toBeGreaterThan(5)
  })
})

describe('weightedSample', () => {
  it('draws n distinct ids deterministically', () => {
    const ids = coasterIds(50)
    const weights = new Map(ids.map((id, i) => [id, i + 1] as const))
    const a = weightedSample(makeRng(3), ids, weights, 10)
    const b = weightedSample(makeRng(3), ids, weights, 10)
    expect(a).toEqual(b)
    expect(a).toHaveLength(10)
    expect(new Set(a).size).toBe(10)
  })

  it('clamps n to the catalog size', () => {
    const ids = coasterIds(5)
    const weights = new Map(ids.map((id) => [id, 1] as const))
    expect(weightedSample(makeRng(3), ids, weights, 20)).toHaveLength(5)
  })
})

describe('assignQualities / orderForUser', () => {
  it('qualities are deterministic per seed (in coaster-id order)', () => {
    const ids = coasterIds(20)
    expect(assignQualities(makeRng(9), ids)).toEqual(assignQualities(makeRng(9), ids))
  })

  it('ordering favors higher quality but is not a fixed global sort', () => {
    const ids = coasterIds(20)
    const qualities = assignQualities(makeRng(9), ids)
    const topByQuality = [...qualities.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const firsts = new Map<string, number>()
    for (let u = 0; u < 40; u++) {
      const ordered = orderForUser(makeRng(1000 + u), qualities, ids)
      expect(ordered).toHaveLength(ids.length)
      firsts.set(ordered[0] as string, (firsts.get(ordered[0] as string) ?? 0) + 1)
    }
    // The global top-quality coaster wins rank 1 most often, but not always.
    const topWins = firsts.get(topByQuality as string) ?? 0
    expect(topWins).toBeGreaterThan(40 / ids.length)
    expect(firsts.size).toBeGreaterThan(1)
  })
})

describe('planRides', () => {
  it('is deterministic for the same seed (realistic mode)', () => {
    const users = fakeUsers(10, 12)
    const ids = coasterIds(100)
    const a = planRides(makeRng(42), users, idByEmail(users), ids)
    const b = planRides(makeRng(42), users, idByEmail(users), ids)
    expect(a).toEqual(b)
  })

  it('uniform mode ranks 1..M with no duplicates per user', () => {
    const users = fakeUsers(5, 12)
    const ids = coasterIds(100)
    const rows = planRides(makeRng(42), users, idByEmail(users), ids, true)
    expect(rows).toHaveLength(5 * 12)
    for (const u of users) {
      const mine = rows.filter((r) => r.userId === u.id)
      expect(mine.map((r) => r.rank).sort((x, y) => (x ?? 0) - (y ?? 0))).toEqual(
        Array.from({ length: 12 }, (_, i) => i + 1),
      )
      expect(new Set(mine.map((r) => r.coasterId)).size).toBe(12)
    }
  })

  it('realistic mode concentrates rank-1s and overall coverage vs uniform', () => {
    const users = fakeUsers(30, 15)
    const ids = coasterIds(200)
    const realistic = planRides(makeRng(42), users, idByEmail(users), ids)
    const uniform = planRides(makeRng(42), users, idByEmail(users), ids, true)

    const rankOnes = (rows: typeof realistic): Set<string> =>
      new Set(rows.filter((r) => r.rank === 1).map((r) => r.coasterId))
    const coverage = (rows: typeof realistic): Set<string> => new Set(rows.map((r) => r.coasterId))

    // 30 uniform rank-1s over 200 coasters are ~all distinct; shared popularity
    // collapses them onto a handful of famous coasters.
    expect(rankOnes(realistic).size).toBeLessThan(rankOnes(uniform).size)
    expect(rankOnes(realistic).size).toBeLessThanOrEqual(20)
    // Weighted inclusion covers fewer distinct coasters than uniform shuffles.
    expect(coverage(realistic).size).toBeLessThan(coverage(uniform).size)
  })

  it('clamps to small catalogs and appends unranked extras', () => {
    const users = fakeUsers(2, 10, 3)
    const ids = coasterIds(8)
    for (const uniform of [false, true]) {
      const rows = planRides(makeRng(5), users, idByEmail(users), ids, uniform)
      for (const u of users) {
        const mine = rows.filter((r) => r.userId === u.id)
        // 8 coasters total: 8 ranked-cap + unranked spill beyond the catalog.
        expect(mine.filter((r) => r.rank !== null)).toHaveLength(8)
        expect(mine.filter((r) => r.rank === null)).toHaveLength(0)
        expect(new Set(mine.map((r) => r.coasterId)).size).toBe(8)
      }
    }
  })
})
