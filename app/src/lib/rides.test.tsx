import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { insertIdAt, renumberRanks, useMyRides } from './rides'
import { supabase } from './supabase'
import { useAuth } from './auth-context'

vi.mock('./supabase', () => ({
  supabase: {
    from: vi.fn(),
  },
}))

vi.mock('./auth-context', () => ({
  useAuth: vi.fn(),
}))

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

describe('useMyRides', () => {
  const order = vi.fn()
  const select = vi.fn()

  function mockQuery(result: { data: unknown; error: unknown }) {
    order.mockResolvedValue(result)
    select.mockReturnValue({ order })
    vi.mocked(supabase.from).mockReturnValue({ select } as never)
  }

  function renderMyRides() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return renderHook(() => useMyRides(), {
      wrapper: ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>,
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({ user: { id: 'u1' } } as never)
  })

  it('does not select view-only columns (score/comparisons) from the coasters table', async () => {
    // Blocker 1 (issue #91): score/comparisons exist only on v_coaster_rankings;
    // selecting them on the coasters embed makes prod PostgREST reject with 42703.
    mockQuery({ data: [], error: null })
    const { result } = renderMyRides()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(select).toHaveBeenCalledWith(
      'coaster_id, rank, coasters(id, name, slug, status, material, park_id, manufacturers(name), parks(country))',
    )
    expect(select).not.toHaveBeenCalledWith(expect.stringContaining('score'))
    expect(select).not.toHaveBeenCalledWith(expect.stringContaining('comparisons'))
  })

  it('maps a PostgREST object-shaped embed onto coaster (regression: park_id crash)', async () => {
    // Blocker 2 (issue #91): many-to-one embeds arrive as an object, not an
    // array — the old row.coasters[0] produced undefined and crashed /me.
    const payload = {
      data: [
        {
          coaster_id: 'c1',
          rank: 1,
          coasters: {
            id: 'c1',
            name: 'Steel Vengeance',
            slug: 'steel-vengeance',
            status: 'operating',
            material: 'steel',
            park_id: 'p1',
            manufacturers: { name: 'RMC' },
            parks: { country: 'United States' },
          },
        },
        {
          coaster_id: 'c2',
          rank: null,
          coasters: {
            id: 'c2',
            name: 'Fury 325',
            slug: 'fury-325',
            status: 'operating',
            material: 'steel',
            park_id: 'p2',
            manufacturers: { name: 'B&M' },
            parks: { country: 'United States' },
          },
        },
      ],
      error: null,
    }
    mockQuery(payload)
    const { result } = renderMyRides()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      {
        coaster_id: 'c1',
        rank: 1,
        coaster: {
          id: 'c1',
          name: 'Steel Vengeance',
          slug: 'steel-vengeance',
          status: 'operating',
          material: 'steel',
          park_id: 'p1',
          manufacturer_name: 'RMC',
          park_country: 'United States',
        },
      },
      {
        coaster_id: 'c2',
        rank: null,
        coaster: {
          id: 'c2',
          name: 'Fury 325',
          slug: 'fury-325',
          status: 'operating',
          material: 'steel',
          park_id: 'p2',
          manufacturer_name: 'B&M',
          park_country: 'United States',
        },
      },
    ])
  })

  it('still maps if an embed ever comes back array-shaped', async () => {
    const coaster = {
      id: 'c1',
      name: 'Wicker Man',
      slug: 'wicker-man',
      status: 'operating',
      material: 'wood',
      park_id: 'p1',
      manufacturers: { name: 'GCI' },
      parks: { country: 'United Kingdom' },
    }
    mockQuery({ data: [{ coaster_id: 'c1', rank: 1, coasters: [coaster] }], error: null })
    const { result } = renderMyRides()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual([
      {
        coaster_id: 'c1',
        rank: 1,
        coaster: {
          id: 'c1',
          name: 'Wicker Man',
          slug: 'wicker-man',
          status: 'operating',
          material: 'wood',
          park_id: 'p1',
          manufacturer_name: 'GCI',
          park_country: 'United Kingdom',
        },
      },
    ])
  })

  it('orders by rank ascending with nulls last', async () => {
    mockQuery({ data: [], error: null })
    const { result } = renderMyRides()
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(order).toHaveBeenCalledWith('rank', { ascending: true, nullsFirst: false })
  })
})
