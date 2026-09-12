import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RankingRow } from '../lib/coasters'
import { makeRankingRow } from '../test/fixtures'
import {
  GUEST_RIDES_CAP,
  addGuestRide,
  clearGuestRanking,
  emptyGuestRanking,
  guestItemFromRankingRow,
  lockGuestOrder,
  readGuestRanking,
  reorderGuestRides,
  removeGuestRide,
  userRidesFromGuestState,
  writeGuestRanking,
  type GuestRankingState,
} from './guest-rides'

// Store-level API (module singleton + localStorage): reset before each test.
import {
  clearGuestRides,
  enterGuestMarkMode,
  exitGuestMarkMode,
  getGuestRidesSnapshot,
  lockGuestOrderOnWorkbenchVisit,
  reorderGuestRideList,
  toggleGuestRide,
} from './guest-rides'

function row(overrides: Partial<Parameters<typeof makeRankingRow>[0]> = {}): RankingRow {
  return makeRankingRow({ name: 'Coaster', slug: 'coaster', ...overrides })
}

/** Builds a state with the given (name, board_rank) pairs, in array order. */
function stateWith(rides: [string, number | null][]): GuestRankingState {
  const now = 1_000
  let state = emptyGuestRanking(now)
  rides.forEach(([name, rank], i) => {
    const item = guestItemFromRankingRow(
      row({ id: `c${i}`, name, rank, slug: name.toLowerCase() }),
      now,
    )
    state = addGuestRide(state, item, now).state
  })
  return state
}

function names(state: GuestRankingState): string[] {
  return state.orderedIds.map((id) => state.items[id].name)
}

describe('guest ride operations (GUEST_UX.md §2)', () => {
  it('seeds new marks into board-rank position while unlocked', () => {
    const state = stateWith([
      ['Fury 325', 5],
      ['Iron Menace', 1],
    ])
    const item = guestItemFromRankingRow(row({ id: 'c9', name: 'Wildcat', rank: 3 }), 2)
    const { state: next, added } = addGuestRide(state, item, 2)
    expect(added).toBe(true)
    expect(names(next)).toEqual(['Iron Menace', 'Wildcat', 'Fury 325'])
  })

  it('trails unranked marks behind ranked ones while seeding', () => {
    const state = stateWith([
      ['Unrated A', null],
      ['Ranked B', 2],
    ])
    // A ranked mark lands before the unranked tail…
    const ranked = addGuestRide(
      state,
      guestItemFromRankingRow(row({ id: 'c9', name: 'Ranked C', rank: 7 }), 2),
      2,
    ).state
    expect(names(ranked)).toEqual(['Ranked B', 'Ranked C', 'Unrated A'])
    // …and a second unranked mark keeps appending after the tail.
    const unranked = addGuestRide(
      ranked,
      guestItemFromRankingRow(row({ id: 'c8', name: 'Unrated D', rank: null }), 3),
      3,
    ).state
    expect(names(unranked)).toEqual(['Ranked B', 'Ranked C', 'Unrated A', 'Unrated D'])
  })

  it('appends to the bottom once the order is locked (§3.3.5 Phase 2)', () => {
    const base = stateWith([
      ['Velocicoaster', 1],
      ['Fury 325', 5],
    ])
    const locked = lockGuestOrder(base, 2)
    expect(locked.orderLocked).toBe(true)
    const next = addGuestRide(
      locked,
      guestItemFromRankingRow(row({ id: 'c9', name: 'Iron Menace', rank: 2 }), 3),
      3,
    ).state
    // Board rank says #2; the lock says append. The lock wins.
    expect(names(next)).toEqual(['Velocicoaster', 'Fury 325', 'Iron Menace'])
  })

  it('is idempotent for already-selected coasters', () => {
    const state = stateWith([['Fury 325', 1]])
    const item = guestItemFromRankingRow(row({ id: 'c0', name: 'Fury 325', rank: 1 }), 2)
    const { state: next, added } = addGuestRide(state, item, 2)
    expect(added).toBe(false)
    expect(next).toBe(state)
  })

  it('refuses marks beyond the cap without touching the list (§2.2)', () => {
    const now = 1_000
    let state = emptyGuestRanking(now)
    for (let i = 0; i < GUEST_RIDES_CAP; i += 1) {
      state = addGuestRide(
        state,
        guestItemFromRankingRow(row({ id: `c${i}`, name: `Coaster ${i}`, rank: i + 1 }), now),
        now,
      ).state
    }
    expect(state.orderedIds).toHaveLength(GUEST_RIDES_CAP)
    const {
      state: next,
      added,
      capped,
    } = addGuestRide(
      state,
      guestItemFromRankingRow(row({ id: 'overflow', name: 'Overflow', rank: 999 }), now),
      now,
    )
    expect(capped).toBe(true)
    expect(added).toBe(false)
    expect(next).toBe(state)
  })

  it('removes a coaster from both the order and the snapshot', () => {
    const state = stateWith([
      ['Fury 325', 1],
      ['Iron Menace', 2],
    ])
    const next = removeGuestRide(state, 'c0', 2)
    expect(names(next)).toEqual(['Iron Menace'])
    expect(next.items['c0']).toBeUndefined()
    expect(removeGuestRide(state, 'missing', 2)).toBe(state)
  })

  it('persists a drag order and locks it (§3.3.5)', () => {
    const state = stateWith([
      ['Fury 325', 1],
      ['Iron Menace', 2],
      ['Wildcat', 3],
    ])
    const next = reorderGuestRides(state, ['c2', 'c0', 'c1'], 2)
    expect(names(next)).toEqual(['Wildcat', 'Fury 325', 'Iron Menace'])
    expect(next.orderLocked).toBe(true)
    // Unknown payload ids are dropped defensively, but current list items are
    // never silently removed (the coverage-guard principle, client-side).
    expect(names(reorderGuestRides(state, ['c2', 'ghost'], 2))).toEqual([
      'Wildcat',
      'Fury 325',
      'Iron Menace',
    ])
  })

  it('maps the guest list onto the /me ride shape with gapless ranks', () => {
    const state = stateWith([
      ['Fury 325', 3],
      ['Iron Menace', 1],
    ])
    // Seeding put Iron Menace (board #1) first; the list order is the rank.
    const rides = userRidesFromGuestState(state)
    expect(rides.map((r) => [r.coaster.name, r.rank])).toEqual([
      ['Iron Menace', 1],
      ['Fury 325', 2],
    ])
    expect(rides[0].coaster.park_name).toBe('Test Park')
  })
})

describe('guest state persistence (GUEST_UX.md §2.2)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('round-trips through localStorage', () => {
    const state = stateWith([['Fury 325', 1]])
    expect(writeGuestRanking(state)).toBe(true)
    expect(readGuestRanking()?.orderedIds).toEqual(state.orderedIds)
    clearGuestRanking()
    expect(readGuestRanking()).toBeNull()
  })

  it('returns null for corrupt JSON, wrong versions, and missing keys', () => {
    window.localStorage.setItem('cr.guest-rides.v1', 'not-json{')
    expect(readGuestRanking()).toBeNull()
    window.localStorage.setItem('cr.guest-rides.v1', JSON.stringify({ version: 2 }))
    expect(readGuestRanking()).toBeNull()
    expect(readGuestRanking()).toBeNull() // absent key stays null
  })

  it('drops dangling ordered ids and stray snapshots', () => {
    const state = stateWith([
      ['Fury 325', 1],
      ['Iron Menace', 2],
    ])
    const corrupt: GuestRankingState = {
      ...state,
      orderedIds: ['c0', 'ghost', 'c0'],
      items: { ...state.items, stray: state.items['c0'] },
    }
    writeGuestRanking(corrupt)
    const read = readGuestRanking()
    expect(read?.orderedIds).toEqual(['c0'])
    expect(Object.keys(read?.items ?? {})).toEqual(['c0'])
  })
})

describe('guest store (toggle + mark mode)', () => {
  beforeEach(() => {
    window.localStorage.clear()
    clearGuestRides()
    exitGuestMarkMode()
  })

  afterEach(() => {
    clearGuestRides()
    exitGuestMarkMode()
  })

  it('toggles marks on and off through the store', () => {
    expect(toggleGuestRide(row({ id: 'a', name: 'Fury 325', rank: 1 }))).toBe('added')
    expect(getGuestRidesSnapshot().state?.orderedIds).toEqual(['a'])
    expect(toggleGuestRide(row({ id: 'a', name: 'Fury 325', rank: 1 }))).toBe('removed')
    // The last removal tears the state down entirely (no empty file behind).
    expect(getGuestRidesSnapshot().state).toBeNull()
    expect(readGuestRanking()).toBeNull()
  })

  it('seeds while unlocked, then appends after the workbench locks the order', () => {
    // Phase 1 (seed): board-rank insertion through the store actions.
    toggleGuestRide(row({ id: 'a', name: 'Fury 325', rank: 5 }))
    toggleGuestRide(row({ id: 'b', name: 'Iron Menace', rank: 1 }))
    expect(getGuestRidesSnapshot().state?.orderedIds).toEqual(['b', 'a'])
    // Phase 2 (lock): the /rank visit trip-wire, then a new mark appends.
    toggleGuestRide(row({ id: 'c', name: 'Wildcat', rank: 3 }))
    lockGuestOrderOnWorkbenchVisit()
    toggleGuestRide(row({ id: 'd', name: 'Pantherian', rank: 2 }))
    expect(getGuestRidesSnapshot().state?.orderedIds).toEqual(['b', 'c', 'a', 'd'])
    expect(getGuestRidesSnapshot().state?.orderLocked).toBe(true)
  })

  it('persists drags through the store (adapter save path)', () => {
    toggleGuestRide(row({ id: 'a', name: 'Fury 325', rank: 1 }))
    toggleGuestRide(row({ id: 'b', name: 'Iron Menace', rank: 2 }))
    reorderGuestRideList(['b', 'a'])
    expect(getGuestRidesSnapshot().state?.orderedIds).toEqual(['b', 'a'])
    expect(getGuestRidesSnapshot().state?.orderLocked).toBe(true)
    expect(readGuestRanking()?.orderedIds).toEqual(['b', 'a'])
  })

  it('keeps mark mode out of persistence and toggles it cleanly', () => {
    enterGuestMarkMode()
    expect(getGuestRidesSnapshot().markMode).toBe(true)
    exitGuestMarkMode()
    expect(getGuestRidesSnapshot().markMode).toBe(false)
    // Mark mode is session state — it never lands in localStorage.
    expect(window.localStorage.getItem('cr.guest-rides.v1')).toBeNull()
  })
})
