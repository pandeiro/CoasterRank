import type { Manufacturer, Park, RankingRow } from '../lib/coasters'
import type { UserRide, UserRideCoaster } from '../lib/rides'

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
    park_name: 'Test Park',
    park_slug: 'test-park',
    park_country: 'United States',
    park_city: 'Test City',
    manufacturer_name: null,
    aliases: [],
    score: 1.0,
    comparisons: 100,
    participants: 12,
    first_place_votes: 0,
    rank: seq,
    rank_last_week: null,
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

export function makeUserRideCoaster(overrides: Partial<UserRideCoaster> = {}): UserRideCoaster {
  seq += 1
  return {
    id: `coaster-${seq}`,
    name: `Coaster ${seq}`,
    slug: `coaster-${seq}`,
    status: 'operating',
    material: 'steel',
    park_id: 'park-1',
    manufacturer_name: 'B&M',
    park_country: 'United States',
    ...overrides,
  }
}

export function makeUserRide(overrides: Partial<UserRide> = {}): UserRide {
  const coaster = overrides.coaster ?? makeUserRideCoaster()
  return {
    coaster_id: coaster.id,
    rank: 1,
    coaster,
    ...overrides,
  }
}
