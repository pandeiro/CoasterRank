import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  approveEditSubmission,
  approveSubmission,
  buildParkMap,
  countryOptions,
  DEFAULT_FILTERS,
  diffEditProposal,
  FEW_VOTES_THRESHOLD,
  filterCoasters,
  filtersFromSearchParams,
  filtersToSearchParams,
  firstPlaceLabel,
  firstPlaceVisibleIds,
  FIRST_PLACE_MIN_USERS,
  FIRST_PLACE_TOP_N,
  getAllCoastersAdmin,
  isFewVotes,
  capitalize,
  manufacturerOptions,
  slugify,
  submitCoaster,
  submitEditSuggestion,
  yearFromDate,
  type CoasterSubmission,
  type EditableCoasterSnapshot,
  type EditProposalInput,
} from './coasters'
import { supabase } from './supabase'
import { makePark, makeRankingRow } from '../test/fixtures'

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

describe('filtersFromSearchParams', () => {
  it('defaults to all statuses, everything material with no params (clean URL)', () => {
    expect(filtersFromSearchParams(new URLSearchParams(''))).toEqual({
      allStatuses: true,
      materialView: 'everything',
    })
  })

  it('parses all filter pairs', () => {
    const params = new URLSearchParams(
      'q=cobra&country=United States&manufacturer=Intamin&material=steel&status=running',
    )
    expect(filtersFromSearchParams(params)).toEqual({
      q: 'cobra',
      country: 'United States',
      manufacturer: 'Intamin',
      materialView: 'steel',
      allStatuses: false,
    })
  })

  it('treats status=all as all statuses', () => {
    expect(filtersFromSearchParams(new URLSearchParams('status=all')).allStatuses).toBe(true)
  })

  it('treats status=running and status=operating as operating-only', () => {
    expect(filtersFromSearchParams(new URLSearchParams('status=running')).allStatuses).toBe(false)
    expect(filtersFromSearchParams(new URLSearchParams('status=operating')).allStatuses).toBe(false)
  })

  it('falls back to the all-status default for legacy specific statuses', () => {
    expect(filtersFromSearchParams(new URLSearchParams('status=defunct')).allStatuses).toBe(true)
    expect(filtersFromSearchParams(new URLSearchParams('status=bogus')).allStatuses).toBe(true)
  })

  it('falls back to everything for unknown material values', () => {
    expect(filtersFromSearchParams(new URLSearchParams('material=hybrid')).materialView).toBe(
      'everything',
    )
  })
})

describe('filtersToSearchParams', () => {
  it('produces an empty querystring for the default view', () => {
    expect(filtersToSearchParams(DEFAULT_FILTERS).toString()).toBe('')
  })

  it('writes only non-default pairs', () => {
    const params = filtersToSearchParams({
      ...DEFAULT_FILTERS,
      q: 'cobra',
      country: 'United States',
      allStatuses: false,
      materialView: 'wood',
    })
    expect(params.toString()).toBe('q=cobra&status=running&material=wood&country=United+States')
  })

  it('round-trips through filtersFromSearchParams', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      q: 'ghost',
      materialView: 'wood' as const,
      allStatuses: false,
    }
    expect(filtersFromSearchParams(filtersToSearchParams(filters))).toEqual(filters)
  })

  it('round-trips the default (all) through filtersFromSearchParams', () => {
    expect(filtersFromSearchParams(filtersToSearchParams(DEFAULT_FILTERS))).toEqual(DEFAULT_FILTERS)
  })
})

describe('filterCoasters', () => {
  const rows = [
    makeRankingRow({
      name: 'Steel Vengeance',
      slug: 'steel-vengeance',
      status: 'operating',
      material: 'steel',
      park_name: 'Cedar Point',
      park_country: 'United States',
      manufacturer_name: 'Intamin',
    }),
    makeRankingRow({
      name: 'Wicker Man',
      slug: 'wicker-man',
      status: 'operating',
      material: 'wood',
      park_name: 'Alton Towers',
      park_country: 'United Kingdom',
      manufacturer_name: null,
    }),
    makeRankingRow({
      name: 'Mean Streak',
      slug: 'mean-streak',
      status: 'defunct',
      material: 'wood',
      park_name: 'Cedar Point',
      park_country: 'United States',
      manufacturer_name: null,
    }),
    makeRankingRow({
      name: 'Iron Gwazi',
      slug: 'iron-gwazi',
      status: 'operating',
      material: 'hybrid',
      park_name: 'Busch Gardens Tampa',
      park_country: 'United States',
      manufacturer_name: null,
      aliases: ['Gwazi'],
    }),
  ]

  it('defaults to all statuses', () => {
    expect(filterCoasters(rows, DEFAULT_FILTERS).map((r) => r.slug)).toEqual([
      'steel-vengeance',
      'wicker-man',
      'mean-streak',
      'iron-gwazi',
    ])
  })

  it('keeps operating only when filtered to running', () => {
    expect(
      filterCoasters(rows, { ...DEFAULT_FILTERS, allStatuses: false }).map((r) => r.slug),
    ).toEqual(['steel-vengeance', 'wicker-man', 'iron-gwazi'])
  })

  it('shows wooden only for materialView=wood', () => {
    expect(
      filterCoasters(rows, { ...DEFAULT_FILTERS, allStatuses: true, materialView: 'wood' }).map(
        (r) => r.slug,
      ),
    ).toEqual(['wicker-man', 'mean-streak'])
  })

  it('shows hybrids with steel for materialView=steel', () => {
    expect(
      filterCoasters(rows, { ...DEFAULT_FILTERS, allStatuses: true, materialView: 'steel' }).map(
        (r) => r.slug,
      ),
    ).toEqual(['steel-vengeance', 'iron-gwazi'])
  })

  it('filters by country via the row field', () => {
    expect(
      filterCoasters(rows, { ...DEFAULT_FILTERS, allStatuses: true, country: 'United Kingdom' }),
    ).toHaveLength(1)
  })

  it('filters by manufacturer name via the row field', () => {
    expect(
      filterCoasters(rows, { ...DEFAULT_FILTERS, allStatuses: true, manufacturer: 'Intamin' }).map(
        (r) => r.slug,
      ),
    ).toEqual(['steel-vengeance'])
  })

  it('matches ANY lineage manufacturer (multi-manufacturer coasters)', () => {
    const withLineage = [
      ...rows,
      makeRankingRow({
        name: 'Top Thrill 2',
        slug: 'top-thrill-2',
        status: 'operating',
        material: 'steel',
        park_name: 'Cedar Point',
        park_country: 'United States',
        manufacturer_name: 'Zamperla',
        manufacturer_ids: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
        manufacturer_names: ['Zamperla', 'Intamin'],
      }),
    ]
    const filter = { ...DEFAULT_FILTERS, allStatuses: true }
    // The re-track builder matches…
    expect(
      filterCoasters(withLineage, { ...filter, manufacturer: 'Zamperla' }).map((r) => r.slug),
    ).toEqual(['top-thrill-2'])
    // …and so does the original builder.
    expect(
      filterCoasters(withLineage, { ...filter, manufacturer: 'Intamin' }).map((r) => r.slug),
    ).toEqual(['steel-vengeance', 'top-thrill-2'])
  })

  it('falls back to manufacturer_name when the lineage array is absent (deploy skew)', () => {
    const skewRow = makeRankingRow({
      name: 'Legacy Row',
      slug: 'legacy-row',
      manufacturer_name: 'Zamperla',
      manufacturer_names: undefined,
    })
    expect(
      filterCoasters([skewRow], { ...DEFAULT_FILTERS, manufacturer: 'Zamperla' }),
    ).toHaveLength(1)
  })

  it('matches search case-insensitively on the coaster name', () => {
    expect(filterCoasters(rows, { ...DEFAULT_FILTERS, q: 'wicker' })).toHaveLength(1)
    expect(filterCoasters(rows, { ...DEFAULT_FILTERS, q: 'STEEL' })).toHaveLength(1)
  })

  it('matches search on the park name', () => {
    expect(
      filterCoasters(rows, { ...DEFAULT_FILTERS, allStatuses: true, q: 'alton' }).map(
        (r) => r.slug,
      ),
    ).toEqual(['wicker-man'])
  })

  it('matches search on a former name (alias)', () => {
    expect(filterCoasters(rows, { ...DEFAULT_FILTERS, q: 'gwazi' }).map((r) => r.slug)).toEqual([
      'iron-gwazi',
    ])
  })

  it('returns no rows when nothing matches the search', () => {
    expect(filterCoasters(rows, { ...DEFAULT_FILTERS, q: 'nowhere' })).toHaveLength(0)
  })
})

describe('firstPlaceLabel', () => {
  it('formats votes with the share of its rankers', () => {
    expect(firstPlaceLabel(114, 131)).toEqual({ votes: 114, pct: 87 })
  })

  it('is null for unrated coasters', () => {
    expect(firstPlaceLabel(null, null)).toBeNull()
    expect(firstPlaceLabel(0, 0)).toBeNull()
    expect(firstPlaceLabel(5, null)).toBeNull()
  })
})

describe('firstPlaceVisibleIds', () => {
  it('is empty while the community gate is not met', () => {
    const rows = [makeRankingRow({ first_place_votes: 5 })]
    expect(firstPlaceVisibleIds(rows, FIRST_PLACE_MIN_USERS)).toEqual(new Set())
    expect(firstPlaceVisibleIds(rows, 0)).toEqual(new Set())
  })

  it('unlocks past the gate and caps at the top N by votes', () => {
    const rows = Array.from({ length: FIRST_PLACE_TOP_N + 2 }, (_, i) =>
      makeRankingRow({ first_place_votes: 50 - i }),
    )
    rows.push(makeRankingRow({ first_place_votes: 0 }))
    const visible = firstPlaceVisibleIds(rows, FIRST_PLACE_MIN_USERS + 1)
    expect(visible.size).toBe(FIRST_PLACE_TOP_N)
    expect(visible.has(rows[FIRST_PLACE_TOP_N].id)).toBe(false)
    expect(visible.has(rows[0].id)).toBe(true)
  })

  it('breaks vote ties by board rank', () => {
    const rows = Array.from({ length: FIRST_PLACE_TOP_N + 1 }, (_, i) =>
      makeRankingRow({ rank: i + 1, first_place_votes: 1 }),
    )
    const visible = firstPlaceVisibleIds(rows, FIRST_PLACE_MIN_USERS + 1)
    expect(visible.has(rows[FIRST_PLACE_TOP_N].id)).toBe(false)
  })

  it('stays deterministic when tied rows have no rank', () => {
    const rows = Array.from({ length: FIRST_PLACE_TOP_N }, () =>
      makeRankingRow({ rank: null, first_place_votes: 1 }),
    )
    const visible = firstPlaceVisibleIds(rows, FIRST_PLACE_MIN_USERS + 1)
    expect(visible.size).toBe(FIRST_PLACE_TOP_N)
    expect([...visible].every((id) => rows.some((r) => r.id === id))).toBe(true)
  })
})

describe('countryOptions', () => {
  const row = (country: string | null) => makeRankingRow({ park_country: country })

  it('counts rows per country and pins the top five, United States first', () => {
    const rows = [
      ...Array.from({ length: 841 }, () => row('United States')),
      ...Array.from({ length: 10 }, () => row('Canada')),
      ...Array.from({ length: 8 }, () => row('United Kingdom')),
      ...Array.from({ length: 6 }, () => row('Deutschland')),
      ...Array.from({ length: 5 }, () => row('Japan')),
      ...Array.from({ length: 2 }, () => row('France')),
      row(null),
    ]
    expect(countryOptions(rows)).toEqual([
      { country: 'United States', count: 841, pinned: true },
      { country: 'Canada', count: 10, pinned: true },
      { country: 'United Kingdom', count: 8, pinned: true },
      { country: 'Deutschland', count: 6, pinned: true },
      { country: 'Japan', count: 5, pinned: true },
      { country: 'France', count: 2, pinned: false },
    ])
  })

  it('pins the United States first even when it is not a top-five country', () => {
    const rows = [
      ...Array.from({ length: 50 }, () => row('Japan')),
      ...Array.from({ length: 40 }, () => row('United Kingdom')),
      ...Array.from({ length: 30 }, () => row('Germany')),
      ...Array.from({ length: 20 }, () => row('France')),
      ...Array.from({ length: 10 }, () => row('Canada')),
      ...Array.from({ length: 2 }, () => row('United States')),
    ]
    const options = countryOptions(rows)
    expect(options.map((o) => o.country)[0]).toBe('United States')
    expect(options.filter((o) => o.pinned)).toHaveLength(5)
  })

  it('returns no pinned options for an empty board', () => {
    expect(countryOptions([])).toEqual([])
  })
})

describe('manufacturerOptions', () => {
  it('lists distinct manufacturer names alphabetically', () => {
    const rows = [
      makeRankingRow({ manufacturer_name: 'Intamin' }),
      makeRankingRow({ manufacturer_name: 'B&M' }),
      makeRankingRow({ manufacturer_name: 'Intamin' }),
      makeRankingRow({ manufacturer_name: null }),
    ]
    expect(manufacturerOptions(rows)).toEqual(['B&M', 'Intamin'])
  })

  it('unions every lineage entry so secondary manufacturers are selectable', () => {
    const rows = [
      makeRankingRow({ manufacturer_name: 'Intamin', manufacturer_names: ['Intamin'] }),
      makeRankingRow({
        manufacturer_name: 'Zamperla',
        manufacturer_names: ['Zamperla', 'Intamin'],
      }),
      makeRankingRow({ manufacturer_name: 'Zamperla', manufacturer_names: ['Zamperla'] }),
    ]
    expect(manufacturerOptions(rows)).toEqual(['Intamin', 'Zamperla'])
  })

  it('unions the fallback name when the lineage array is absent', () => {
    const rows = [makeRankingRow({ manufacturer_name: 'Intamin', manufacturer_names: undefined })]
    expect(manufacturerOptions(rows)).toEqual(['Intamin'])
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

describe('slugify', () => {
  it('lowercases and dashes spaces', () => {
    expect(slugify('Steel Vengeance')).toBe('steel-vengeance')
  })

  it('collapses runs of whitespace and strips punctuation', () => {
    expect(slugify('  Kingda  Ka! (2005) ')).toBe('kingda-ka-2005')
  })
})

describe('getAllCoastersAdmin', () => {
  const range = vi.fn()
  const order = vi.fn()
  const select = vi.fn()

  function installFromMock(): void {
    range.mockResolvedValue({ data: [], error: null })
    order.mockReturnValue({ range })
    select.mockReturnValue({ order })
    vi.mocked(supabase.from).mockReturnValue({ select } as never)
    // PostgrestSingleResponse carries extra fields the narrow literal misses;
    // tests only exercise data/error paths.
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [],
      error: null,
      success: true,
      count: null,
      status: 200,
      statusText: 'OK',
    } as never)
  }

  it('pins the manufacturers embed to the direct FK (lineage junction ambiguity)', async () => {
    // coaster_manufacturers gives coasters a SECOND path to manufacturers, so
    // the bare `manufacturers(...)` embed is ambiguous — prod PostgREST 400s
    // with PGRST201 and the admin Coasters panel fails to load. The
    // `!coasters_manufacturer_id_fkey` hint must stay on every coasters →
    // manufacturers embed (same guard in lib/rides.test.tsx).
    installFromMock()
    await getAllCoastersAdmin()
    expect(select.mock.calls[0][0]).toContain('manufacturers!coasters_manufacturer_id_fkey(')
    // Ride counts no longer ride the embed (it ran under the caller's RLS and
    // zeroed out) — they come from the admin-gated RPC.
    expect(select.mock.calls[0][0]).not.toContain('user_rides(count)')
    expect(vi.mocked(supabase.rpc)).toHaveBeenCalledWith('coaster_ride_counts')
  })

  it('merges per-coaster ride counts from the RPC', async () => {
    installFromMock()
    range.mockResolvedValue({
      data: [
        { id: 'c1', coaster_manufacturers: null },
        { id: 'c2', coaster_manufacturers: null },
      ],
      error: null,
    })
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [
        { coaster_id: 'c1', rides: 7 },
        { coaster_id: 'c2', rides: 2 },
      ],
      error: null,
      success: true,
      count: 2,
      status: 200,
      statusText: 'OK',
    } as never)
    const coasters = await getAllCoastersAdmin()
    expect(coasters.map((c) => c.ride_count)).toEqual([7, 2])
  })

  it('treats coasters without rides (or a failed RPC) as 0 instead of throwing', async () => {
    installFromMock()
    range.mockResolvedValue({ data: [{ id: 'c1' }, { id: 'c2' }], error: null })
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: [{ coaster_id: 'c1', rides: 3 }],
      error: null,
      success: true,
      count: 1,
      status: 200,
      statusText: 'OK',
    } as never)
    expect((await getAllCoastersAdmin()).map((c) => c.ride_count)).toEqual([3, 0])

    // Deploy skew: RPC missing entirely → zeros, panel still loads.
    vi.mocked(supabase.rpc).mockRejectedValue(new Error('schema cache'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect((await getAllCoastersAdmin()).map((c) => c.ride_count)).toEqual([0, 0])
    } finally {
      warn.mockRestore()
    }
  })
})

describe('approveSubmission', () => {
  const insertSingle = vi.fn()
  const coasterInsert = vi.fn()
  const coasterSingle = vi.fn()
  const lineageRange = vi.fn()
  const lineageDeleteIn = vi.fn()
  const lineageUpsert = vi.fn()
  const submissionUpdateEq = vi.fn()
  const parksUpdate = vi.fn()
  const parksUpdateEq = vi.fn()
  // Queued results for approveSubmission's park-by-slug lookups (select
  // 'id, city, …'): each findParkBySlug call shifts one entry — a string is
  // shorthand for { id }, an object the full row; empty queue → no park found.
  let parkIdLookups: (string | Record<string, unknown> | null)[]

  const shiftParkLookup = (): Record<string, unknown> | null => {
    const entry = parkIdLookups.shift()
    if (entry === undefined || entry === null) return null
    return typeof entry === 'string' ? { id: entry } : entry
  }

  const submission = {
    id: 's1',
    kind: 'new',
    coaster_id: null,
    coaster_name: 'Test Coaster',
    park_name: 'Test Park',
    park_id: null,
    suggested_fields: {
      height_m: null,
      speed_kmh: null,
      length_m: null,
      inversions: null,
      material: null,
    },
    submitted_by: 'u1',
    status: 'pending',
    reviewer_note: null,
    reviewed_by: null,
    created_at: '',
    reviewed_at: null,
    seen_by_submitter_at: null,
  } satisfies CoasterSubmission

  // helpers for the new global-unique slug path
  const makeCoasterSelectMock = (existingSlugs: string[] = []) =>
    ({
      like: () => ({
        range: vi
          .fn()
          .mockResolvedValue({ data: existingSlugs.map((s) => ({ slug: s })), error: null }),
      }),
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: null }),
        single: vi.fn(),
      }),
    }) as unknown

  const makeParkSelectMock = (row: { slug?: string; id?: string } | null = null) =>
    ({
      eq: () => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      }),
    }) as unknown

  beforeEach(() => {
    vi.clearAllMocks()
    parkIdLookups = []
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: 'u1' } } } as never)
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'parks') {
        const insertMock = { insert: () => ({ select: () => ({ single: insertSingle }) }) }
        // select: approveSubmission's park-reuse lookup requests the id
        // (queued results, default none → insert path); the coaster-slug
        // resolver requests the slug.
        return Object.assign(() => insertMock, {
          insert: insertMock.insert,
          update: parksUpdate,
          select: vi
            .fn()
            .mockImplementation((columns: string) =>
              makeParkSelectMock(
                columns.includes('id') ? shiftParkLookup() : { slug: 'test-park' },
              ),
            ),
        }) as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'coasters') {
        return {
          insert: coasterInsert,
          select: vi.fn().mockReturnValue(makeCoasterSelectMock()),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'manufacturers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
          }),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'coaster_manufacturers') {
        return {
          select: () => ({ eq: () => ({ range: lineageRange }) }),
          delete: () => ({ eq: () => ({ in: lineageDeleteIn }) }),
          upsert: lineageUpsert,
        } as unknown as ReturnType<typeof supabase.from>
      }
      return { update: () => ({ eq: submissionUpdateEq }) } as unknown as ReturnType<
        typeof supabase.from
      >
    }) as never)
    insertSingle.mockResolvedValue({ data: { id: 'p9' }, error: null })
    parksUpdate.mockReturnValue({ eq: parksUpdateEq })
    parksUpdateEq.mockResolvedValue({ error: null })
    // The coaster insert is always followed by .select('id').single() so the
    // lineage write can target the new row.
    coasterInsert.mockImplementation(() => ({ select: () => ({ single: coasterSingle }) }))
    coasterSingle.mockResolvedValue({ data: { id: 'c9' }, error: null })
    lineageRange.mockResolvedValue({ data: [], error: null })
    lineageDeleteIn.mockResolvedValue({ error: null })
    lineageUpsert.mockResolvedValue({ error: null })
    submissionUpdateEq.mockResolvedValue({ error: null })
  })

  it('creates the park and coaster with slugified slugs', async () => {
    await approveSubmission('s1', submission)
    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith('parks')
    expect(insertSingle).toHaveBeenCalled()
    expect(coasterInsert).toHaveBeenCalledWith(
      expect.objectContaining({ park_id: 'p9', slug: 'test-coaster', source: 'community' }),
    )
    expect(submissionUpdateEq).toHaveBeenCalledWith('id', 's1')
  })

  it('does not let unreviewed submission keys override catalog fields', async () => {
    const maliciousSubmission = {
      ...submission,
      suggested_fields: {
        ...submission.suggested_fields,
        park_id: 'attacker-park',
        source: 'admin',
        id: 'attacker-id',
      },
    } as unknown as CoasterSubmission

    await approveSubmission('s1', maliciousSubmission)

    expect(coasterInsert).toHaveBeenCalledWith(
      expect.objectContaining({ park_id: 'p9', source: 'community' }),
    )
    expect(coasterInsert.mock.calls[0][0]).not.toHaveProperty('id', 'attacker-id')
  })

  it('maps a park slug collision to a friendly error', async () => {
    insertSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })
    await expect(approveSubmission('s1', submission)).rejects.toThrow(
      'Could not create park "Test Park".',
    )
    expect(coasterInsert).not.toHaveBeenCalled()
  })

  it('reuses an existing park with the same slug instead of failing', async () => {
    // A prior approval already created the park this submission named.
    parkIdLookups.push('p7')
    await approveSubmission('s1', submission)
    expect(insertSingle).not.toHaveBeenCalled()
    expect(coasterInsert).toHaveBeenCalledWith(expect.objectContaining({ park_id: 'p7' }))
    expect(submissionUpdateEq).toHaveBeenCalledWith('id', 's1')
  })

  it('backfills the proposed location when reusing a park minted without one', async () => {
    // A pre-park_location approval minted the park name+slug only; a
    // re-submission carrying park_location must not have it silently
    // dropped on reuse (Shepard's Adventure Park incident, 2026-09-12).
    parkIdLookups.push({ id: 'p7', city: null, region: null, country: null, lat: null, lng: null })
    await approveSubmission('s1', {
      ...submission,
      suggested_fields: {
        ...submission.suggested_fields,
        park_location: {
          city: 'Branson',
          region: 'Missouri',
          country: 'United States',
          lat: 36.667415,
          lng: 93.30673,
        },
      },
    } as unknown as CoasterSubmission)
    expect(parksUpdate).toHaveBeenCalledTimes(1)
    expect(parksUpdate).toHaveBeenCalledWith({
      city: 'Branson',
      region: 'Missouri',
      country: 'United States',
      lat: 36.667415,
      lng: 93.30673,
    })
    expect(parksUpdateEq).toHaveBeenCalledWith('id', 'p7')
    expect(coasterInsert).toHaveBeenCalledWith(expect.objectContaining({ park_id: 'p7' }))
  })

  it('does not overwrite location data on a reused park that already has it', async () => {
    parkIdLookups.push({
      id: 'p7',
      city: 'Somewhere',
      region: null,
      country: 'USA',
      lat: 40,
      lng: -80,
    })
    await approveSubmission('s1', {
      ...submission,
      suggested_fields: {
        ...submission.suggested_fields,
        park_location: { city: 'Branson', country: 'United States', lat: 36.67, lng: 93.31 },
      },
    } as unknown as CoasterSubmission)
    expect(parksUpdate).not.toHaveBeenCalled()
    expect(coasterInsert).toHaveBeenCalledWith(expect.objectContaining({ park_id: 'p7' }))
  })

  it('links to the park a concurrent approval created when the insert hits a slug collision', async () => {
    // Lookup misses, insert races a 23505, re-lookup finds the winner.
    parkIdLookups.push(null, 'p7')
    insertSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })
    await approveSubmission('s1', submission)
    expect(insertSingle).toHaveBeenCalledTimes(1)
    expect(coasterInsert).toHaveBeenCalledWith(expect.objectContaining({ park_id: 'p7' }))
    expect(submissionUpdateEq).toHaveBeenCalledWith('id', 's1')
  })

  it('retries with park-suffixed slug on global coaster collision then succeeds', async () => {
    // first insert claims slug, second succeeds with park suffix
    coasterSingle
      .mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } })
      .mockResolvedValueOnce({ data: { id: 'c9' }, error: null })
    // make the global slug check see existing base slug
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'parks') {
        // The by-slug park lookup (columns include 'id') must MISS so the
        // insert path runs; the slug collision retry selects 'slug' by id.
        const sel = vi
          .fn()
          .mockImplementation((columns: string) =>
            makeParkSelectMock(columns.includes('id') ? null : { slug: 'test-park' }),
          )
        return {
          insert: () => ({ select: () => ({ single: insertSingle }) }),
          select: sel,
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'coasters') {
        return {
          insert: coasterInsert,
          select: vi.fn().mockReturnValue(makeCoasterSelectMock(['test-coaster'])),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'manufacturers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null }) }),
          }),
        } as unknown as ReturnType<typeof supabase.from>
      }
      return { update: () => ({ eq: submissionUpdateEq }) } as unknown as ReturnType<
        typeof supabase.from
      >
    }) as never)
    insertSingle.mockResolvedValue({ data: { id: 'p9' }, error: null })
    submissionUpdateEq.mockResolvedValue({ error: null })
    await approveSubmission('s1', submission)
    expect(coasterInsert).toHaveBeenCalledTimes(2)
    expect(coasterInsert).toHaveBeenLastCalledWith(
      expect.objectContaining({ slug: 'test-coaster-test-park' }),
    )
  })

  it('maps a persistent coaster slug collision to a friendly error after retries', async () => {
    coasterSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })
    await expect(approveSubmission('s1', submission)).rejects.toThrow(/already exists \(slug/)
    expect(submissionUpdateEq).not.toHaveBeenCalled()
  })

  it('skips park creation when the submission already has a park', async () => {
    await approveSubmission('s1', { ...submission, park_id: 'p1' })
    expect(insertSingle).not.toHaveBeenCalled()
    expect(coasterInsert).toHaveBeenCalledWith(expect.objectContaining({ park_id: 'p1' }))
  })

  it('applies approvable descriptive fields but strips hostile keys (C-01)', async () => {
    const hostile = {
      ...submission,
      park_id: 'p1',
      suggested_fields: {
        ...submission.suggested_fields,
        height_m: 40,
        park_id: 'evil-park',
        name: 'Evil Name',
        slug: 'evil-slug',
        source: 'admin',
        status: 'defunct',
        external_id: 'evil',
        id: 'evil-id',
        manufacturer_id: '11111111-2222-4333-8444-555555555555',
        model: 'Ibox',
        opening_date: '2024-05-04',
      },
    } as unknown as CoasterSubmission
    await approveSubmission('s1', hostile)
    expect(coasterInsert).toHaveBeenCalledWith({
      park_id: 'p1',
      name: 'Test Coaster',
      slug: 'test-coaster',
      source: 'community',
      height_m: 40,
      speed_kmh: null,
      length_m: null,
      inversions: null,
      status: 'defunct',
      model: 'Ibox',
      opening_date: '2024-05-04',
    })
    const insertArg = coasterInsert.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg).not.toHaveProperty('id')
    expect(insertArg).not.toHaveProperty('external_id')
    // The row no longer carries manufacturer_id — the lineage rides via
    // coaster_manufacturers (legacy single id normalizes to a 1-entry list).
    expect(insertArg).not.toHaveProperty('manufacturer_id')
    expect(lineageUpsert).toHaveBeenCalledWith(
      [
        {
          coaster_id: 'c9',
          manufacturer_id: '11111111-2222-4333-8444-555555555555',
          position: 0,
          source: 'submission',
        },
      ],
      { onConflict: 'coaster_id,manufacturer_id' },
    )
  })

  it('creates a multi-manufacturer lineage from manufacturer_ids', async () => {
    await approveSubmission('s1', {
      ...submission,
      park_id: 'p1',
      suggested_fields: {
        ...submission.suggested_fields,
        manufacturer_ids: [
          '11111111-2222-4333-8444-555555555555',
          '22222222-3333-4333-8444-555555555555',
        ],
      },
    } as unknown as CoasterSubmission)
    expect(lineageUpsert).toHaveBeenCalledWith(
      [
        {
          coaster_id: 'c9',
          manufacturer_id: '11111111-2222-4333-8444-555555555555',
          position: 0,
          source: 'submission',
        },
        {
          coaster_id: 'c9',
          manufacturer_id: '22222222-3333-4333-8444-555555555555',
          position: 1,
          source: 'submission',
        },
      ],
      { onConflict: 'coaster_id,manufacturer_id' },
    )
  })

  it('creates proposed manufacturers and interleaves them by position', async () => {
    const manuInsertSingle = vi.fn()
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'parks') {
        return {
          select: vi.fn().mockReturnValue(makeParkSelectMock({ slug: 'test-park' })),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'coasters') {
        return {
          insert: coasterInsert,
          select: vi.fn().mockReturnValue(makeCoasterSelectMock(['test-coaster'])),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'manufacturers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
          insert: () => ({ select: () => ({ single: manuInsertSingle }) }),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'coaster_manufacturers') {
        return {
          select: () => ({ eq: () => ({ range: lineageRange }) }),
          delete: () => ({ eq: () => ({ in: lineageDeleteIn }) }),
          upsert: lineageUpsert,
        } as unknown as ReturnType<typeof supabase.from>
      }
      return { update: () => ({ eq: submissionUpdateEq }) } as unknown as ReturnType<
        typeof supabase.from
      >
    }) as never)
    manuInsertSingle.mockResolvedValue({
      data: { id: '77777777-6666-4555-8444-333333333333' },
      error: null,
    })
    await approveSubmission('s1', {
      ...submission,
      park_id: 'p1',
      suggested_fields: {
        ...submission.suggested_fields,
        manufacturer_ids: ['11111111-2222-4333-8444-555555555555'],
        proposed_manufacturers: [{ name: 'Gerstlauer', position: 0 }],
      },
    } as unknown as CoasterSubmission)
    // The proposed entry takes slot 0 (becomes the primary); the existing id
    // backfills slot 1.
    expect(lineageUpsert).toHaveBeenCalledWith(
      [
        {
          coaster_id: 'c9',
          manufacturer_id: '77777777-6666-4555-8444-333333333333',
          position: 0,
          source: 'submission',
        },
        {
          coaster_id: 'c9',
          manufacturer_id: '11111111-2222-4333-8444-555555555555',
          position: 1,
          source: 'submission',
        },
      ],
      { onConflict: 'coaster_id,manufacturer_id' },
    )
  })

  it('writes the proposed park location onto the community park', async () => {
    const parksInsert = vi.fn().mockReturnValue({ select: () => ({ single: insertSingle }) })
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'parks') {
        // The by-slug park lookup (columns include 'id') must MISS so the
        // mint path runs; this test exercises the insert-with-location branch.
        return {
          insert: parksInsert,
          select: vi
            .fn()
            .mockImplementation((columns: string) =>
              makeParkSelectMock(columns.includes('id') ? null : { slug: 'test-park' }),
            ),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'coasters') {
        return {
          insert: coasterInsert,
          select: vi.fn().mockReturnValue(makeCoasterSelectMock()),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'coaster_manufacturers') {
        return {
          select: () => ({ eq: () => ({ range: lineageRange }) }),
          delete: () => ({ eq: () => ({ in: lineageDeleteIn }) }),
          upsert: lineageUpsert,
        } as unknown as ReturnType<typeof supabase.from>
      }
      return { update: () => ({ eq: submissionUpdateEq }) } as unknown as ReturnType<
        typeof supabase.from
      >
    }) as never)
    await approveSubmission('s1', {
      ...submission,
      park_id: null,
      suggested_fields: {
        ...submission.suggested_fields,
        park_location: {
          city: 'Sandusky',
          region: 'Ohio',
          country: 'USA',
          lat: 41.47,
          lng: -82.68,
        },
      },
    } as unknown as CoasterSubmission)
    expect(parksInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Park',
        slug: 'test-park',
        source: 'community',
        city: 'Sandusky',
        region: 'Ohio',
        country: 'USA',
        lat: 41.47,
        lng: -82.68,
      }),
    )
  })

  it('drops malformed descriptive values instead of applying them', async () => {
    const malformed = {
      ...submission,
      park_id: 'p1',
      suggested_fields: {
        ...submission.suggested_fields,
        manufacturer_id: 'not-a-uuid',
        status: 'running',
        model: 'x'.repeat(121),
        type: 42,
        opening_date: 'not-a-date',
      },
    } as unknown as CoasterSubmission
    await approveSubmission('s1', malformed)
    // Null/absent material+status are OMITTED (not written as null) so the
    // coasters defaults ('other'/'unknown') apply — writing explicit nulls
    // violates NOT NULL and made stats-less submissions unapprovable.
    expect(coasterInsert).toHaveBeenCalledWith({
      park_id: 'p1',
      name: 'Test Coaster',
      slug: 'test-coaster',
      source: 'community',
      height_m: null,
      speed_kmh: null,
      length_m: null,
      inversions: null,
    })
    expect(lineageUpsert).not.toHaveBeenCalled()
  })

  it('omits null material/status so the coasters defaults apply (stats-less submissions stay approvable)', async () => {
    // The Turbo Track shape: every suggested field null. The INSERT must not
    // carry explicit nulls for the NOT NULL columns.
    await approveSubmission('s1', { ...submission, park_id: 'p1' })
    const insertArg = coasterInsert.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg).not.toHaveProperty('material')
    expect(insertArg).not.toHaveProperty('status')
    expect(insertArg).toMatchObject({
      park_id: 'p1',
      height_m: null,
      speed_kmh: null,
      length_m: null,
      inversions: null,
    })
  })

  it('sanitizes out-of-range stats to null instead of failing the INSERT', async () => {
    await approveSubmission('s1', {
      ...submission,
      park_id: 'p1',
      suggested_fields: {
        ...submission.suggested_fields,
        height_m: 9999,
        inversions: 2.5,
      },
    } as unknown as CoasterSubmission)
    expect(coasterInsert).toHaveBeenCalledWith(
      expect.objectContaining({ height_m: null, inversions: null }),
    )
  })
})

describe('submitCoaster / submitEditSuggestion schema chokepoints', () => {
  const validFields = {
    height_m: null,
    speed_kmh: null,
    length_m: null,
    inversions: null,
    material: null,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: 'u1' } } } as never)
  })

  it('rejects a new submission with a blank coaster name before touching the DB', async () => {
    await expect(
      submitCoaster({
        coaster_name: '   ',
        park_name: 'Cedar Point',
        park_id: null,
        suggested_fields: validFields,
        note: null,
      }),
    ).rejects.toThrow(/coaster name/i)
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })

  it('rejects out-of-range stats before touching the DB', async () => {
    await expect(
      submitCoaster({
        coaster_name: 'Millennium Force',
        park_name: 'Cedar Point',
        park_id: null,
        suggested_fields: { ...validFields, height_m: 9999 },
        note: null,
      }),
    ).rejects.toThrow(/height/i)
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })

  it('rejects an edit with an empty diff or bad target before touching the DB', async () => {
    const coasterId = '11111111-2222-4333-8444-555555555555'
    const parkId = '22222222-3333-4333-8444-555555555555'
    const base = {
      coaster_name: 'Steel Vengeance',
      park_name: 'Cedar Point',
      note: null,
    }
    await expect(
      submitEditSuggestion({
        ...base,
        coaster_id: 'not-a-uuid',
        park_id: parkId,
        suggested_fields: { height_m: 63 },
      }),
    ).rejects.toThrow(/missing its coaster/)
    await expect(
      submitEditSuggestion({
        ...base,
        coaster_id: coasterId,
        park_id: '',
        suggested_fields: { height_m: 63 },
      }),
    ).rejects.toThrow(/park/i)
    await expect(
      submitEditSuggestion({
        ...base,
        coaster_id: coasterId,
        park_id: parkId,
        suggested_fields: {},
      }),
    ).rejects.toThrow(/at least one/)
    expect(vi.mocked(supabase.from)).not.toHaveBeenCalled()
  })
})

describe('diffEditProposal', () => {
  const current: EditableCoasterSnapshot = {
    name: 'Steel Vengeance',
    park_id: 'park-1',
    status: 'operating',
    material: 'hybrid',
    height_m: 62,
    speed_kmh: 119,
    length_m: 1700,
    inversions: 4,
    manufacturer_id: 'mfg-1',
    manufacturer_ids: ['mfg-1', 'mfg-2'],
    model: null,
    type: 'Hybrid Coaster',
    opening_date: '2018-04-28',
  }

  function proposal(overrides: Partial<EditProposalInput> = {}): EditProposalInput {
    return {
      name: 'Steel Vengeance',
      park_id: 'park-1',
      status: 'operating',
      material: 'hybrid',
      height_m: '62',
      speed_kmh: '119',
      length_m: '1700',
      inversions: '4',
      manufacturerPicks: [
        { id: 'mfg-1', name: 'Intamin' },
        { id: 'mfg-2', name: 'Zamperla' },
      ],
      parkLocation: {},
      model: '',
      type: 'Hybrid Coaster',
      opening_date: '2018-04-28',
      ...overrides,
    }
  }

  it('returns an empty diff when nothing changed', () => {
    expect(diffEditProposal(current, proposal())).toEqual({ diff: {}, parkChanged: false })
  })

  it('picks up only changed scalars', () => {
    expect(diffEditProposal(current, proposal({ height_m: '63', status: 'sbno' }))).toEqual({
      diff: { height_m: 63, status: 'sbno' },
      parkChanged: false,
    })
  })

  it('reports park moves separately from the diff', () => {
    expect(diffEditProposal(current, proposal({ park_id: 'park-2' }))).toEqual({
      diff: {},
      parkChanged: true,
    })
  })

  it('treats a cleared stat as an explicit null change', () => {
    expect(diffEditProposal(current, proposal({ height_m: '' }))).toEqual({
      diff: { height_m: null },
      parkChanged: false,
    })
  })

  it('ignores invalid enum values instead of proposing them', () => {
    expect(
      diffEditProposal(current, proposal({ material: 'titanium', status: 'running' })),
    ).toEqual({ diff: {}, parkChanged: false })
  })

  it('requires a non-empty name change', () => {
    expect(diffEditProposal(current, proposal({ name: '  ' }))).toEqual({
      diff: {},
      parkChanged: false,
    })
    expect(diffEditProposal(current, proposal({ name: 'SteVe' })).diff).toEqual({
      name: 'SteVe',
    })
  })

  it('picks up manufacturer lineage swaps, clears and reorders', () => {
    // Same ids, different order → a change (order decides the primary).
    expect(
      diffEditProposal(
        current,
        proposal({
          manufacturerPicks: [
            { id: 'mfg-2', name: 'Zamperla' },
            { id: 'mfg-1', name: 'Intamin' },
          ],
        }),
      ).diff,
    ).toEqual({ manufacturer_ids: ['mfg-2', 'mfg-1'] })
    // Shrink to one → a change.
    expect(
      diffEditProposal(current, proposal({ manufacturerPicks: [{ id: 'mfg-1', name: 'Intamin' }] }))
        .diff,
    ).toEqual({ manufacturer_ids: ['mfg-1'] })
    // Explicit clear → empty list.
    expect(diffEditProposal(current, proposal({ manufacturerPicks: [] })).diff).toEqual({
      manufacturer_ids: [],
    })
    // Identical list → no diff.
    expect(diffEditProposal(current, proposal()).diff).toEqual({})
  })

  it('carries proposed manufacturers with their merged-lineage position', () => {
    // A proposed entry interleaves with existing ids (position 1 here);
    // the id list always rides along so approval can replace the lineage.
    expect(
      diffEditProposal(
        current,
        proposal({
          manufacturerPicks: [
            { id: 'mfg-2', name: 'Zamperla' },
            { id: null, name: 'Gerstlauer' },
          ],
        }),
      ).diff,
    ).toEqual({
      manufacturer_ids: ['mfg-2'],
      proposed_manufacturers: [{ name: 'Gerstlauer', position: 1 }],
    })
    // A proposals-only edit still sends the (unchanged) id list.
    expect(
      diffEditProposal(current, proposal({ manufacturerPicks: [{ id: null, name: 'Gerstlauer' }] }))
        .diff,
    ).toEqual({
      manufacturer_ids: [],
      proposed_manufacturers: [{ name: 'Gerstlauer', position: 0 }],
    })
    // Proposals are a change even when the ids are untouched.
    expect(
      diffEditProposal(
        current,
        proposal({
          manufacturerPicks: [
            { id: 'mfg-1', name: 'Intamin' },
            { id: 'mfg-2', name: 'Zamperla' },
            { id: null, name: 'Gerstlauer' },
          ],
        }),
      ).diff,
    ).toEqual({
      manufacturer_ids: ['mfg-1', 'mfg-2'],
      proposed_manufacturers: [{ name: 'Gerstlauer', position: 2 }],
    })
  })

  it('attaches park_location only for a new-park proposal (park_id null)', () => {
    expect(
      diffEditProposal(
        current,
        proposal({
          park_id: null,
          parkLocation: { city: 'Sandusky', country: 'USA', lat: '41.4', lng: '-82.7' },
        }),
      ),
    ).toEqual({
      diff: { park_location: { city: 'Sandusky', country: 'USA', lat: 41.4, lng: -82.7 } },
      parkChanged: true,
    })
    // Moving to an EXISTING park ignores the location draft.
    expect(
      diffEditProposal(
        current,
        proposal({
          park_id: 'park-2',
          parkLocation: { city: 'Sandusky' },
        }),
      ),
    ).toEqual({ diff: {}, parkChanged: true })
    // A new-park proposal with an empty location carries none.
    expect(diffEditProposal(current, proposal({ park_id: null })).diff).toEqual({})
  })
})

describe('approveEditSubmission', () => {
  const coasterUpdateEq = vi.fn()
  const submissionUpdateEq = vi.fn()
  const lineageRange = vi.fn()
  const lineageDeleteIn = vi.fn()
  const lineageUpsert = vi.fn()

  const editSubmission = {
    id: 'e1',
    kind: 'edit',
    coaster_id: 'c1',
    coaster_name: 'Steel Vengeance',
    park_name: 'Cedar Point',
    park_id: 'park-1',
    suggested_fields: {
      height_m: 63,
      status: 'sbno',
    },
    submitted_by: 'u1',
    status: 'pending',
    reviewer_note: null,
    reviewed_by: null,
    created_at: '',
    reviewed_at: null,
    seen_by_submitter_at: null,
  } as unknown as CoasterSubmission

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabase.auth.getUser).mockResolvedValue({
      data: { user: { id: 'admin1' } },
    } as never)
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'coasters') {
        return { update: vi.fn().mockReturnValue({ eq: coasterUpdateEq }) }
      }
      if (table === 'coaster_manufacturers') {
        return {
          select: () => ({ eq: () => ({ range: lineageRange }) }),
          delete: () => ({ eq: () => ({ in: lineageDeleteIn }) }),
          upsert: lineageUpsert,
        } as unknown as ReturnType<typeof supabase.from>
      }
      return { update: () => ({ eq: submissionUpdateEq }) } as unknown as ReturnType<
        typeof supabase.from
      >
    }) as never)
    coasterUpdateEq.mockResolvedValue({ error: null })
    submissionUpdateEq.mockResolvedValue({ error: null })
    lineageRange.mockResolvedValue({ data: [], error: null })
    lineageDeleteIn.mockResolvedValue({ error: null })
    lineageUpsert.mockResolvedValue({ error: null })
  })

  it('applies the allowlisted diff plus park, with no removed columns', async () => {
    await approveEditSubmission('e1', editSubmission)
    expect(coasterUpdateEq).toHaveBeenCalledWith('id', 'c1')
    const updateArg = vi.mocked(supabase.from).mock.calls.length
    expect(updateArg).toBeGreaterThan(0)
    const updateMock = vi.mocked(supabase.from).mock.results[0].value as {
      update: ReturnType<typeof vi.fn>
    }
    expect(updateMock.update).toHaveBeenCalledWith(
      expect.objectContaining({
        height_m: 63,
        status: 'sbno',
        park_id: 'park-1',
      }),
    )
    // last_verified_at was dropped from coasters (dedup-infrastructure
    // removal); writing it fails the UPDATE with an undefined-column error.
    const applied = updateMock.update.mock.calls[0][0] as Record<string, unknown>
    expect(applied).not.toHaveProperty('last_verified_at')
    expect(submissionUpdateEq).toHaveBeenCalledWith('id', 'e1')
  })

  it('drops hostile payload keys instead of applying them', async () => {
    const hostile = {
      ...editSubmission,
      suggested_fields: {
        height_m: 63,
        source: 'admin',
        slug: 'evil',
        park_id: 'evil-park',
        id: 'evil-id',
      },
    } as unknown as CoasterSubmission
    await approveEditSubmission('e1', hostile)
    const updateMock = vi.mocked(supabase.from).mock.results[0].value as {
      update: ReturnType<typeof vi.fn>
    }
    const applied = updateMock.update.mock.calls[0][0] as Record<string, unknown>
    expect(applied).not.toHaveProperty('source')
    expect(applied).not.toHaveProperty('slug')
    expect(applied).not.toHaveProperty('id')
    expect(applied.park_id).toBe('park-1')
  })

  it('replaces the lineage with a well-formed legacy single manufacturer', async () => {
    await approveEditSubmission('e1', {
      ...editSubmission,
      suggested_fields: { manufacturer_id: '99999999-8888-4777-8666-555555555555' },
    } as unknown as CoasterSubmission)
    const good = vi.mocked(supabase.from).mock.results[0].value as {
      update: ReturnType<typeof vi.fn>
    }
    // The row update no longer touches manufacturer_id (trigger-maintained).
    expect(good.update.mock.calls[0][0]).not.toHaveProperty('manufacturer_id')
    expect(lineageUpsert).toHaveBeenCalledWith(
      [
        {
          coaster_id: 'c1',
          manufacturer_id: '99999999-8888-4777-8666-555555555555',
          position: 0,
          source: 'submission',
        },
      ],
      { onConflict: 'coaster_id,manufacturer_id' },
    )
  })

  it('replaces the whole lineage with a proposed manufacturer_ids array', async () => {
    lineageRange.mockResolvedValue({
      data: [{ manufacturer_id: 'aaaaaaaa-0000-4999-8999-999999999999' }],
      error: null,
    })
    await approveEditSubmission('e1', {
      ...editSubmission,
      suggested_fields: {
        manufacturer_ids: [
          '99999999-8888-4777-8666-555555555555',
          '88888888-7777-4666-8666-555555555555',
        ],
      },
    } as unknown as CoasterSubmission)
    // The old primary is replaced, not preserved (decided 2026-09).
    expect(lineageDeleteIn).toHaveBeenCalledWith('manufacturer_id', [
      'aaaaaaaa-0000-4999-8999-999999999999',
    ])
    expect(lineageUpsert).toHaveBeenCalledWith(
      [
        {
          coaster_id: 'c1',
          manufacturer_id: '99999999-8888-4777-8666-555555555555',
          position: 0,
          source: 'submission',
        },
        {
          coaster_id: 'c1',
          manufacturer_id: '88888888-7777-4666-8666-555555555555',
          position: 1,
          source: 'submission',
        },
      ],
      { onConflict: 'coaster_id,manufacturer_id' },
    )
  })

  it('treats an empty lineage proposal as an explicit clear', async () => {
    lineageRange.mockResolvedValue({
      data: [
        { manufacturer_id: 'aaaaaaaa-0000-4999-8999-999999999999' },
        { manufacturer_id: 'bbbbbbbb-0000-4999-8999-999999999999' },
      ],
      error: null,
    })
    await approveEditSubmission('e1', {
      ...editSubmission,
      suggested_fields: { manufacturer_ids: [] },
    } as unknown as CoasterSubmission)
    expect(lineageDeleteIn).toHaveBeenCalledWith('manufacturer_id', [
      'aaaaaaaa-0000-4999-8999-999999999999',
      'bbbbbbbb-0000-4999-8999-999999999999',
    ])
    expect(lineageUpsert).not.toHaveBeenCalled()
  })

  it('leaves the lineage alone when the payload does not touch manufacturers', async () => {
    await approveEditSubmission('e1', editSubmission)
    expect(lineageUpsert).not.toHaveBeenCalled()
    expect(lineageDeleteIn).not.toHaveBeenCalled()
  })

  it('creates proposed manufacturers on edit approval', async () => {
    const manuInsertSingle = vi.fn()
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'coasters') {
        return {
          update: vi.fn().mockReturnValue({ eq: coasterUpdateEq }),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'manufacturers') {
        return {
          select: vi.fn().mockReturnValue({
            eq: () => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) }),
          }),
          insert: () => ({ select: () => ({ single: manuInsertSingle }) }),
        } as unknown as ReturnType<typeof supabase.from>
      }
      if (table === 'coaster_manufacturers') {
        return {
          select: () => ({ eq: () => ({ range: lineageRange }) }),
          delete: () => ({ eq: () => ({ in: lineageDeleteIn }) }),
          upsert: lineageUpsert,
        } as unknown as ReturnType<typeof supabase.from>
      }
      return { update: () => ({ eq: submissionUpdateEq }) } as unknown as ReturnType<
        typeof supabase.from
      >
    }) as never)
    coasterUpdateEq.mockResolvedValue({ error: null })
    manuInsertSingle.mockResolvedValue({
      data: { id: '77777777-6666-4555-8444-333333333333' },
      error: null,
    })
    await approveEditSubmission('e1', {
      ...editSubmission,
      suggested_fields: { proposed_manufacturers: [{ name: 'Gerstlauer', position: 0 }] },
    } as unknown as CoasterSubmission)
    expect(lineageUpsert).toHaveBeenCalledWith(
      [
        {
          coaster_id: 'c1',
          manufacturer_id: '77777777-6666-4555-8444-333333333333',
          position: 0,
          source: 'submission',
        },
      ],
      { onConflict: 'coaster_id,manufacturer_id' },
    )
  })

  it('ignores malformed manufacturer ids instead of applying them', async () => {
    await approveEditSubmission('e1', {
      ...editSubmission,
      suggested_fields: { manufacturer_id: 'garbage' },
    } as unknown as CoasterSubmission)
    const bad = vi.mocked(supabase.from).mock.results[0].value as {
      update: ReturnType<typeof vi.fn>
    }
    expect(bad.update.mock.calls[0][0]).not.toHaveProperty('manufacturer_id')
    expect(lineageUpsert).not.toHaveBeenCalled()
    expect(lineageDeleteIn).not.toHaveBeenCalled()
  })

  it('refuses edits without a target coaster', async () => {
    await expect(
      approveEditSubmission('e1', { ...editSubmission, coaster_id: null }),
    ).rejects.toThrow('missing its coaster')
    expect(coasterUpdateEq).not.toHaveBeenCalled()
  })
})
