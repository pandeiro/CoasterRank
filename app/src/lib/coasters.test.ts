import { describe, it, expect } from 'vitest'
import {
  buildParkMap,
  FEW_VOTES_THRESHOLD,
  filterCoasters,
  filtersFromSearchParams,
  filtersToSearchParams,
  isFewVotes,
  capitalize,
  yearFromDate,
} from './coasters'
import { makeManufacturer, makePark, makeRankingRow } from '../test/fixtures'

describe('filtersFromSearchParams', () => {
  it('defaults to operating with no params (clean URL)', () => {
    expect(filtersFromSearchParams(new URLSearchParams(''))).toEqual({ status: 'operating' })
  })

  it('parses all filter pairs', () => {
    const params = new URLSearchParams(
      'q=cobra&park=cedar-point&country=US&manufacturer=intamin&material=steel&status=defunct',
    )
    expect(filtersFromSearchParams(params)).toEqual({
      q: 'cobra',
      park: 'cedar-point',
      country: 'US',
      manufacturer: 'intamin',
      material: 'steel',
      status: 'defunct',
    })
  })

  it('treats status=all as all statuses', () => {
    expect(filtersFromSearchParams(new URLSearchParams('status=all')).status).toBe('all')
  })

  it('ignores unknown status values', () => {
    expect(filtersFromSearchParams(new URLSearchParams('status=bogus')).status).toBe('operating')
  })
})

describe('filtersToSearchParams', () => {
  it('produces an empty querystring for the default operating view', () => {
    expect(filtersToSearchParams({ status: 'operating' }).toString()).toBe('')
  })

  it('writes only non-default pairs', () => {
    const params = filtersToSearchParams({ q: 'cobra', park: 'cedar-point', status: 'defunct' })
    expect(params.toString()).toBe('q=cobra&park=cedar-point&status=defunct')
  })

  it('writes status=all when every status is wanted', () => {
    expect(filtersToSearchParams({ status: 'all' }).toString()).toBe('status=all')
  })

  it('round-trips through filtersFromSearchParams', () => {
    const filters = { q: 'ghost', material: 'wood' as const, status: 'all' as const }
    expect(filtersFromSearchParams(filtersToSearchParams(filters))).toEqual(filters)
  })
})

describe('filterCoasters', () => {
  const parks = [
    makePark({ id: 'p1', slug: 'cedar-point', country: 'US' }),
    makePark({ id: 'p2', slug: 'alton-towers', country: 'UK' }),
  ]
  const manufacturers = [makeManufacturer({ id: 'm1', slug: 'intamin' })]
  const refs = { parks, manufacturers }

  const rows = [
    makeRankingRow({
      park_id: 'p1',
      manufacturer_id: 'm1',
      name: 'Steel Vengeance',
      status: 'operating',
      material: 'steel',
    }),
    makeRankingRow({
      park_id: 'p2',
      manufacturer_id: null,
      name: 'Wicker Man',
      status: 'operating',
      material: 'wood',
    }),
    makeRankingRow({
      park_id: 'p1',
      manufacturer_id: null,
      name: 'Mean Streak',
      status: 'defunct',
      material: 'wood',
    }),
  ]

  it('defaults to operating only', () => {
    expect(filterCoasters(rows, { status: 'operating' }, refs).map((r) => r.slug)).toEqual([
      'coaster-1',
      'coaster-2',
    ])
  })

  it('keeps every status for status=all', () => {
    expect(filterCoasters(rows, { status: 'all' }, refs)).toHaveLength(3)
  })

  it('filters by material', () => {
    expect(filterCoasters(rows, { status: 'all', material: 'wood' }, refs)).toHaveLength(2)
  })

  it('filters by country via the parks reference', () => {
    expect(
      filterCoasters(rows, { status: 'all', country: 'US' }, refs).map((r) => r.park_id),
    ).toEqual(['p1', 'p1'])
  })

  it('filters by park slug via the parks reference', () => {
    expect(
      filterCoasters(rows, { status: 'all', park: 'alton-towers' }, refs).map((r) => r.name),
    ).toEqual(['Wicker Man'])
  })

  it('filters by manufacturer slug via the manufacturers reference', () => {
    expect(
      filterCoasters(rows, { status: 'all', manufacturer: 'intamin' }, refs).map((r) => r.name),
    ).toEqual(['Steel Vengeance'])
  })

  it('matches search case-insensitively on the coaster name', () => {
    expect(filterCoasters(rows, { status: 'all', q: 'wicker' }, refs)).toHaveLength(1)
    expect(filterCoasters(rows, { status: 'all', q: 'STEEL' }, refs)).toHaveLength(1)
  })

  it('returns no rows for a park slug with no match', () => {
    expect(filterCoasters(rows, { status: 'all', park: 'nowhere' }, refs)).toHaveLength(0)
  })
})

describe('buildParkMap', () => {
  it('keys parks by id', () => {
    const map = buildParkMap([makePark({ id: 'p1', name: 'Cedar Point', slug: 'cedar-point' })])
    expect(map.get('p1')?.name).toBe('Cedar Point')
    expect(map.get('p1')?.slug).toBe('cedar-point')
  })
})

describe('isFewVotes', () => {
  it('is false for null comparisons', () => {
    expect(isFewVotes(null)).toBe(false)
  })

  it('is true below the threshold', () => {
    expect(isFewVotes(FEW_VOTES_THRESHOLD - 1)).toBe(true)
  })

  it('is false at or above the threshold', () => {
    expect(isFewVotes(FEW_VOTES_THRESHOLD)).toBe(false)
  })
})

describe('capitalize', () => {
  it('capitalizes a word', () => {
    expect(capitalize('steel')).toBe('Steel')
  })

  it('turns underscores into spaces', () => {
    expect(capitalize('under_construction')).toBe('Under construction')
  })
})

describe('yearFromDate', () => {
  it('extracts the year from an ISO date', () => {
    expect(yearFromDate('1996-05-11')).toBe(1996)
  })

  it('returns null for empty or partial dates', () => {
    expect(yearFromDate(null)).toBeNull()
    expect(yearFromDate('')).toBeNull()
  })
})
