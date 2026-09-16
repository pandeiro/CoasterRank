import { describe, expect, it } from 'vitest'
import type { RankingRow } from './board-types'
import { makePark, makeRankingRow } from '../test/fixtures'
import {
  defaultParkSelection,
  groupRowsByPark,
  matchParks,
  normalizeParkQuery,
  sortRowsForCommit,
} from './park-bulk'

describe('normalizeParkQuery', () => {
  it('folds punctuation and casing so apostrophe spellings meet', () => {
    // "Knott's" vs "Knotts" — the classic family-park spelling split.
    expect(normalizeParkQuery("Knott's Berry Farm")).toBe('knotts berry farm')
    expect(normalizeParkQuery('Six Flags Great Adventure!')).toBe('six flags great adventure')
  })

  it('collapses whitespace runs', () => {
    expect(normalizeParkQuery('  Cedar   Point ')).toBe('cedar point')
  })
})

describe('matchParks', () => {
  const cedar = makePark({
    id: 'cp',
    name: 'Cedar Point',
    city: 'Sandusky',
    country: 'United States',
  })
  const knotts = makePark({
    id: 'knotts',
    name: "Knott's Berry Farm",
    city: 'Buena Park',
    country: 'United States',
  })
  const carowinds = makePark({
    id: 'carowinds',
    name: 'Carowinds',
    city: 'Charlotte',
    country: 'United States',
  })
  const parks = [cedar, knotts, carowinds]

  const rowsByPark = new Map([
    [cedar.id, [makeRankingRow({ id: 'steve', park_id: 'cp' })]],
    [knotts.id, [makeRankingRow({ id: 'gn', park_id: 'knotts' })]],
    [carowinds.id, [makeRankingRow({ id: 'fury', park_id: 'carowinds' })]],
  ])

  it('matches by name substring, apostrophes folded', () => {
    expect(matchParks(parks, rowsByPark, 'knotts').map((m) => m.park.id)).toEqual(['knotts'])
  })

  it('matches by city as a fallback tier, after name matches', () => {
    // "park" hits Knott's and Cedar Point by name ("park" in the name); the
    // location tier never gets a chance — ordering reflects name-first.
    const matches = matchParks(parks, rowsByPark, 'charlotte')
    expect(matches.map((m) => m.park.id)).toEqual(['carowinds'])
  })

  it('needs at least two characters', () => {
    expect(matchParks(parks, rowsByPark, 'c')).toEqual([])
  })

  it('never matches catch-all parks (Other / Travelling)', () => {
    // The importer's synthetic bucket and the CSV's travelling row are not
    // real places — they must never surface in the bulk-add flow.
    const other = makePark({ id: 'other', name: 'Other (unknown location)', slug: 'other' })
    const travelling = makePark({ id: 'trav', name: 'Travelling', slug: 'travelling' })
    const real = makePark({ id: 'real', name: 'Cedar Point', city: 'Sandusky' })
    const emptyRows = new Map<string, RankingRow[]>()
    expect(matchParks([other, travelling, real], emptyRows, 'other')).toEqual([])
    expect(matchParks([other, travelling, real], emptyRows, 'travelling')).toEqual([])
    expect(matchParks([other, travelling, real], emptyRows, 'travel')).toEqual([])
    expect(matchParks([other, travelling, real], emptyRows, 'cedar').map((m) => m.park.id)).toEqual(
      ['real'],
    )
  })

  it('caps results at the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => makePark({ id: `p${i}`, name: `Park ${i}` }))
    expect(matchParks(many, new Map(), 'park', 8)).toHaveLength(8)
  })
})

describe('groupRowsByPark', () => {
  it('groups rows and preserves the board (BT-score) order within a park', () => {
    const a = makeRankingRow({ id: 'a', park_id: 'p1', rank: 2 })
    const b = makeRankingRow({ id: 'b', park_id: 'p1', rank: 1 })
    const c = makeRankingRow({ id: 'c', park_id: 'p2', rank: 3 })
    const groups = groupRowsByPark([a, b, c])
    expect(groups.get('p1')?.map((r) => r.id)).toEqual(['a', 'b'])
    expect(groups.get('p2')?.map((r) => r.id)).toEqual(['c'])
  })
})

describe('defaultParkSelection', () => {
  it('checks operating coasters not already in the list', () => {
    const rows = [
      makeRankingRow({ id: 'op', status: 'operating' }),
      makeRankingRow({ id: 'sbno', status: 'sbno' }),
      makeRankingRow({ id: 'defunct', status: 'defunct' }),
      makeRankingRow({ id: 'already', status: 'operating' }),
    ]
    const selected = defaultParkSelection(rows, new Set(['already']))
    expect(selected.has('op')).toBe(true)
    // An "I've been here" claim must not silently include rides that aren't
    // standing — non-operating rows default unchecked.
    expect(selected.has('sbno')).toBe(false)
    expect(selected.has('defunct')).toBe(false)
    expect(selected.has('already')).toBe(false)
  })
})

describe('sortRowsForCommit', () => {
  it('orders by board rank with unranked rows last and name tiebreaks', () => {
    const rows = [
      makeRankingRow({ id: 'unranked-b', rank: null, name: 'Zephyr' }),
      makeRankingRow({ id: 'second', rank: 2, name: 'B' }),
      makeRankingRow({ id: 'unranked-a', rank: null, name: 'Alpha' }),
      makeRankingRow({ id: 'first', rank: 1, name: 'A' }),
      makeRankingRow({ id: 'tie-a', rank: 3, name: 'Alpha' }),
      makeRankingRow({ id: 'tie-b', rank: 3, name: 'Beta' }),
    ]
    expect(sortRowsForCommit(rows).map((r) => r.id)).toEqual([
      'first',
      'second',
      'tie-a',
      'tie-b',
      'unranked-a',
      'unranked-b',
    ])
  })
})
