import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { GripVertical, ListPlus, X } from 'lucide-react'
import { capitalize, type Park } from '../lib/coasters'
import type { UserRide } from '../lib/rides'

type Props = {
  ride: UserRide
  rank: number
  park: Park | undefined
  onRemove: (coasterId: string) => void
  onRank?: (coasterId: string) => void
  highlight?: boolean
  dragging?: boolean
  style?: React.CSSProperties
  handleProps?: React.ComponentPropsWithoutRef<'button'>
  itemRef?: (node: HTMLLIElement | null) => void
}

export default function RankedCoasterItem({
  ride,
  rank,
  park,
  onRemove,
  onRank,
  highlight,
  dragging,
  style,
  handleProps,
  itemRef,
}: Props) {
  const liRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (highlight && liRef.current) {
      liRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
  }, [highlight])

  function mergedRef(node: HTMLLIElement | null) {
    liRef.current = node
    itemRef?.(node)
  }

  return (
    <li
      ref={mergedRef}
      style={style}
      className={`flex items-center gap-3 rounded border bg-white px-3 py-2.5 text-sm transition-shadow ${
        highlight ? 'border-blue-400 ring-2 ring-blue-400/30' : 'border-slate-200'
      } ${dragging ? 'z-20 shadow-lg opacity-90' : ''}`}
    >
      {handleProps && (
        <button
          type="button"
          className="cursor-grab touch-none text-slate-400 hover:text-slate-600 active:cursor-grabbing"
          aria-label="Drag to reorder"
          {...handleProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <span className="w-6 text-center font-mono text-xs text-slate-400">
        {rank > 0 ? rank : '—'}
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
      {onRank && (
        <button
          type="button"
          onClick={() => onRank(ride.coaster_id)}
          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600"
          aria-label={`Add ${ride.coaster.name} to ranking`}
        >
          <ListPlus className="h-4 w-4" />
        </button>
      )}
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
