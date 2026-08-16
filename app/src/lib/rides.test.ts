import { describe, it, expect } from 'vitest'
import { renumberRanks } from './rides'

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
