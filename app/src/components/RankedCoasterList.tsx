import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { Plus } from 'lucide-react'
import { useParks, buildParkMap } from '../lib/coasters'
import { useRemoveRide, useSaveRanks, renumberRanks, insertIdAt, type UserRide } from '../lib/rides'
import RankedCoasterItem from './RankedCoasterItem'

export type PendingAdd = { id: string; name: string }

type Props = {
  rides: UserRide[]
  highlightId?: string | null
  pendingAdd?: PendingAdd | null
  onPendingClear?: () => void
  onInserted?: (coasterId: string, coasterName: string, rank: number) => void
  onError?: (message: string) => void
}

type ItemProps = Omit<
  React.ComponentProps<typeof RankedCoasterItem>,
  'style' | 'dragging' | 'handleProps' | 'itemRef'
>

function SortableRankedCoasterItem(props: ItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.ride.coaster_id,
  })
  return (
    <RankedCoasterItem
      {...props}
      style={{ transform: CSS.Transform.toString(transform), transition }}
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
        className="group flex w-full items-center gap-2 py-0.5 text-xs font-medium text-slate-400 hover:text-blue-600"
      >
        <span className="h-px flex-1 rounded bg-slate-200 group-hover:bg-blue-300" />
        <Plus className="h-3 w-3" />
        {label}
        <span className="h-px flex-1 rounded bg-slate-200 group-hover:bg-blue-300" />
      </button>
    </li>
  )
}

export default function RankedCoasterList({
  rides,
  highlightId,
  pendingAdd,
  onPendingClear,
  onInserted,
  onError,
}: Props) {
  const parks = useParks()
  const parkMap = useMemo(() => buildParkMap(parks.data ?? []), [parks.data])
  const removeRide = useRemoveRide()
  const saveRanks = useSaveRanks()

  const ranked = useMemo(() => rides.filter((r) => r.rank !== null), [rides])
  const unranked = useMemo(() => rides.filter((r) => r.rank === null), [rides])
  const rankedIds = useMemo(() => ranked.map((r) => r.coaster_id), [ranked])
  const rideMap = useMemo(() => new Map(rides.map((r) => [r.coaster_id, r])), [rides])

  const [items, setItems] = useState<string[]>(rankedIds)

  useEffect(() => {
    setItems(rankedIds)
  }, [rankedIds])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
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
      commitRanks(
        insertIdAt(items, coasterId, index),
        items,
        `Couldn't add ${coasterName}. Please try again.`,
        () => onInserted?.(coasterId, coasterName, index + 1),
      )
    },
    [items, commitRanks, onInserted],
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

  return (
    <div>
      {showEmptyState ? (
        <p className="py-8 text-center text-sm text-slate-500">
          No coasters ranked yet. Search above to add some!
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {pendingAdd && items.length === 0 && (
                <InsertDivider label={dividerLabel(0, 0)} onClick={() => handlePendingInsert(0)} />
              )}
              {items.map((id, i) => {
                const ride = rideMap.get(id)
                return (
                  <Fragment key={id}>
                    {pendingAdd && (
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
                      <li className="flex items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-400">
                        Saving…
                      </li>
                    )}
                  </Fragment>
                )
              })}
              {pendingAdd && items.length > 0 && (
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
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
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
