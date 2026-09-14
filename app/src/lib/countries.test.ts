import { describe, expect, it } from 'vitest'
import { buildCountryStandings, COUNTRY_TOP_N } from './countries'
import { makeRankingRow } from '../test/fixtures'

describe('buildCountryStandings', () => {
  it('sorts countries by the ghost-padded top-five average', () => {
    // Four ranked rides board-wide, so ghosts sit at rank 5.
    const rows = [
      // Germany averages (2 + 4 + 5 + 5 + 5) / 5 = 4.2 — best average wins.
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
      // United States averages (1 + 9 + 5 + 5 + 5) / 5 = 5.
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
    expect(standings[0].averageRank).toBe(4.2)
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
  })

  it('pads thin benches with ghosts at one past the last ranked ride', () => {
    // Six ranked rides board-wide, so ghosts sit at rank 7: a lone rank-1
    // ride averages (1 + 7 + 7 + 7 + 7) / 5 = 5.8 and loses to real depth
    // averaging (2 + 3 + 4 + 5 + 6) / 5 = 4.
    const rows = [
      makeRankingRow({ id: 's-1', park_country: 'Solo', rank: 1, slug: 's-1', name: 'S One' }),
      ...[2, 3, 4, 5, 6].map((rank) =>
        makeRankingRow({
          id: `d-${rank}`,
          park_country: 'Deep',
          rank,
          slug: `d-${rank}`,
          name: `D ${rank}`,
        }),
      ),
    ]
    const standings = buildCountryStandings(rows)
    expect(standings.map((s) => s.country)).toEqual(['Deep', 'Solo'])
    expect(standings[0].averageRank).toBe(4)
    expect(standings[1].averageRank).toBe(5.8)
  })

  it('breaks average ties by best single rank, then alphabetically', () => {
    // Six ranked rides board-wide, so ghosts sit at rank 7 and every
    // two-ride country averages 6.2 — the order comes from the tie-breaks.
    const rows = [
      makeRankingRow({ id: 'b-1', park_country: 'Beta', rank: 4, slug: 'b-1', name: 'B One' }),
      makeRankingRow({ id: 'b-2', park_country: 'Beta', rank: 6, slug: 'b-2', name: 'B Two' }),
      // …but Alpha owns the single best rank.
      makeRankingRow({ id: 'a-1', park_country: 'Alpha', rank: 1, slug: 'a-1', name: 'A One' }),
      makeRankingRow({ id: 'a-2', park_country: 'Alpha', rank: 9, slug: 'a-2', name: 'A Two' }),
      // Gamma ties Alpha exactly — alphabetical settles it.
      makeRankingRow({ id: 'g-1', park_country: 'Gamma', rank: 1, slug: 'g-1', name: 'G One' }),
      makeRankingRow({ id: 'g-2', park_country: 'Gamma', rank: 9, slug: 'g-2', name: 'G Two' }),
    ]
    const standings = buildCountryStandings(rows)
    expect(standings.map((s) => s.country)).toEqual(['Alpha', 'Gamma', 'Beta'])
    expect(standings[0].averageRank).toBe(6.2)
  })

  it('pads a short bench with ghosts instead of averaging what exists', () => {
    // Two ranked rides board-wide, so ghosts sit at rank 3: Spain averages
    // (6 + 8 + 3 + 3 + 3) / 5 = 4.6. The unranked third ride still counts
    // toward the totals but never touches the average.
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
    expect(standing.averageRank).toBe(4.6)
    expect(standing.topFive).toHaveLength(2)
    expect(standing.totalCoasters).toBe(3)
    expect(standing.rankedCoasters).toBe(2)
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
