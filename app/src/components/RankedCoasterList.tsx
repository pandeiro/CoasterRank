import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
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
import RankedCoasterItem from './RankedCoasterItem'
import { MessageState } from './ui'

export type PendingAdd = { id: string; name: string }

type Props = {
  rides: UserRide[]
  highlightId?: string | null
  pendingAdd?: PendingAdd | null
  /** Coarse pointers: selecting a coaster inserts it at the end immediately. */
  instantAdd?: boolean
  onPendingClear?: () => void
  onInserted?: (coasterId: string, coasterName: string, rank: number) => void
  onError?: (message: string) => void
}

type ItemProps = Omit<
  React.ComponentProps<typeof RankedCoasterItem>,
  'style' | 'dragging' | 'handleProps' | 'itemRef'
>

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
      handleProps={{ ...attributes, ...listeners } as React.ComponentPropsWithoutRef<'button'>}
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
  onPendingClear,
  onInserted,
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

  const ranked = useMemo(() => rides.filter((r) => r.rank !== null), [rides])
  const unranked = useMemo(() => rides.filter((r) => r.rank === null), [rides])
  const rankedIds = useMemo(() => ranked.map((r) => r.coaster_id), [ranked])
  const rideMap = useMemo(
    () => new Map([...pendingRides, ...rides].map((r) => [r.coaster_id, r])),
    [rides, pendingRides],
  )

  // Drop stand-ins once the real rows arrive from the server.
  useEffect(() => {
    setPendingRides((prev) => {
      if (prev.length === 0) return prev
      const serverIds = new Set(rides.map((r) => r.coaster_id))
      const next = prev.filter((r) => !serverIds.has(r.coaster_id))
      return next.length === prev.length ? prev : next
    })
  }, [rides])

  const [items, setItems] = useState<string[]>(rankedIds)

  useEffect(() => {
    setItems(rankedIds)
  }, [rankedIds])

  const sensors = useSensors(
    // Desktop: drag on 5px movement. Touch: long-press (200ms) so vertical
    // scrolling never fights the drag gesture — the native mobile pattern.
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
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

  const handleRemove = useCallback(
    (coasterId: string) => {
      const snapshot = items
      const wasRanked = snapshot.includes(coasterId)
      const next = snapshot.filter((id) => id !== coasterId)
      const name = rideMap.get(coasterId)?.coaster.name ?? 'coaster'
      setItems(next)
      removeRide.mutate(coasterId, {
        onSuccess: () => {
          if (wasRanked && next.length > 0) {
            saveRanks.mutate(renumberRanks(next), {
              onError: () =>
                onError?.(
                  `Removed ${name}, but couldn't renumber your ranks. They'll tidy up on your next change.`,
                ),
            })
          }
        },
        onError: () => {
          setItems(snapshot)
          onError?.(`Couldn't remove ${name}. Please try again.`)
        },
      })
    },
    [items, rideMap, removeRide, saveRanks, onError],
  )

  const showEmptyState = items.length === 0 && !pendingAdd
  // On touch (instantAdd) the add never pauses for position picking, so the
  // insert targets never render — not even for the pre-layout-effect frame.
  const showInsertTargets = pendingAdd != null && !instantAdd

  return (
    <div>
      {showEmptyState ? (
        <MessageState>No coasters ranked yet. Search above to add some!</MessageState>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            {isTouch && items.length > 0 && (
              <p className="mb-2 flex items-center gap-1.5 pl-1 text-xs text-muted">
                <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                Hold and drag a row to reorder
              </p>
            )}
            <ul className="space-y-2">
              {showInsertTargets && items.length === 0 && (
                <InsertDivider label={dividerLabel(0, 0)} onClick={() => handlePendingInsert(0)} />
              )}
              {items.map((id, i) => {
                const ride = rideMap.get(id)
                return (
                  <Fragment key={id}>
                    {showInsertTargets && (
                      <InsertDivider
                        label={dividerLabel(i, items.length)}
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
                      />
                    ) : (
                      <li className="flex items-center gap-3 rounded-xl border border-line bg-surface-bright px-3 py-3 text-sm text-muted">
                        Saving…
                      </li>
                    )}
                  </Fragment>
                )
              })}
              {showInsertTargets && items.length > 0 && (
                <InsertDivider
                  label={dividerLabel(items.length, items.length)}
                  onClick={() => handlePendingInsert(items.length)}
                />
              )}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {unranked.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Added but not ranked
          </h3>
          <ul className="space-y-2">
            {unranked.map((ride) => (
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
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
