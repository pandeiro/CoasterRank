import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus } from 'lucide-react'
import { useAllCoasters, useParks, buildParkMap, type RankingRow } from '../lib/coasters'
import { useMediaQuery } from '../lib/use-media-query'
import { useRemoveRide, useSaveRanks, renumberRanks, insertIdAt, type UserRide } from '../lib/rides'
import RankedCoasterItem, { TOUCH_DRAG_DELAY_MS } from './RankedCoasterItem'
import { MessageState } from './ui'

export type PendingAdd = { id: string; name: string }

/** How long a removed row can be undone before the server delete commits. */
export const REMOVE_UNDO_MS = 5000
/** How long the dissolve-out animation runs before the row stops rendering. */
const REMOVE_DISSOLVE_MS = 280

type Props = {
  rides: UserRide[]
  highlightId?: string | null
  pendingAdd?: PendingAdd | null
  /** Coarse pointers: selecting a coaster inserts it at the end immediately. */
  instantAdd?: boolean
  /** One-shot desktop shortcut: insert the pendingAdd at 'top'/'bottom'
   *  without scrolling to a divider. Cleared via onPendingClear. */
  quickInsert?: 'top' | 'bottom' | null
  onPendingClear?: () => void
  onInserted?: (coasterId: string, coasterName: string, rank: number) => void
  /** A row entered the undo window; `undo()` cancels the pending removal. */
  onRemoved?: (coasterName: string, undo: () => void) => void
  onError?: (message: string) => void
}

type ItemProps = Omit<
  React.ComponentProps<typeof RankedCoasterItem>,
  'style' | 'dragging' | 'handleProps' | 'itemRef'
>

type PendingRemoval = {
  /** Position in the ranked list, or null for unranked rows. */
  index: number | null
  ride: UserRide
  timer: ReturnType<typeof setTimeout>
  dissolved: boolean
}

// An optimistic stand-in for a ride the server hasn't echoed back yet, built
// from the board dataset the search row came from — so a newly inserted card
// renders in full instead of a "Saving…" stub until the refetch lands.
function syntheticRideFromRow(row: RankingRow): UserRide {
  return {
    coaster_id: row.id,
    rank: null,
    coaster: {
      id: row.id,
      name: row.name,
      slug: row.slug,
      status: row.status,
      material: row.material,
      park_id: row.park_id,
      manufacturer_name: row.manufacturer_name,
      park_country: row.park_country,
    },
  }
}

// Snappier settle than dnd-kit's default 200ms ease — governs row-shift
// animations and the drop settle alike (useSortable has no dropAnimation prop
// without a DragOverlay).
const sortableTransition = { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }

function SortableRankedCoasterItem(props: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.ride.coaster_id,
    transition: sortableTransition,
  })
  const touchDraggable = props.touchDraggable ?? false
  return (
    <RankedCoasterItem
      {...props}
      style={{
        transform: CSS.Transform.toString(transform),
        // While actively dragging, dnd-kit clears its inline transition — if we
        // let the element's CSS transition (transition-colors aside, any legacy
        // transition-all) win, every pointermove animates and the card lags
        // behind the cursor before snapping forward. Disable it outright.
        transition: isDragging ? 'none' : transition,
      }}
      dragging={isDragging}
      handleProps={
        touchDraggable
          ? (attributes as unknown as React.ComponentPropsWithoutRef<'button'>)
          : ({ ...attributes, ...listeners } as React.ComponentPropsWithoutRef<'button'>)
      }
      rowListeners={touchDraggable ? (listeners as React.HTMLAttributes<HTMLLIElement>) : undefined}
      itemRef={setNodeRef}
    />
  )
}

function dividerLabel(index: number, total: number): string {
  if (total === 0) return 'Add here'
  if (index === 0) return 'Add to top'
  if (index === total) return 'Add to bottom'
  return `Insert at #${index + 1}`
}

function InsertDivider({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex min-h-11 w-full items-center gap-2 rounded-lg py-2 text-sm font-medium text-muted transition-colors hover:bg-accent/5 hover:text-accent-strong sm:min-h-0 sm:py-1 sm:text-xs"
      >
        <span className="h-px flex-1 rounded bg-line group-hover:bg-accent" />
        <Plus className="h-3 w-3" />
        {label}
        <span className="h-px flex-1 rounded bg-line group-hover:bg-accent" />
      </button>
    </li>
  )
}

export default function RankedCoasterList({
  rides,
  highlightId,
  pendingAdd,
  instantAdd = false,
  quickInsert = null,
  onPendingClear,
  onInserted,
  onRemoved,
  onError,
}: Props) {
  const parks = useParks()
  const coasters = useAllCoasters()
  const parkMap = useMemo(() => buildParkMap(parks.data ?? []), [parks.data])
  const removeRide = useRemoveRide()
  const saveRanks = useSaveRanks()
  const isTouch = useMediaQuery('(pointer: coarse)')

  // Optimistic rides awaiting the server echo; real rides take precedence.
  const [pendingRides, setPendingRides] = useState<UserRide[]>([])
  // Rows in the remove-undo window: animating out, not yet deleted server-side.
  const [pendingRemovals, setPendingRemovals] = useState<Map<string, PendingRemoval>>(new Map())

  const ranked = useMemo(() => rides.filter((r) => r.rank !== null), [rides])
  const unranked = useMemo(() => rides.filter((r) => r.rank === null), [rides])
  const rankedIds = useMemo(() => ranked.map((r) => r.coaster_id), [ranked])
  const rideMap = useMemo(
    () => new Map([...pendingRides, ...rides].map((r) => [r.coaster_id, r])),
    [rides, pendingRides],
  )

  const [items, setItems] = useState<string[]>(rankedIds)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const pendingRemovalsRef = useRef(pendingRemovals)
  pendingRemovalsRef.current = pendingRemovals

  useEffect(() => {
    setItems(rankedIds)
  }, [rankedIds])

  // Drop stand-ins once the real rows arrive from the server.
  useEffect(() => {
    setPendingRides((prev) => {
      if (prev.length === 0) return prev
      const serverIds = new Set(rides.map((r) => r.coaster_id))
      const next = prev.filter((r) => !serverIds.has(r.coaster_id))
      return next.length === prev.length ? prev : next
    })
  }, [rides])

  // Clear undo timers if the page unloads mid-window.
  useEffect(
    () => () => {
      pendingRemovalsRef.current.forEach((entry) => clearTimeout(entry.timer))
    },
    [],
  )

  // Rows animating out stay mounted; once dissolved they stop rendering but
  // remain in `items` so an undo restores them with zero reshuffling.
  const visibleItems = useMemo(
    () =>
      items.filter((id) => {
        const entry = pendingRemovals.get(id)
        return !entry || !entry.dissolved
      }),
    [items, pendingRemovals],
  )
  const visibleUnranked = useMemo(
    () =>
      unranked.filter((r) => {
        const entry = pendingRemovals.get(r.coaster_id)
        return !entry || !entry.dissolved
      }),
    [unranked, pendingRemovals],
  )

  const sensors = useSensors(
    // Desktop: drag on 5px movement. Touch: long-press anywhere on the row
    // so vertical scrolling never fights the drag gesture. The delay must
    // match TOUCH_DRAG_DELAY_MS in RankedCoasterItem (its scroll guard).
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: TOUCH_DRAG_DELAY_MS, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const commitRanks = useCallback(
    (next: string[], snapshot: string[], failureMessage: string, onSuccess?: () => void) => {
      setItems(next)
      saveRanks.mutate(renumberRanks(next), {
        onSuccess: () => onSuccess?.(),
        onError: () => {
          setItems(snapshot)
          onError?.(failureMessage)
        },
      })
    },
    [saveRanks, onError],
  )

  const insertAt = useCallback(
    (coasterId: string, coasterName: string, index: number) => {
      if (items.includes(coasterId)) return
      if (!rideMap.has(coasterId)) {
        const row = (coasters.data ?? []).find((c) => c.id === coasterId)
        if (row) {
          setPendingRides((prev) =>
            prev.some((r) => r.coaster_id === coasterId)
              ? prev
              : [...prev, syntheticRideFromRow(row)],
          )
        }
      }
      commitRanks(
        insertIdAt(items, coasterId, index),
        items,
        `Couldn't add ${coasterName}. Please try again.`,
        () => onInserted?.(coasterId, coasterName, index + 1),
      )
    },
    [items, rideMap, coasters.data, commitRanks, onInserted],
  )

  // Coarse pointers skip the position-picking step entirely: the add lands at
  // the end of the ranked list immediately (drag to reposition). Runs in a
  // layout effect so no divider/empty-state flash is painted first.
  useLayoutEffect(() => {
    if (!instantAdd || !pendingAdd) return
    insertAt(pendingAdd.id, pendingAdd.name, items.length)
    onPendingClear?.()
  }, [instantAdd, pendingAdd, insertAt, onPendingClear, items.length])

  // Desktop quick-add pills ("Add to top" / "Add to bottom" in the banner):
  // same instant-commit as touch, at the requested end of the list. One-shot —
  // the page resets the request when onPendingClear fires.
  useLayoutEffect(() => {
    if (!quickInsert || !pendingAdd) return
    insertAt(pendingAdd.id, pendingAdd.name, quickInsert === 'top' ? 0 : items.length)
    onPendingClear?.()
  }, [quickInsert, pendingAdd, insertAt, onPendingClear, items.length])

  // Put a removed row back, exactly where it was, with zero server calls.
  const restoreRemoval = useCallback((coasterId: string) => {
    const entry = pendingRemovalsRef.current.get(coasterId)
    clearTimeout(entry?.timer)
    setPendingRemovals((prev) => {
      if (!prev.has(coasterId)) return prev
      const next = new Map(prev)
      next.delete(coasterId)
      return next
    })
    // Pre-commit undo: the id is still in `items`, so unhiding suffices.
    // Post-commit failure: the id was filtered out — reinsert it in place.
    if (entry && entry.index !== null) {
      setItems((prev) =>
        prev.includes(coasterId)
          ? prev
          : insertIdAt(prev, coasterId, Math.min(entry.index ?? 0, prev.length)),
      )
    }
  }, [])

  const restoreRemovalRef = useRef(restoreRemoval)
  restoreRemovalRef.current = restoreRemoval

  // Undo window expired: now (and only now) talk to the server.
  const commitRemoval = useCallback(
    (coasterId: string) => {
      const entry = pendingRemovalsRef.current.get(coasterId)
      if (!entry) return
      const name = entry.ride.coaster.name
      const wasRanked = entry.index !== null
      setItems((prev) => prev.filter((id) => id !== coasterId))
      removeRide.mutate(coasterId, {
        onSuccess: () => {
          if (wasRanked) {
            saveRanks.mutate(renumberRanks(itemsRef.current.filter((id) => id !== coasterId)), {
              onError: () =>
                onError?.(
                  `Removed ${name}, but couldn't renumber your ranks. They'll tidy up on your next change.`,
                ),
            })
          }
        },
        onError: () => {
          restoreRemovalRef.current(coasterId)
          onError?.(`Couldn't remove ${name}. Please try again.`)
        },
      })
    },
    [removeRide, saveRanks, onError],
  )

  const commitRemovalRef = useRef(commitRemoval)
  commitRemovalRef.current = commitRemoval

  const handleRemove = useCallback(
    (coasterId: string) => {
      if (pendingRemovalsRef.current.has(coasterId)) return
      const ride = rideMap.get(coasterId)
      if (!ride) return
      const index = itemsRef.current.indexOf(coasterId)
      // Dissolve the row out, keep it restorable for a few seconds, and only
      // then commit the server delete.
      setTimeout(() => {
        setPendingRemovals((prev) => {
          const entry = prev.get(coasterId)
          if (!entry) return prev
          const next = new Map(prev)
          next.set(coasterId, { ...entry, dissolved: true })
          return next
        })
      }, REMOVE_DISSOLVE_MS)
      const timer = setTimeout(() => commitRemovalRef.current(coasterId), REMOVE_UNDO_MS)
      setPendingRemovals((prev) => {
        const next = new Map(prev)
        next.set(coasterId, {
          index: index === -1 ? null : index,
          ride,
          timer,
          dissolved: false,
        })
        return next
      })
      onRemoved?.(ride.coaster.name, () => restoreRemovalRef.current(coasterId))
    },
    [rideMap, onRemoved],
  )

  const handlePendingInsert = useCallback(
    (index: number) => {
      if (!pendingAdd) return
      insertAt(pendingAdd.id, pendingAdd.name, index)
      onPendingClear?.()
    },
    [pendingAdd, insertAt, onPendingClear],
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return
      const oldIndex = items.indexOf(active.id as string)
      const newIndex = items.indexOf(over.id as string)
      if (oldIndex === -1 || newIndex === -1) return
      commitRanks(
        arrayMove(items, oldIndex, newIndex),
        items,
        "Couldn't save the new order. Please try again.",
      )
    },
    [items, commitRanks],
  )

  const handleDragStart = useCallback((_event: DragStartEvent) => {
    // Subtle native-feel cue on devices that support it (Android; no-op iOS).
    navigator.vibrate?.(10)
  }, [])

  const showEmptyState = visibleItems.length === 0 && !pendingAdd
  // On touch (instantAdd) the add never pauses for position picking, so the
  // insert targets never render — not even for the pre-layout-effect frame.
  const showInsertTargets = pendingAdd != null && !instantAdd

  return (
    <div>
      {showEmptyState ? (
        <MessageState>No coasters ranked yet. Search above to add some!</MessageState>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={visibleItems} strategy={verticalListSortingStrategy}>
            {isTouch && visibleItems.length > 0 && (
              <p className="mb-2 flex items-center gap-1.5 pl-1 text-xs text-muted">
                <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                Hold and drag a row to reorder
              </p>
            )}
            <ul className="space-y-2">
              {showInsertTargets && visibleItems.length === 0 && (
                <InsertDivider label={dividerLabel(0, 0)} onClick={() => handlePendingInsert(0)} />
              )}
              {visibleItems.map((id, i) => {
                const ride = rideMap.get(id)
                return (
                  <Fragment key={id}>
                    {showInsertTargets && (
                      <InsertDivider
                        label={dividerLabel(i, visibleItems.length)}
                        onClick={() => handlePendingInsert(i)}
                      />
                    )}
                    {ride ? (
                      <SortableRankedCoasterItem
                        ride={ride}
                        rank={i + 1}
                        park={parkMap.get(ride.coaster.park_id)}
                        onRemove={handleRemove}
                        highlight={id === highlightId}
                        removing={pendingRemovals.has(id)}
                        touchDraggable={isTouch}
                      />
                    ) : (
                      <li className="flex items-center gap-3 rounded-xl border border-line bg-surface-bright px-3 py-3 text-sm text-muted">
                        Saving…
                      </li>
                    )}
                  </Fragment>
                )
              })}
              {showInsertTargets && visibleItems.length > 0 && (
                <InsertDivider
                  label={dividerLabel(visibleItems.length, visibleItems.length)}
                  onClick={() => handlePendingInsert(visibleItems.length)}
                />
              )}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {visibleUnranked.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Added but not ranked
          </h3>
          <ul className="space-y-2">
            {visibleUnranked.map((ride) => (
              <RankedCoasterItem
                key={ride.coaster_id}
                ride={ride}
                rank={0}
                park={parkMap.get(ride.coaster.park_id)}
                onRemove={handleRemove}
                onRank={(coasterId) =>
                  insertAt(
                    coasterId,
                    rideMap.get(coasterId)?.coaster.name ?? 'Coaster',
                    items.length,
                  )
                }
                highlight={ride.coaster_id === highlightId}
                removing={pendingRemovals.has(ride.coaster_id)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
