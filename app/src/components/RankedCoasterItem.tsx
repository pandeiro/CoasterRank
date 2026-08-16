import { Link } from 'react-router-dom'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'
import { capitalize, type Park } from '../lib/coasters'
import type { UserRide } from '../lib/rides'

type Props = {
  ride: UserRide
  rank: number
  park: Park | undefined
  onRemove: (coasterId: string) => void
}

export default function RankedCoasterItem({ ride, rank, park, onRemove }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: ride.coaster_id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 rounded border border-slate-200 bg-white px-3 py-2.5 text-sm ${
        isDragging ? 'z-20 shadow-lg opacity-90' : ''
      }`}
    >
      <button
        type="button"
        className="cursor-grab touch-none text-slate-400 hover:text-slate-600 active:cursor-grabbing"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <span className="w-6 text-center font-mono text-xs text-slate-400">
        {ride.rank !== null ? rank : '—'}
      </span>
      <div className="min-w-0 flex-1">
        <Link
          to={`/coasters/${ride.coaster.slug}`}
          className="font-medium text-slate-900 hover:underline"
        >
          {ride.coaster.name}
        </Link>
        <span className="ml-2 text-xs text-slate-500">{park?.name ?? ''}</span>
      </div>
      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs capitalize text-slate-600">
        {capitalize(ride.coaster.material)}
      </span>
      <button
        type="button"
        onClick={() => onRemove(ride.coaster_id)}
        className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-red-600"
        aria-label={`Remove ${ride.coaster.name}`}
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  )
}
