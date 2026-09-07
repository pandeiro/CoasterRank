import { describe, it, expect, vi, beforeEach } from 'vitest'
import { applyImport, computePromotedIds, logImportEvent } from './apply'
import { supabase } from '../supabase'
import { makeUserRide } from '../../test/fixtures'

vi.mock('../supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(supabase.rpc).mockResolvedValue({ data: 3, error: null } as never)
})

describe('applyImport', () => {
  it('passes the full final list through the RPC contract', async () => {
    await applyImport({
      orderedIds: ['a', 'b'],
      replace: false,
      source: 'paste',
      stats: { auto_matched: 2 },
    })
    expect(supabase.rpc).toHaveBeenCalledWith('apply_imported_rides', {
      p_rides: ['a', 'b'],
      p_replace: false,
      p_source: 'paste',
      p_stats: { auto_matched: 2, unmatched_names: [] },
      p_unrank_ids: [],
    })
  })

  it('threads unrankIds for the undo path', async () => {
    await applyImport({
      orderedIds: ['a'],
      replace: true,
      source: 'csv',
      stats: {},
      unrankIds: ['x', 'y'],
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'apply_imported_rides',
      expect.objectContaining({ p_unrank_ids: ['x', 'y'], p_replace: true }),
    )
  })

  it('returns the ranked count from the RPC', async () => {
    const count = await applyImport({
      orderedIds: ['a'],
      replace: false,
      source: 'csv',
      stats: {},
    })
    expect(count).toBe(3)
  })
  it('throws on RPC error', async () => {
    vi.mocked(supabase.rpc).mockRejectedValue(new Error('boom'))
    await expect(
      applyImport({ orderedIds: [], replace: true, source: 'csv', stats: {} }),
    ).rejects.toThrow('boom')
  })
})

describe('computePromotedIds', () => {
  it('returns prior-unranked rows that the import ranked', () => {
    const prior = [
      makeUserRide({ coaster_id: 'ranked-1', rank: 1 }),
      makeUserRide({ coaster_id: 'pen-1', rank: null }),
      makeUserRide({ coaster_id: 'pen-2', rank: null }),
    ]
    expect(computePromotedIds(prior, ['pen-1', 'ranked-1', 'new-1'])).toEqual(['pen-1'])
  })

  it('is empty when nothing was promoted', () => {
    const prior = [makeUserRide({ coaster_id: 'ranked-1', rank: 1 })]
    expect(computePromotedIds(prior, ['new-1'])).toEqual([])
    expect(computePromotedIds([], ['new-1'])).toEqual([])
  })
})

describe('logImportEvent', () => {
  it('inserts into import_events with defaults', async () => {
    await logImportEvent('parsed', 'csv', { rowsTotal: 5, stats: { auto_matched: 3 } })
    expect(supabase.from).toHaveBeenCalledWith('import_events')
  })

  it('never throws when the insert fails', async () => {
    vi.mocked(supabase.from).mockReturnValue({
      insert: vi.fn(() => Promise.reject(new Error('offline'))),
    } as never)
    await expect(logImportEvent('undo', 'csv', {})).resolves.toBeUndefined()
  })
})
