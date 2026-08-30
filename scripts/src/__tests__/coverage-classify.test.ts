import { describe, expect, it } from 'vitest'
import {
  baseCoasterSlug,
  normkey,
  trigramSim,
  type CoasterRow,
  type ParkRow,
} from '../coverage/lib.js'
import { classifyCoasterDups, classifyOrphans, pickSurvivor } from '../coverage/classify.js'

describe('normkey', () => {
  it('folds case, ampersands, articles, punctuation and diacritics', () => {
    expect(normkey('The Batman: The Ride')).toBe('batman ride')
    expect(normkey('Six Flags Great America')).toBe('six flags great america')
    expect(normkey('Muñoz & Marín')).toBe('munoz and marin')
    expect(normkey('Hersheypark')).toBe('hersheypark')
  })
})

describe('trigramSim', () => {
  it('is 1 for identical strings and 0 for disjoint', () => {
    expect(trigramSim('Steel Vengeance', 'Steel Vengeance')).toBe(1)
    expect(trigramSim('Fury 325', 'Kumba')).toBeLessThan(0.2)
  })
  it('ranks close variants above unrelated names', () => {
    const close = trigramSim('Jurassic World VelociCoaster', 'VelociCoaster')
    const far = trigramSim('Jurassic World VelociCoaster', 'Twisted Colossus')
    expect(close).toBeGreaterThan(far)
  })
})

describe('baseCoasterSlug', () => {
  it('strips importer disambiguation suffixes', () => {
    expect(baseCoasterSlug('flashback-six-flags-magic-mountain-1988')).toBe(
      'flashback-six-flags-magic-mountain',
    )
    expect(baseCoasterSlug('ride-x')).toBe('ride')
    expect(baseCoasterSlug('ride-x-3')).toBe('ride')
    expect(baseCoasterSlug('gold-striker')).toBe('gold-striker')
    expect(baseCoasterSlug('el-loco-2021-2')).toBe('el-loco')
  })
})

describe('pickSurvivor', () => {
  const row = (over: Partial<CoasterRow>): CoasterRow => ({
    id: over.id ?? 'id',
    park_id: 'p1',
    name: 'X',
    slug: 'x',
    model: null,
    opening_date: null,
    status: 'unknown',
    material: 'other',
    manufacturer_id: null,
    manufacturer_name: null,
    source: 'open-csv',
    external_id: null,
    height_m: null,
    speed_kmh: null,
    length_m: null,
    inversions: null,
    ...over,
  })
  it('prefers operating, then completeness, then earliest opening', () => {
    const operating = row({ id: 'a', status: 'operating', opening_date: '2001-01-01' })
    const rich = row({ id: 'b', status: 'unknown', height_m: 30, opening_date: '1990-01-01' })
    expect(pickSurvivor([rich, operating]).id).toBe('a')
    expect(pickSurvivor([row({ id: 'c', status: 'defunct' }), rich]).id).toBe('b')
  })
})

describe('classifyOrphans', () => {
  const park = (over: Partial<ParkRow>): ParkRow => ({
    id: over.id ?? over.slug!,
    name: over.name ?? over.slug!,
    slug: over.slug!,
    country: null,
    region: null,
    city: null,
    lat: null,
    lng: null,
    source: 'open-csv',
    ...over,
  })
  const coaster = (over: Partial<CoasterRow>): CoasterRow => ({
    id: over.id ?? 'c',
    park_id: 'other',
    name: 'Ride',
    slug: 'ride',
    model: null,
    opening_date: null,
    status: 'unknown',
    material: 'other',
    manufacturer_id: null,
    manufacturer_name: null,
    source: 'open-csv',
    external_id: 'ride@other',
    height_m: null,
    speed_kmh: null,
    length_m: null,
    inversions: null,
    ...over,
  })

  it('resolves slug-embedded park names and falls back to review', () => {
    const parks = [
      park({ slug: 'other', name: 'Other (unknown location)' }),
      park({ slug: 'six-flags-magic-mountain', name: 'Six Flags Magic Mountain' }),
    ]
    const coasters = [
      coaster({
        id: 'c1',
        name: 'Flashback',
        slug: 'flashback-six-flags-magic-mountain',
        external_id: 'flashback-six-flags-magic-mountain@other',
      }),
      coaster({
        id: 'c2',
        name: 'Mystery Coaster',
        slug: 'mystery-coaster',
        external_id: 'mystery-coaster@other',
      }),
    ]
    const res = classifyOrphans(parks, coasters, [])
    expect(res.items).toHaveLength(2)
    expect(res.items[0]!.action).toBe('rehome')
    expect(res.items[0]!.confidence).toBe('high')
    expect(res.items[1]!.action).toBe('review')
    expect(res.resolvedBySlug).toBe(1)
  })

  it('does not match short or partial park slugs', () => {
    const parks = [
      park({ slug: 'other', name: 'Other (unknown location)' }),
      park({ slug: 'lago', name: 'Lagoon' }),
    ]
    const coasters = [coaster({ slug: 'lagoonator', external_id: 'lagoonator@other' })]
    const res = classifyOrphans(parks, coasters, [])
    expect(res.items[0]!.action).toBe('review')
  })

  it('resolves via CSV cross-reference when name+year+model is unique', () => {
    const parks = [
      park({ slug: 'other', name: 'Other (unknown location)' }),
      park({ slug: 'knoebels-amusement-resort', name: 'Knoebels Amusement Resort' }),
    ]
    const coasters = [
      coaster({
        id: 'c1',
        name: 'Twister',
        slug: 'twister',
        opening_date: '1999-01-01',
        external_id: 'twister@other',
      }),
    ]
    const csv = [
      {
        coaster_name: 'Twister',
        Location: 'Knoebels Amusement Resort',
        'Opening date': 'July 23, 1999',
        Model: 'Wooden',
      },
    ]
    const res = classifyOrphans(parks, coasters, csv)
    expect(res.items[0]!.action).toBe('rehome')
    expect(res.items[0]!.confidence).toBe('medium')
    expect(res.resolvedByCsv).toBe(1)
  })
})

describe('classifyCoasterDups', () => {
  const park = (over: Partial<ParkRow>): ParkRow => ({
    id: over.id ?? over.slug!,
    name: over.name ?? over.slug!,
    slug: over.slug!,
    country: null,
    region: null,
    city: null,
    lat: null,
    lng: null,
    source: 'open-csv',
    ...over,
  })
  const coaster = (over: Partial<CoasterRow>): CoasterRow => ({
    id: over.id ?? 'c',
    park_id: 'p1',
    name: 'Ride',
    slug: 'ride',
    model: null,
    opening_date: null,
    status: 'unknown',
    material: 'other',
    manufacturer_id: null,
    manufacturer_name: null,
    source: 'open-csv',
    external_id: null,
    height_m: null,
    speed_kmh: null,
    length_m: null,
    inversions: null,
    ...over,
  })

  it('flags same-CSV-identity families as merges and keeps distinct models for review', () => {
    const parks = [park({ id: 'p1', slug: 'some-park', name: 'Some Park' })]
    const coasters = [
      coaster({ id: 'a', slug: 'flashback', opening_date: '1985-01-01' }),
      coaster({ id: 'b', slug: 'flashback-1988', opening_date: '1988-01-01' }),
      coaster({ id: 'c', name: 'Twister', slug: 'twister', model: 'Wooden' }),
      coaster({
        id: 'd',
        name: 'twister!',
        slug: 'twister-1995',
        model: 'Steel',
        opening_date: '1995-01-01',
      }),
    ]
    const res = classifyCoasterDups(parks, coasters)
    expect(res.groupsExamined).toBe(2)
    expect(res.items[0]!.action).toBe('merge_coasters')
    expect((res.items[0]!.payload as { survivor_id: string }).survivor_id).toBe('a')
    expect(res.items[1]!.action).toBe('review')
  })

  it('downgrades 3+ row same-slug families to review (sister-park conflation trap)', () => {
    const parks = [park({ id: 'p1', slug: 'seaworld-orlando', name: 'SeaWorld Orlando' })]
    const coasters = [
      coaster({
        id: 'a',
        name: 'Journey to Atlantis',
        slug: 'journey-to-atlantis',
        opening_date: '1998-04-17',
      }),
      coaster({
        id: 'b',
        name: 'Journey to Atlantis',
        slug: 'journey-to-atlantis-2004',
        opening_date: '1998-04-17',
      }),
      coaster({
        id: 'c',
        name: 'Journey to Atlantis',
        slug: 'journey-to-atlantis-2007',
        opening_date: '1998-04-17',
      }),
    ]
    const res = classifyCoasterDups(parks, coasters)
    expect(res.items[0]!.action).toBe('review')
    expect(res.items[0]!.recommendation).toContain('sister-park')
  })
})
