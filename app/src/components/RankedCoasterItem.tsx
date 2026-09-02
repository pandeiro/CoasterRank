import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { GripVertical, ListPlus, X } from 'lucide-react'
import { capitalize, parkLabel, type Park } from '../lib/coasters'
import type { UserRide } from '../lib/rides'
import { Badge } from './ui'

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
  const parkText = parkLabel(park, '')

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
      className={`flex items-center gap-3 rounded-xl border bg-surface-bright px-3 py-3 text-sm transition-all ${
        highlight ? 'border-accent-strong shadow-accent' : 'border-line'
      } ${dragging ? 'z-20 shadow-lg opacity-90' : ''}`}
    >
      {handleProps && (
        <button
          type="button"
          // p-3.5 + -m-3 gives a 44px hit target on touch (WCAG 2.5.5 / HIG)
          // without changing the row layout; sm+ reverts to the compact 32px.
          className="-m-3 cursor-grab touch-none p-3.5 text-muted transition-colors hover:text-ink active:cursor-grabbing sm:-m-2 sm:p-2"
          aria-label="Drag to reorder"
          {...handleProps}
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}
      <span className="display-heading w-8 text-center text-lg text-muted">
        {rank > 0 ? rank : '—'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 gap-x-2 gap-y-0.5 max-sm:flex-col sm:items-baseline">
          <Link
            to={`/coasters/${ride.coaster.slug}`}
            className="min-w-0 truncate font-semibold text-ink underline-offset-4 hover:underline"
          >
            {ride.coaster.name}
          </Link>
          {parkText && (
            <span className="min-w-0 truncate text-xs text-muted max-sm:text-sm">{parkText}</span>
          )}
        </div>
      </div>
      <Badge className="hidden shrink-0 sm:inline-flex">{capitalize(ride.coaster.material)}</Badge>
      {onRank && (
        <button
          type="button"
          onClick={() => onRank(ride.coaster_id)}
          className="shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-surface hover:text-success"
          aria-label={`Add ${ride.coaster.name} to ranking`}
        >
          <ListPlus className="h-4 w-4" />
        </button>
      )}
      <button
        type="button"
        onClick={() => onRemove(ride.coaster_id)}
        className="shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-surface hover:text-danger"
        aria-label={`Remove ${ride.coaster.name}`}
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  )
}
