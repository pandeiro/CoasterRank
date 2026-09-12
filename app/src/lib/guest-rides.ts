import { useSyncExternalStore } from 'react'
import type { RankingRow } from './board-types'
import type { UserRide } from './rides'

// GUEST_UX.md Part II §2: the guest "Mark & Rank" engine. All state is
// client-side (localStorage) — no anonymous writes ever reach Supabase.

export const GUEST_RIDES_STORAGE_KEY = 'cr.guest-rides.v1'
/**
 * Guest list cap (GUEST_UX.md §2.2). Keeps the signup-metadata payload far
 * below GoTrue's undocumented raw_user_meta_data limits (supabase/auth#1776).
 */
export const GUEST_RIDES_CAP = 100

export interface GuestRideItem {
  coaster_id: string
  name: string
  slug: string
  // Snapshot fields: /rank must render without a network re-query, and the UI
  // must survive catalog drift between mark-time and rank-time (§2.2).
  park_id: string | null
  park_slug: string | null
  park_name: string | null
  park_country: string | null
  manufacturer_name: string | null
  material: string
  status: string
  /** Global board rank at mark time — seeds the initial list order. */
  board_rank: number | null
  added_at: number
}

export interface GuestRankingState {
  version: 1
  /** Ordered list of coaster IDs representing the user's custom ranking. */
  orderedIds: string[]
  /** Snapshot dictionary so cards render without re-querying the network. */
  items: Record<string, GuestRideItem>
  /**
   * Order lifecycle (GUEST_UX.md §3.3.5): while false, newly marked coasters
   * are seeded into board-rank position. The first /rank visit (or any drag)
   * locks the order; after that, new marks append to the bottom and manual
   * positioning is never re-sorted away.
   */
  orderLocked: boolean
  /** Epoch ms when mark mode was first engaged (sent as ISO at promotion). */
  createdAt: number
  /** Epoch ms of the most recent edit. */
  updatedAt: number
}

// ── Pure operations (all return new state objects; safe to test in isolation)

export function emptyGuestRanking(now: number): GuestRankingState {
  return {
    version: 1,
    orderedIds: [],
    items: {},
    orderLocked: false,
    createdAt: now,
    updatedAt: now,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseGuestItem(value: unknown): GuestRideItem | null {
  if (!isRecord(value)) return null
  if (typeof value.coaster_id !== 'string' || typeof value.name !== 'string') return null
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  return {
    coaster_id: value.coaster_id,
    name: value.name,
    slug: str(value.slug) ?? value.coaster_id,
    park_id: str(value.park_id),
    park_slug: str(value.park_slug),
    park_name: str(value.park_name),
    park_country: str(value.park_country),
    manufacturer_name: str(value.manufacturer_name),
    material: str(value.material) ?? 'unknown',
    status: str(value.status) ?? 'unknown',
    board_rank: num(value.board_rank),
    added_at: num(value.added_at) ?? 0,
  }
}

function defaultStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/**
 * Reads and sanitizes guest state. Corrupt JSON, wrong versions, dangling
 * ordered IDs (no snapshot), stray snapshots, and duplicate IDs all degrade
 * gracefully instead of crashing the UI (catalog-drift resilience, §2.2).
 */
export function readGuestRanking(
  storage: Storage | null = defaultStorage(),
): GuestRankingState | null {
  let raw: string | null = null
  try {
    raw = storage?.getItem(GUEST_RIDES_STORAGE_KEY) ?? null
  } catch {
    return null
  }
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isRecord(parsed) || parsed.version !== 1) return null
  const rawItems = isRecord(parsed.items) ? parsed.items : {}
  const items: Record<string, GuestRideItem> = {}
  for (const [key, value] of Object.entries(rawItems)) {
    const item = parseGuestItem(value)
    if (item) items[key] = item
  }
  const seen = new Set<string>()
  const orderedIds: string[] = []
  for (const id of Array.isArray(parsed.orderedIds) ? parsed.orderedIds : []) {
    if (typeof id !== 'string' || seen.has(id) || !items[id]) continue
    seen.add(id)
    orderedIds.push(id)
  }
  for (const key of Object.keys(items)) {
    if (!seen.has(key)) delete items[key]
  }
  if (orderedIds.length === 0) return null
  const now = Date.now()
  return {
    version: 1,
    orderedIds,
    items,
    orderLocked: parsed.orderLocked === true,
    createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : now,
    updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : now,
  }
}

export function writeGuestRanking(
  state: GuestRankingState,
  storage: Storage | null = defaultStorage(),
): boolean {
  try {
    storage?.setItem(GUEST_RIDES_STORAGE_KEY, JSON.stringify(state))
    return true
  } catch {
    return false
  }
}

export function clearGuestRanking(storage: Storage | null = defaultStorage()): void {
  try {
    storage?.removeItem(GUEST_RIDES_STORAGE_KEY)
  } catch {
    // Storage unavailable (private mode, quota): nothing to clean up.
  }
}

/**
 * Seed position (§3.3.5 Phase 1): after every already-ranked item with an
 * equal-or-smaller board rank. Unranked marks (not on the board) always
 * append at the very end, in chronological order.
 */
function seedPosition(state: GuestRankingState, boardRank: number | null): number {
  if (boardRank === null) return state.orderedIds.length
  let position = 0
  for (const id of state.orderedIds) {
    const rank = state.items[id]?.board_rank
    if (rank === null || rank === undefined) continue
    if (rank < boardRank) position += 1
  }
  return position
}

export type AddGuestRideResult = { state: GuestRankingState; added: boolean; capped: boolean }

/**
 * Idempotent add (§2.2): adding an already-selected coaster is a no-op; the
 * cap never truncates existing selections — it refuses new ones with a flag
 * so the UI can explain (§2.2 Cap Overflow UX).
 */
export function addGuestRide(
  state: GuestRankingState,
  item: GuestRideItem,
  now: number,
): AddGuestRideResult {
  if (state.orderedIds.includes(item.coaster_id)) return { state, added: false, capped: false }
  if (state.orderedIds.length >= GUEST_RIDES_CAP) return { state, added: false, capped: true }
  const position = state.orderLocked
    ? state.orderedIds.length
    : seedPosition(state, item.board_rank)
  const orderedIds = [
    ...state.orderedIds.slice(0, position),
    item.coaster_id,
    ...state.orderedIds.slice(position),
  ]
  return {
    state: {
      ...state,
      orderedIds,
      items: { ...state.items, [item.coaster_id]: item },
      updatedAt: now,
    },
    added: true,
    capped: false,
  }
}

export function removeGuestRide(
  state: GuestRankingState,
  coasterId: string,
  now: number,
): GuestRankingState {
  if (!state.orderedIds.includes(coasterId)) return state
  const items = { ...state.items }
  delete items[coasterId]
  return {
    ...state,
    orderedIds: state.orderedIds.filter((id) => id !== coasterId),
    items,
    updatedAt: now,
  }
}

/** Drag reorder: persists the user's manual order and locks it (§3.3.5). */
export function reorderGuestRides(
  state: GuestRankingState,
  orderedIds: string[],
  now: number,
): GuestRankingState {
  const known = orderedIds.filter((id) => Boolean(state.items[id]))
  const missing = state.orderedIds.filter((id) => !known.includes(id))
  return { ...state, orderedIds: [...known, ...missing], orderLocked: true, updatedAt: now }
}

/** Visiting the workbench locks the order even before the first drag (§3.3.5). */
export function lockGuestOrder(state: GuestRankingState, now: number): GuestRankingState {
  if (state.orderLocked) return state
  return { ...state, orderLocked: true, updatedAt: now }
}

export function guestItemFromRankingRow(row: RankingRow, now: number): GuestRideItem {
  return {
    coaster_id: row.id,
    name: row.name,
    slug: row.slug,
    park_id: row.park_id,
    park_slug: row.park_slug,
    park_name: row.park_name,
    park_country: row.park_country,
    manufacturer_name: row.manufacturer_name,
    material: row.material,
    status: row.status,
    board_rank: row.rank,
    added_at: now,
  }
}

/** Maps the guest list onto the shape RankedCoasterList renders for /me. */
export function userRidesFromGuestState(state: GuestRankingState): UserRide[] {
  return state.orderedIds.map((coasterId, index) => {
    const item = state.items[coasterId]
    return {
      coaster_id: coasterId,
      rank: index + 1,
      coaster: {
        id: coasterId,
        name: item?.name ?? 'Coaster',
        slug: item?.slug ?? coasterId,
        status: item?.status ?? 'unknown',
        material: item?.material ?? 'unknown',
        park_id: item?.park_id ?? '',
        manufacturer_name: item?.manufacturer_name ?? null,
        park_name: item?.park_name ?? null,
        park_country: item?.park_country ?? null,
      },
    }
  })
}

// ── Module store (module state + localStorage mirror; no provider plumbing —
// the store survives route changes and needs no React context).

type GuestRidesStore = {
  state: GuestRankingState | null
  markMode: boolean
}

function initialStore(): GuestRidesStore {
  return { state: readGuestRanking(), markMode: false }
}

let store: GuestRidesStore = initialStore()
const listeners = new Set<() => void>()

function setStore(next: GuestRidesStore) {
  store = next
  for (const listener of listeners) listener()
}

function setState(state: GuestRankingState | null) {
  if (state) writeGuestRanking(state)
  else clearGuestRanking()
  setStore({ ...store, state })
}

export function subscribeGuestRides(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getGuestRidesSnapshot(): GuestRidesStore {
  return store
}

export type GuestToggleResult = 'added' | 'removed' | 'capped'

export function toggleGuestRide(row: RankingRow): GuestToggleResult {
  const current = store.state
  const now = Date.now()
  if (current?.orderedIds.includes(row.id)) {
    const next = removeGuestRide(current, row.id, now)
    setState(next.orderedIds.length > 0 ? next : null)
    return 'removed'
  }
  const base = current ?? emptyGuestRanking(now)
  const { state: next, capped } = addGuestRide(base, guestItemFromRankingRow(row, now), now)
  if (capped) return 'capped'
  setState(next)
  return 'added'
}

export function clearGuestRides(): void {
  if (store.state) setState(null)
}

export function reorderGuestRideList(orderedIds: string[]): void {
  const current = store.state
  if (!current) return
  setState(reorderGuestRides(current, orderedIds, Date.now()))
}

export function removeGuestRideById(coasterId: string): void {
  const current = store.state
  if (!current) return
  const next = removeGuestRide(current, coasterId, Date.now())
  setState(next.orderedIds.length > 0 ? next : null)
}

export function lockGuestOrderOnWorkbenchVisit(): void {
  const current = store.state
  if (!current) return
  setState(lockGuestOrder(current, Date.now()))
}

export function enterGuestMarkMode(): void {
  if (!store.markMode) setStore({ ...store, markMode: true })
}

export function exitGuestMarkMode(): void {
  if (store.markMode) setStore({ ...store, markMode: false })
}

/** Drops the selection but keeps Mark Mode active (the dock's soft reset). */
export function resetGuestSelection(): void {
  clearGuestRides()
}

// ── React binding

export type GuestRides = {
  state: GuestRankingState | null
  markMode: boolean
  /** Convenience count (0 when the state is absent). */
  count: number
  /** Selection as a Set, for CoasterTable's selectedIds prop. */
  selectedIds: Set<string>
}

export function useGuestRides(): GuestRides {
  const snapshot = useSyncExternalStore(subscribeGuestRides, getGuestRidesSnapshot)
  const state = snapshot.state
  return {
    state,
    markMode: snapshot.markMode,
    count: state?.orderedIds.length ?? 0,
    selectedIds: new Set(state?.orderedIds ?? []),
  }
}
