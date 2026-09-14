import { lineageNames, type RankingRow } from './coasters'
import { asFiniteNumber } from './rankMovement'

// Per-country mashup over the board dataset (powers /countries): group the
// /api/ranking rows by park country, average each country's top-five global
// ranks, and sort ascending. Thin benches are ghost-padded (see below), so
// depth matters as much as peak. Pure client-side — no extra fetch.

// How many of a country's best-ranked rides feed its average.
export const COUNTRY_TOP_N = 5

export type CountryTopManufacturer = { name: string; count: number }

export type CountryStanding = {
  country: string
  /** Every board row homed to this country, ranked or not. */
  totalCoasters: number
  /** Rows with a finite global rank. */
  rankedCoasters: number
  /** Best-ranked rides, global-rank order, capped at COUNTRY_TOP_N. */
  topFive: RankingRow[]
  /** Mean over exactly topN slots: real top-five ranks plus ghost padding for
      thin benches (always over ≥1 real ride — countries with no ranked rides
      are excluded). */
  averageRank: number
  /** Best single global rank in the country. Tie-breaks equal averages. */
  bestRank: number
  /** Lineage-inclusive builder tally across ALL of the country's coasters
      (multi-manufacturer rides credit every builder); alphabetical on ties. */
  topManufacturer: CountryTopManufacturer | null
}

export function buildCountryStandings(
  rows: RankingRow[],
  topN: number = COUNTRY_TOP_N,
): CountryStanding[] {
  const byCountry = new Map<string, RankingRow[]>()
  for (const row of rows) {
    if (!row.park_country) continue
    const list = byCountry.get(row.park_country)
    if (list) list.push(row)
    else byCountry.set(row.park_country, [row])
  }

  // Ghost rank: one past the last ranked ride on the whole board. A country
  // with fewer than topN ranked rides pads its average with these, so a lone
  // superstar can't carry a country past deep benches.
  const ghostRank = rows.filter((row) => asFiniteNumber(row.rank) !== null).length + 1

  const standings: CountryStanding[] = []
  for (const [country, all] of byCountry) {
    const ranked = all
      .filter((row) => asFiniteNumber(row.rank) !== null)
      .sort((a, b) => (asFiniteNumber(a.rank) ?? Infinity) - (asFiniteNumber(b.rank) ?? Infinity))
    // A country with nothing on the board yet has no average to show.
    if (ranked.length === 0) continue
    const topFive = ranked.slice(0, topN)
    const ranks = topFive.map((row) => asFiniteNumber(row.rank) ?? Infinity)
    while (ranks.length < topN) ranks.push(ghostRank)
    const averageRank = ranks.reduce((sum, rank) => sum + rank, 0) / topN

    const builderCounts = new Map<string, number>()
    for (const row of all) {
      for (const name of lineageNames(row)) {
        builderCounts.set(name, (builderCounts.get(name) ?? 0) + 1)
      }
    }
    let topManufacturer: CountryTopManufacturer | null = null
    for (const [name, count] of builderCounts) {
      if (
        !topManufacturer ||
        count > topManufacturer.count ||
        (count === topManufacturer.count && name.localeCompare(topManufacturer.name) < 0)
      ) {
        topManufacturer = { name, count }
      }
    }

    standings.push({
      country,
      totalCoasters: all.length,
      rankedCoasters: ranked.length,
      topFive,
      averageRank,
      bestRank: ranks[0],
      topManufacturer,
    })
  }

  standings.sort(
    (a, b) =>
      a.averageRank - b.averageRank ||
      a.bestRank - b.bestRank ||
      a.country.localeCompare(b.country),
  )
  return standings
}
