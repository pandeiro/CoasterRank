import { describe, expect, it } from 'vitest'
import type { CoasterRow, ParkRow } from '../coverage/lib.js'
import { buildPlan, type DecisionsFile } from '../coverage/apply.js'

const park = (over: Partial<ParkRow> & { slug: string }): ParkRow => ({
  ...{
    id: `park-${over.slug}`,
    name: over.slug,
    slug: over.slug,
    country: null,
    region: null,
    city: null,
    lat: null,
    lng: null,
    source: 'open-csv',
  },
  ...over,
})

const coaster = (over: Partial<CoasterRow> & { id: string }): CoasterRow => ({
  ...{
    park_id: 'park-other',
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
  },
  ...over,
})

const snap = () => ({
  parks: [
    park({ slug: 'other', name: 'Other (unknown location)', id: 'park-other' }),
    park({ slug: 'six-flags-great-america', name: 'Six Flags Great America' }),
    park({ slug: 'seaworld-orlando', name: 'SeaWorld Orlando' }),
    park({ slug: 'seaworld-san-diego', name: 'SeaWorld San Diego' }),
  ],
  coasters: [
    coaster({
      id: 'batman-orphan',
      name: 'Batman: The Ride',
      slug: 'batman-the-ride',
      park_id: 'park-other',
      opening_date: '1992-01-01',
    }),
    coaster({
      id: 'batman-sfgam',
      name: 'Batman: The Ride',
      slug: 'batman-the-ride',
      park_id: 'park-six-flags-great-america',
      opening_date: '1993-01-01',
    }),
    coaster({
      id: 'jta-1998',
      name: 'Journey to Atlantis',
      slug: 'journey-to-atlantis',
      park_id: 'park-seaworld-orlando',
      opening_date: '1998-04-17',
    }),
    coaster({
      id: 'jta-2004',
      name: 'Journey to Atlantis',
      slug: 'journey-to-atlantis-2004',
      park_id: 'park-seaworld-orlando',
      opening_date: '1998-04-17',
    }),
  ],
  manufacturers: [{ id: 'm-bm', name: 'Bolliger & Mabillard' }],
})

const decisions = (items: DecisionsFile['items']): DecisionsFile => ({
  schemaVersion: 1,
  note: '',
  items,
})

describe('buildPlan — stale-decision guards', () => {
  it('skips re-home items whose coaster no longer exists', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: 'nope',
            coaster_name: 'X',
            from_park: 'other',
            to_park_slug: 'six-flags-great-america',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(0)
    expect(res.skipped[0]!.reason).toContain('stale')
  })

  it('skips when the coaster name drifted', () => {
    const s = snap()
    s.coasters[0]!.name = 'Renamed Ride'
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: 'batman-orphan',
            coaster_name: 'Batman: The Ride',
            from_park: 'other',
            to_park_slug: 'six-flags-great-america',
          },
        },
      ]),
      s,
    )
    expect(res.skipped[0]!.reason).toContain('is now named')
  })

  it('skips when the coaster left the Other bucket', () => {
    const s = snap()
    s.coasters[0]!.park_id = 'park-six-flags-great-america'
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: 'batman-orphan',
            coaster_name: 'Batman: The Ride',
            from_park: 'other',
            to_park_slug: 'six-flags-great-america',
          },
        },
      ]),
      s,
    )
    expect(res.skipped[0]!.reason).toContain('no longer at')
  })

  it('ignores undecided items and reports the count', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: false,
          payload: {
            coaster_id: 'batman-orphan',
            coaster_name: 'Batman: The Ride',
            from_park: 'other',
            to_park_slug: 'six-flags-great-america',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(0)
    expect(res.warnings.some((w) => w.includes('not yet decided'))).toBe(true)
  })
})

describe('buildPlan — re-homes', () => {
  it('plans a plain re-home with a row-count assertion', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: 'batman-orphan',
            coaster_name: 'Batman: The Ride',
            from_park: 'other',
            to_park_slug: 'seaworld-orlando',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(1)
    const st = res.ops[0]!.statements[0]!
    expect(st.text).toContain(
      'update public.coasters set park_id = (select id from public.parks where slug = $2)',
    )
    expect(st.expectRows).toBe(1)
    expect(st.params).toContain('seaworld-orlando')
  })

  it('disambiguates the slug on collision at the target park', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: 'batman-orphan',
            coaster_name: 'Batman: The Ride',
            from_park: 'other',
            to_park_slug: 'six-flags-great-america',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(1)
    const st = res.ops[0]!.statements[0]!
    expect(st.params).toContain('batman-the-ride-1992')
    expect(res.warnings.some((w) => w.includes('slug collision'))).toBe(true)
  })

  it('applies opening_date/status overrides', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: 'batman-orphan',
            coaster_name: 'Batman: The Ride',
            from_park: 'other',
            to_park_slug: 'seaworld-orlando',
            overrides: { opening_date: '1992-05-09', status: 'operating' },
          },
        },
      ]),
      snap(),
    )
    const st = res.ops[0]!.statements[0]!
    expect(st.text).toContain('opening_date = $')
    expect(st.text).toContain('status = $')
    expect(st.params).toContain('1992-05-09')
    expect(st.params).toContain('operating')
  })

  it('emits create_park before the re-home when the park is missing', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'create_park_and_rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: 'batman-orphan',
            coaster_name: 'Batman: The Ride',
            from_park: 'other',
            to_park_slug: 'cotaland',
            to_park_name: 'COTALand',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(2)
    expect(res.ops[0]!.kind).toBe('create_park')
    expect(res.ops[0]!.statements[0]!.text).toContain('insert into public.parks')
    expect(res.ops[1]!.kind).toBe('rehome_coaster')
  })

  it('skips park creation when the park already exists', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'create_park_and_rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: 'batman-orphan',
            coaster_name: 'Batman: The Ride',
            from_park: 'other',
            to_park_slug: 'seaworld-orlando',
            to_park_name: 'SeaWorld Orlando',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(1)
    expect(res.ops[0]!.kind).toBe('rehome_coaster')
    expect(res.warnings.some((w) => w.includes('already exists'))).toBe(true)
  })
})

describe('buildPlan — coaster merges', () => {
  it('plans a cross-park merge (survivor park wins) with alias + ride remap', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'coaster_merge',
          action: 'merge_coasters',
          title: '',
          decided: true,
          payload: {
            survivor_id: 'batman-sfgam',
            merge_ids: ['batman-orphan'],
            aliases: [],
            overrides: { opening_date: '1992-01-01' },
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(1)
    const texts = res.ops[0]!.statements.map((s) => s.text)
    expect(texts.some((t) => t.includes('insert into public.user_rides'))).toBe(true)
    expect(texts.some((t) => t.includes('delete from public.coaster_ratings'))).toBe(true)
    expect(texts.some((t) => t.includes('delete from public.coasters where id = $1'))).toBe(true)
    expect(texts.some((t) => t.includes('insert into public.coaster_aliases'))).toBe(false) // same name → no alias
    const override = res.ops[0]!.statements.find((s) => s.text.includes('opening_date'))
    expect(override?.params).toContain('1992-01-01')
    const del = res.ops[0]!.statements.find((s) => s.text.includes('delete from public.coasters'))
    expect(del?.expectRows).toBe(1)
  })

  it('inserts distinct loser names as aliases', () => {
    const s = snap()
    s.coasters[0]!.name = 'Batman: The Ride (Six Flags Great America)'
    const res = buildPlan(
      decisions([
        {
          id: 'ORPH-001',
          kind: 'coaster_merge',
          action: 'merge_coasters',
          title: '',
          decided: true,
          payload: {
            survivor_id: 'batman-sfgam',
            merge_ids: ['batman-orphan'],
            aliases: ['Z-Force'],
          },
        },
      ]),
      s,
    )
    const aliasStmts = res.ops[0]!.statements.filter((st) => st.text.includes('coaster_aliases'))
    expect(aliasStmts).toHaveLength(2)
    const params = aliasStmts.flatMap((st) => st.params)
    expect(params).toContain('Batman: The Ride (Six Flags Great America)')
    expect(params).toContain('Z-Force')
  })

  it('rejects a merge listing the survivor among the losers', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'DUP-001',
          kind: 'coaster_merge',
          action: 'merge_coasters',
          title: '',
          decided: true,
          payload: { survivor_id: 'batman-sfgam', merge_ids: ['batman-sfgam'] },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(0)
    expect(res.skipped[0]!.reason).toContain('survivor listed')
  })
})

describe('buildPlan — park merges', () => {
  const parkSnap = () => {
    const s = snap()
    s.parks.push(park({ slug: 'six-flags-mexico', name: 'Six Flags Mexico', id: 'park-sfm' }))
    s.parks.push(park({ slug: 'six-flags-mexico-2', name: 'Six Flags México', id: 'park-sfm2' }))
    s.coasters.push(coaster({ id: 'mex-1', name: 'Ride A', slug: 'ride-a', park_id: 'park-sfm' }))
    s.coasters.push(coaster({ id: 'mex-2', name: 'Ride B', slug: 'ride-b', park_id: 'park-sfm2' }))
    return s
  }

  it('remaps coasters, re-points submissions and deletes the loser park', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'PARK-001',
          kind: 'park_merge',
          action: 'merge_parks',
          title: '',
          decided: true,
          payload: { survivor_id: 'park-sfm', merge_ids: ['park-sfm2'] },
        },
      ]),
      parkSnap(),
    )
    expect(res.ops).toHaveLength(1)
    const kinds = res.ops[0]!.statements.map((st) => st.text)
    expect(kinds.some((t) => t.includes('update public.coasters set park_id'))).toBe(true)
    expect(kinds.some((t) => t.includes('update public.coaster_submissions set park_id'))).toBe(
      true,
    )
    expect(kinds.some((t) => t.includes('delete from public.parks'))).toBe(true)
    const remap = res.ops[0]!.statements.find((st) =>
      st.text.includes('update public.coasters set park_id'),
    )
    expect(remap?.expectRows).toBe(1)
  })

  it('renames colliding slugs before remapping', () => {
    const s = parkSnap()
    s.coasters.push(coaster({ id: 'mex-3', name: 'Ride A', slug: 'ride-a', park_id: 'park-sfm2' }))
    const res = buildPlan(
      decisions([
        {
          id: 'PARK-001',
          kind: 'park_merge',
          action: 'merge_parks',
          title: '',
          decided: true,
          payload: { survivor_id: 'park-sfm', merge_ids: ['park-sfm2'] },
        },
      ]),
      s,
    )
    const rename = res.ops[0]!.statements.find((st) => st.text.includes('set slug'))
    expect(rename).toBeTruthy()
    expect(rename?.params).toContain('ride-a-x')
    expect(res.warnings.some((w) => w.includes('slug collision'))).toBe(true)
  })

  it('refuses to merge the Other bucket park', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'PARK-001',
          kind: 'park_merge',
          action: 'merge_parks',
          title: '',
          decided: true,
          payload: { survivor_id: 'park-seaworld-orlando', merge_ids: ['park-other'] },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(0)
    expect(res.skipped[0]!.reason).toContain('Other bucket')
  })
})

describe('buildPlan — creations', () => {
  it('creates the coaster with matched manufacturer and year', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'MISS-001',
          kind: 'create_coaster',
          action: 'create_coaster',
          title: '',
          decided: true,
          payload: {
            name: 'Wrath of Rakshasa',
            park_name: 'Six Flags Great America',
            park_slug: 'six-flags-great-america',
            park_create: false,
            opening_year: '2025',
            material: 'steel',
            status: 'operating',
            suggested_manufacturer: 'Bolliger & Mabillard',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(1)
    const st = res.ops[0]!.statements[0]!
    expect(st.text).toContain('insert into public.coasters')
    expect(st.params).toContain('m-bm')
    expect(st.params).toContain('2025-01-01')
    expect(st.expectRows).toBe(1)
  })

  it('skips creation when the coaster is already present at the park', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'MISS-001',
          kind: 'create_coaster',
          action: 'create_coaster',
          title: '',
          decided: true,
          payload: {
            name: 'Batman: The Ride',
            park_name: 'Six Flags Great America',
            park_slug: 'six-flags-great-america',
            park_create: false,
            opening_year: '1992',
            material: 'steel',
            status: 'operating',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(0)
    expect(res.skipped[0]!.reason).toContain('already exists')
  })

  it('fails safely when the park is missing and park_create is false', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'MISS-001',
          kind: 'create_coaster',
          action: 'create_coaster',
          title: '',
          decided: true,
          payload: {
            name: 'Palindrome',
            park_name: 'COTALand',
            park_slug: 'cotaland',
            park_create: false,
            opening_year: '2026',
            material: 'steel',
            status: 'operating',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(0)
    expect(res.skipped[0]!.reason).toContain('park_create is false')
  })

  it('creates the park first when park_create is true', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'MISS-001',
          kind: 'create_coaster',
          action: 'create_coaster',
          title: '',
          decided: true,
          payload: {
            name: 'Palindrome',
            park_name: 'COTALand',
            park_slug: 'cotaland',
            park_create: true,
            opening_year: '2026',
            material: 'steel',
            status: 'operating',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(2)
    expect(res.ops[0]!.kind).toBe('create_park')
    expect(res.ops[1]!.kind).toBe('create_coaster')
  })

  it('rejects invalid status values', () => {
    const res = buildPlan(
      decisions([
        {
          id: 'MISS-001',
          kind: 'create_coaster',
          action: 'create_coaster',
          title: '',
          decided: true,
          payload: {
            name: 'X',
            park_name: 'P',
            park_slug: 'six-flags-great-america',
            park_create: false,
            material: 'steel',
            status: 'awesome',
          },
        },
      ]),
      snap(),
    )
    expect(res.ops).toHaveLength(0)
    expect(res.skipped[0]!.reason).toContain('payload.status')
  })
})

describe('buildPlan — ordering', () => {
  it('orders park merges → re-homes → coaster merges → creations', () => {
    const s = snap()
    s.coasters.push(
      coaster({
        id: 'flashback-orphan',
        name: 'Flashback',
        slug: 'flashback',
        park_id: 'park-other',
      }),
    )
    const res = buildPlan(
      decisions([
        {
          id: 'MISS-001',
          kind: 'create_coaster',
          action: 'create_coaster',
          title: '',
          decided: true,
          payload: {
            name: 'Wrath of Rakshasa',
            park_name: 'Six Flags Great America',
            park_slug: 'six-flags-great-america',
            park_create: false,
            opening_year: '2025',
            material: 'steel',
            status: 'operating',
          },
        },
        {
          id: 'DUP-001',
          kind: 'coaster_merge',
          action: 'merge_coasters',
          title: '',
          decided: true,
          payload: { survivor_id: 'batman-sfgam', merge_ids: ['batman-orphan'] },
        },
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: 'flashback-orphan',
            coaster_name: 'Flashback',
            from_park: 'other',
            to_park_slug: 'seaworld-san-diego',
          },
        },
      ]),
      s,
    )
    expect(res.ops.map((o) => o.kind)).toEqual([
      'rehome_coaster',
      'merge_coasters',
      'create_coaster',
    ])
  })
})
