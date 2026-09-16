import type { Park, RankingRow } from './board-types'

// Park bulk-add helpers (GUEST_UX.md §3.2 park picker): pure functions over
// the board payload — parks + ranking rows are already client-side, so the
// picker needs no new backend surface.

/**
 * Park-name normalization for search: lowercase, apostrophes dropped (so
 * "Knott's" and "Knotts" meet), other punctuation folded to spaces,
 * whitespace collapsed.
 */
export function normalizeParkQuery(q: string): string {
  return q
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ranking rows grouped by park_id, preserving the board's BT-score order. */
export function groupRowsByPark(rows: RankingRow[]): Map<string, RankingRow[]> {
  const map = new Map<string, RankingRow[]>()
  for (const row of rows) {
    const list = map.get(row.park_id)
    if (list) list.push(row)
    else map.set(row.park_id, [row])
  }
  return map
}

export type ParkMatch = { park: Park; rows: RankingRow[] }

/**
 * Catch-all parks that are not real places: the importer's synthetic
 * "Other (unknown location)" bucket and the CSV's "Travelling" row. They
 * never belong in the bulk-add flow — excluded from picker results only
 * (the board and detail pages still show their coasters).
 */
const CATCH_ALL_PARK_SLUGS = new Set(['other', 'travelling'])

/**
 * Substring search over park names, falling back to location (city/region/
 * country). Name matches lead; both tiers keep the payload's order so the
 * list stays stable between keystrokes. Catch-all parks never match.
 */
export function matchParks(
  parks: Park[],
  rowsByPark: Map<string, RankingRow[]>,
  query: string,
  limit = 8,
): ParkMatch[] {
  const q = normalizeParkQuery(query)
  if (q.length < 2) return []
  const byName: ParkMatch[] = []
  const byLocation: ParkMatch[] = []
  for (const park of parks) {
    if (CATCH_ALL_PARK_SLUGS.has(park.slug)) continue
    if (normalizeParkQuery(park.name).includes(q)) {
      byName.push({ park, rows: rowsByPark.get(park.id) ?? [] })
      continue
    }
    const location = normalizeParkQuery(
      [park.city, park.region, park.country].filter(Boolean).join(' '),
    )
    if (location.includes(q)) byLocation.push({ park, rows: rowsByPark.get(park.id) ?? [] })
  }
  return [...byName, ...byLocation].slice(0, limit)
}

/**
 * Default checklist state when a park first expands: operating coasters not
 * already in the user's list. Non-operating rows (SBNO, defunct, relocated)
 * stay unchecked — "I've been here" shouldn't silently claim rides that
 * aren't standing, but they remain one click away.
 */
export function defaultParkSelection(rows: RankingRow[], existingIds: Set<string>): Set<string> {
  const selected = new Set<string>()
  for (const row of rows) {
    if (row.status === 'operating' && !existingIds.has(row.id)) selected.add(row.id)
  }
  return selected
}

/** Commit order: board rank (nulls last), name as tiebreak. */
export function sortRowsForCommit(rows: RankingRow[]): RankingRow[] {
  return [...rows].sort((a, b) => {
    const ra = a.rank ?? Number.POSITIVE_INFINITY
    const rb = b.rank ?? Number.POSITIVE_INFINITY
    if (ra !== rb) return ra - rb
    return a.name.localeCompare(b.name)
  })
}
