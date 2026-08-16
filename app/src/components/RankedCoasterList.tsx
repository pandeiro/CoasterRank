import { useCallback, useMemo, useState } from 'react'
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
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useParks, buildParkMap } from '../lib/coasters'
import { useRemoveRide, useSaveRanks, renumberRanks, type UserRide } from '../lib/rides'
import RankedCoasterItem from './RankedCoasterItem'

type Props = {
  rides: UserRide[]
  highlightId?: string | null
}

export default function RankedCoasterList({ rides, highlightId }: Props) {
  const parks = useParks()
  const parkMap = useMemo(() => buildParkMap(parks.data ?? []), [parks.data])
  const removeRide = useRemoveRide()
  const saveRanks = useSaveRanks()

  const ranked = useMemo(() => rides.filter((r) => r.rank !== null), [rides])
  const unranked = useMemo(() => rides.filter((r) => r.rank === null), [rides])

  const [items, setItems] = useState<string[]>(() => ranked.map((r) => r.coaster_id))

  const rideMap = useMemo(() => new Map(rides.map((r) => [r.coaster_id, r])), [rides])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event
      if (!over || active.id === over.id) return

      setItems((prev) => {
        const oldIndex = prev.indexOf(active.id as string)
        const newIndex = prev.indexOf(over.id as string)
        if (oldIndex === -1 || newIndex === -1) return prev
        const next = arrayMove(prev, oldIndex, newIndex)
        saveRanks.mutate(renumberRanks(next))
        return next
      })
    },
    [saveRanks],
  )

  function handleRemove(coasterId: string) {
    removeRide.mutate(coasterId)
    setItems((prev) => prev.filter((id) => id !== coasterId))
  }

  return (
    <div>
      {ranked.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">
              {items.map((id, i) => {
                const ride = rideMap.get(id)
                if (!ride) return null
                return (
                  <RankedCoasterItem
                    key={id}
                    ride={ride}
                    rank={i + 1}
                    park={parkMap.get(ride.coaster.park_id)}
                    onRemove={handleRemove}
                  />
                )
              })}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="py-8 text-center text-sm text-slate-500">
          No coasters ranked yet. Search above to add some!
        </p>
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
                highlight={ride.coaster_id === highlightId}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
