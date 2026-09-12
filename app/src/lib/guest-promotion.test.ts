import { beforeEach, describe, expect, it, vi } from 'vitest'
import { supabase } from './supabase'
import {
  buildPendingGuestPayload,
  buildSignupMetadata,
  isGuestStaleError,
  materializeGuestRides,
  readPendingGuestPayload,
  wipePendingGuestPayload,
  GUEST_STALE_ERRCODE,
} from './guest-promotion'
import { clearGuestRides } from './guest-rides'

vi.mock('./supabase', () => ({
  supabase: {
    auth: { updateUser: vi.fn() },
    rpc: vi.fn(),
    from: vi.fn(),
  },
}))

describe('pending guest payload (GUEST_UX.md §4.1)', () => {
  it('serializes started_at as an ISO string, never a raw epoch', () => {
    const payload = buildPendingGuestPayload({
      version: 1,
      orderedIds: ['a', 'b'],
      items: {},
      orderLocked: true,
      createdAt: 1_757_600_000_000,
      updatedAt: 1_757_600_000_000,
    })
    expect(payload.ids).toEqual(['a', 'b'])
    expect(payload.started_at).toBe(new Date(1_757_600_000_000).toISOString())
    expect(Number.isNaN(Date.parse(payload.started_at ?? ''))).toBe(false)
    expect(typeof payload.started_at).toBe('string')
  })

  it('builds the exact signup metadata shape', () => {
    const state = {
      version: 1 as const,
      orderedIds: ['a'],
      items: {},
      orderLocked: false,
      createdAt: 0,
      updatedAt: 0,
    }
    expect(buildSignupMetadata(state).pending_guest_rides.ids).toEqual(['a'])
  })
})

describe('readPendingGuestPayload', () => {
  it('parses valid metadata and rejects malformed payloads', () => {
    const user = {
      user_metadata: {
        pending_guest_rides: { ids: ['a', 'b', 42], started_at: '2026-09-11T00:00:00.000Z' },
      },
    } as never
    expect(readPendingGuestPayload(user)?.ids).toEqual(['a', 'b'])
    expect(readPendingGuestPayload(null)).toBeNull()
    expect(
      readPendingGuestPayload({ user_metadata: { pending_guest_rides: { ids: [] } } } as never),
    ).toBeNull()
    expect(
      readPendingGuestPayload({ user_metadata: { pending_guest_rides: 'nope' } } as never),
    ).toBeNull()
    expect(readPendingGuestPayload({ user_metadata: {} } as never)).toBeNull()
  })
})

describe('isGuestStaleError', () => {
  it('matches the coverage-guard SQLSTATE only', () => {
    expect(isGuestStaleError({ code: GUEST_STALE_ERRCODE, message: 'stale' })).toBe(true)
    expect(isGuestStaleError({ code: '42501', message: 'nope' })).toBe(false)
    expect(isGuestStaleError(new Error('generic'))).toBe(false)
    expect(isGuestStaleError(null)).toBe(false)
  })
})

describe('rpc wrappers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearGuestRides()
  })

  it('materializeGuestRides passes the ladder and returns the saved count', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 3, error: null } as never)
    const count = await materializeGuestRides(['a', 'b', 'c'], 'merge_append', null)
    expect(count).toBe(3)
    expect(supabase.rpc).toHaveBeenCalledWith('materialize_guest_rides', {
      p_rides: ['a', 'b', 'c'],
      p_kind: 'merge_append',
      p_started_at: null,
    })
  })

  it('refuses oversized payloads client-side (RPC ceiling mirror)', async () => {
    const ids = Array.from({ length: 5001 }, (_, i) => `c${i}`)
    await expect(materializeGuestRides(ids, 'materialize', null)).rejects.toThrow(/too large/i)
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('surfaces RPC errors so callers can detect the stale errcode', async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { code: GUEST_STALE_ERRCODE, message: 'stale payload' },
    } as never)
    await expect(materializeGuestRides(['a'], 'materialize', null)).rejects.toMatchObject({
      code: GUEST_STALE_ERRCODE,
    })
  })

  it('wipePendingGuestPayload clears the metadata marker', async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: { user: {} },
      error: null,
    } as never)
    await wipePendingGuestPayload()
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      data: { pending_guest_rides: null },
    })
  })
})
