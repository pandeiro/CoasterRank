import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  approveSubmission,
  buildParkMap,
  countryOptions,
  DEFAULT_FILTERS,
  FEW_VOTES_THRESHOLD,
  filterCoasters,
  filtersFromSearchParams,
  filtersToSearchParams,
  firstPlaceLabel,
  firstPlaceVisibleIds,
  FIRST_PLACE_MIN_USERS,
  FIRST_PLACE_TOP_N,
  isFewVotes,
  capitalize,
  manufacturerOptions,
  slugify,
  yearFromDate,
  type CoasterSubmission,
} from './coasters'
import { supabase } from './supabase'
import { makePark, makeRankingRow } from '../test/fixtures'

vi.mock('./supabase', () => ({
  supabase: {
    auth: { getUser: vi.fn() },
    from: vi.fn(),
  },
}))

describe('filtersFromSearchParams', () => {
  it('defaults to operating-only, everything material with no params (clean URL)', () => {
    expect(filtersFromSearchParams(new URLSearchParams(''))).toEqual({
      allStatuses: false,
      materialView: 'everything',
    })
  })

  it('parses all filter pairs', () => {
    const params = new URLSearchParams(
      'q=cobra&country=United States&manufacturer=Intamin&material=steel&status=all',
    )
    expect(filtersFromSearchParams(params)).toEqual({
      q: 'cobra',
      country: 'United States',
      manufacturer: 'Intamin',
      materialView: 'steel',
      allStatuses: true,
    })
  })

  it('treats status=all as all statuses', () => {
    expect(filtersFromSearchParams(new URLSearchParams('status=all')).allStatuses).toBe(true)
  })

  it('falls back to the operating-only default for legacy specific statuses', () => {
    expect(filtersFromSearchParams(new URLSearchParams('status=defunct')).allStatuses).toBe(false)
    expect(filtersFromSearchParams(new URLSearchParams('status=bogus')).allStatuses).toBe(false)
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
      allStatuses: true,
      materialView: 'wood',
    })
    expect(params.toString()).toBe('q=cobra&status=all&material=wood&country=United+States')
  })

  it('round-trips through filtersFromSearchParams', () => {
    const filters = {
      ...DEFAULT_FILTERS,
      q: 'ghost',
      materialView: 'wood' as const,
      allStatuses: true,
    }
    expect(filtersFromSearchParams(filtersToSearchParams(filters))).toEqual(filters)
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

  it('defaults to operating only', () => {
    expect(filterCoasters(rows, DEFAULT_FILTERS).map((r) => r.slug)).toEqual([
      'steel-vengeance',
      'wicker-man',
      'iron-gwazi',
    ])
  })

  it('keeps every status for allStatuses', () => {
    expect(filterCoasters(rows, { ...DEFAULT_FILTERS, allStatuses: true })).toHaveLength(4)
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

describe('approveSubmission', () => {
  const insertSingle = vi.fn()
  const coasterInsert = vi.fn()
  const submissionUpdateEq = vi.fn()

  const submission = {
    id: 's1',
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

  const makeParkSelectMock = (slug: string | null = 'test-park') =>
    ({
      eq: () => ({
        maybeSingle: vi.fn().mockResolvedValue({ data: slug ? { slug } : null, error: null }),
      }),
    }) as unknown

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(supabase.auth.getUser).mockResolvedValue({ data: { user: { id: 'u1' } } } as never)
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'parks') {
        const insertMock = { insert: () => ({ select: () => ({ single: insertSingle }) }) }
        // select used by resolveUniqueCoasterSlug
        return Object.assign(() => insertMock, {
          insert: insertMock.insert,
          select: vi.fn().mockReturnValue(makeParkSelectMock()),
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
      return { update: () => ({ eq: submissionUpdateEq }) } as unknown as ReturnType<
        typeof supabase.from
      >
    }) as never)
    insertSingle.mockResolvedValue({ data: { id: 'p9' }, error: null })
    coasterInsert.mockResolvedValue({ error: null })
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

  it('maps a park slug collision to a friendly error', async () => {
    insertSingle.mockResolvedValue({
      data: null,
      error: { code: '23505', message: 'duplicate key' },
    })
    await expect(approveSubmission('s1', submission)).rejects.toThrow(
      'A park named "Test Park" already exists.',
    )
    expect(coasterInsert).not.toHaveBeenCalled()
  })

  it('retries with park-suffixed slug on global coaster collision then succeeds', async () => {
    // first insert claims slug, second succeeds with park suffix
    coasterInsert
      .mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } })
      .mockResolvedValueOnce({ error: null })
    // make the global slug check see existing base slug
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'parks') {
        const sel = vi.fn().mockReturnValue(makeParkSelectMock('test-park'))
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
    coasterInsert.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    await expect(approveSubmission('s1', submission)).rejects.toThrow(/already exists \(slug/)
    expect(submissionUpdateEq).not.toHaveBeenCalled()
  })

  it('skips park creation when the submission already has a park', async () => {
    await approveSubmission('s1', { ...submission, park_id: 'p1' })
    expect(insertSingle).not.toHaveBeenCalled()
    expect(coasterInsert).toHaveBeenCalledWith(expect.objectContaining({ park_id: 'p1' }))
  })
})
