import { describe, expect, it } from 'vitest'
import { buildCountryStandings, COUNTRY_TOP_N } from './countries'
import { makeRankingRow } from '../test/fixtures'

describe('buildCountryStandings', () => {
  it('sorts countries by the average of their top-five global ranks', () => {
    const rows = [
      // Germany averages (2 + 4) / 2 = 3 — best average wins.
      makeRankingRow({
        id: 'de-1',
        name: 'De One',
        slug: 'de-one',
        park_country: 'Germany',
        rank: 2,
      }),
      makeRankingRow({
        id: 'de-2',
        name: 'De Two',
        slug: 'de-two',
        park_country: 'Germany',
        rank: 4,
      }),
      // United States averages (1 + 9) / 2 = 5.
      makeRankingRow({
        id: 'us-1',
        name: 'Us One',
        slug: 'us-one',
        park_country: 'United States',
        rank: 1,
      }),
      makeRankingRow({
        id: 'us-2',
        name: 'Us Two',
        slug: 'us-two',
        park_country: 'United States',
        rank: 9,
      }),
    ]
    const standings = buildCountryStandings(rows)
    expect(standings.map((s) => s.country)).toEqual(['Germany', 'United States'])
    expect(standings[0].averageRank).toBe(3)
    expect(standings[1].averageRank).toBe(5)
    expect(standings[0].bestRank).toBe(2)
  })

  it('only feeds the best five rides into the average', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      makeRankingRow({
        id: `us-${i}`,
        name: `Ride ${i}`,
        slug: `ride-${i}`,
        park_country: 'United States',
        rank: i + 1,
      }),
    )
    const [standing] = buildCountryStandings(rows)
    expect(standing.topFive.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5])
    expect(standing.averageRank).toBe(3)
    expect(standing.totalCoasters).toBe(7)
    expect(standing.rankedCoasters).toBe(7)
    expect(standing.shortBench).toBe(false)
  })

  it('breaks average ties by best single rank, then alphabetically', () => {
    const rows = [
      // Both average 5…
      makeRankingRow({ id: 'b-1', park_country: 'Beta', rank: 4, slug: 'b-1', name: 'B One' }),
      makeRankingRow({ id: 'b-2', park_country: 'Beta', rank: 6, slug: 'b-2', name: 'B Two' }),
      // …but Alpha owns the single best rank.
      makeRankingRow({ id: 'a-1', park_country: 'Alpha', rank: 1, slug: 'a-1', name: 'A One' }),
      makeRankingRow({ id: 'a-2', park_country: 'Alpha', rank: 9, slug: 'a-2', name: 'A Two' }),
      // Gamma ties Alpha exactly (1 + 9) / 2 — alphabetical settles it.
      makeRankingRow({ id: 'g-1', park_country: 'Gamma', rank: 1, slug: 'g-1', name: 'G One' }),
      makeRankingRow({ id: 'g-2', park_country: 'Gamma', rank: 9, slug: 'g-2', name: 'G Two' }),
    ]
    expect(buildCountryStandings(rows).map((s) => s.country)).toEqual(['Alpha', 'Gamma', 'Beta'])
  })

  it('flags countries with fewer than five ranked rides and averages what exists', () => {
    const rows = [
      makeRankingRow({ id: 's-1', park_country: 'Spain', rank: 6, slug: 's-1', name: 'S One' }),
      makeRankingRow({ id: 's-2', park_country: 'Spain', rank: 8, slug: 's-2', name: 'S Two' }),
      makeRankingRow({
        id: 's-3',
        park_country: 'Spain',
        rank: null,
        score: null,
        slug: 's-3',
        name: 'S Three',
      }),
    ]
    const [standing] = buildCountryStandings(rows)
    expect(standing.averageRank).toBe(7)
    expect(standing.topFive).toHaveLength(2)
    expect(standing.totalCoasters).toBe(3)
    expect(standing.rankedCoasters).toBe(2)
    expect(standing.shortBench).toBe(true)
  })

  it('drops countries with no ranked rides and rows with no country', () => {
    const rows = [
      makeRankingRow({
        id: 'u-1',
        park_country: 'Nowhere',
        rank: null,
        score: null,
        slug: 'u-1',
        name: 'U One',
      }),
      makeRankingRow({ id: 'n-1', park_country: null, rank: 1, slug: 'n-1', name: 'N One' }),
      makeRankingRow({ id: 'ok-1', park_country: 'France', rank: 3, slug: 'ok-1', name: 'F One' }),
    ]
    const standings = buildCountryStandings(rows)
    expect(standings.map((s) => s.country)).toEqual(['France'])
  })

  it('credits every lineage builder and breaks builder ties alphabetically', () => {
    const rows = [
      makeRankingRow({
        id: 'm-1',
        park_country: 'Italy',
        rank: 1,
        slug: 'm-1',
        name: 'M One',
        manufacturer_names: ['Zamperla', 'Intamin'],
        manufacturer_ids: ['z-id', 'i-id'],
      }),
      makeRankingRow({
        id: 'm-2',
        park_country: 'Italy',
        rank: 2,
        slug: 'm-2',
        name: 'M Two',
        manufacturer_names: ['Intamin'],
        manufacturer_ids: ['i-id'],
      }),
    ]
    const [standing] = buildCountryStandings(rows)
    // Intamin rides twice (once shared), Zamperla once.
    expect(standing.topManufacturer).toEqual({ name: 'Intamin', count: 2 })
  })

  it('returns a null builder when no coaster names one', () => {
    const rows = [
      makeRankingRow({ id: 'p-1', park_country: 'Poland', rank: 1, slug: 'p-1', name: 'P One' }),
    ]
    expect(buildCountryStandings(rows)[0].topManufacturer).toBeNull()
  })

  it('exposes the top-N constant at five', () => {
    expect(COUNTRY_TOP_N).toBe(5)
  })
})
