import type { Manufacturer, Park, RankingRow } from '../lib/coasters'

let seq = 0

export function makeRankingRow(overrides: Partial<RankingRow> = {}): RankingRow {
  seq += 1
  const id = `coaster-${seq}`
  return {
    id,
    park_id: 'park-1',
    name: `Coaster ${seq}`,
    slug: `coaster-${seq}`,
    manufacturer_id: null,
    model: null,
    opening_date: null,
    status: 'operating',
    material: 'steel',
    height_m: null,
    speed_kmh: null,
    length_m: null,
    inversions: null,
    type: null,
    score: 1.0,
    comparisons: 100,
    participants: 12,
    rank: seq,
    ...overrides,
  }
}

export function makePark(overrides: Partial<Park> = {}): Park {
  return {
    id: 'park-1',
    name: 'Test Park',
    slug: 'test-park',
    country: 'US',
    region: null,
    city: null,
    ...overrides,
  }
}

export function makeManufacturer(overrides: Partial<Manufacturer> = {}): Manufacturer {
  return {
    id: 'mfg-1',
    name: 'Test Mfg',
    slug: 'test-mfg',
    ...overrides,
  }
}
