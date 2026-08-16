import { describe, it, expect } from 'vitest'
import {
  FEW_VOTES_THRESHOLD,
  filtersFromSearchParams,
  filtersToSearchParams,
  isFewVotes,
  capitalize,
  yearFromDate,
} from './coasters'

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
    const params = filtersToSearchParams({
      q: 'cobra',
      park: 'cedar-point',
      status: 'defunct',
    })
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
