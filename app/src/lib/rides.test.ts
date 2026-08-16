import { describe, it, expect } from 'vitest'
import { insertIdAt, renumberRanks } from './rides'

describe('renumberRanks', () => {
  it('assigns gapless 1-indexed ranks', () => {
    expect(renumberRanks(['a', 'b', 'c'])).toEqual([
      { coaster_id: 'a', rank: 1 },
      { coaster_id: 'b', rank: 2 },
      { coaster_id: 'c', rank: 3 },
    ])
  })

  it('returns an empty array for empty input', () => {
    expect(renumberRanks([])).toEqual([])
  })

  it('handles a single item', () => {
    expect(renumberRanks(['x'])).toEqual([{ coaster_id: 'x', rank: 1 }])
  })
})

describe('insertIdAt', () => {
  it('inserts at the top', () => {
    expect(insertIdAt(['a', 'b'], 'x', 0)).toEqual(['x', 'a', 'b'])
  })

  it('inserts at the bottom', () => {
    expect(insertIdAt(['a', 'b'], 'x', 2)).toEqual(['a', 'b', 'x'])
  })

  it('inserts at a middle index', () => {
    expect(insertIdAt(['a', 'b', 'c'], 'x', 2)).toEqual(['a', 'b', 'x', 'c'])
  })

  it('clamps out-of-range indexes', () => {
    expect(insertIdAt(['a'], 'x', 9)).toEqual(['a', 'x'])
    expect(insertIdAt(['a'], 'x', -3)).toEqual(['x', 'a'])
  })

  it('handles an empty list', () => {
    expect(insertIdAt([], 'x', 0)).toEqual(['x'])
  })

  it('does not mutate the input array', () => {
    const ids = ['a', 'b']
    insertIdAt(ids, 'x', 1)
    expect(ids).toEqual(['a', 'b'])
  })
})
