import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { GripVertical, ListPlus, X } from 'lucide-react'
import { parkLabel, type Park } from '../lib/coasters'
import type { UserRide } from '../lib/rides'

type Props = {
  ride: UserRide
  rank: number
  park: Park | undefined
  onRemove: (coasterId: string) => void
  onRank?: (coasterId: string) => void
  highlight?: boolean
  /** Local undo-window state: the row is dissolving out. */
  removing?: boolean
  /** Touch: the whole row is the long-press drag activator; name isn't a link. */
  touchDraggable?: boolean
  dragging?: boolean
  style?: React.CSSProperties
  handleProps?: React.ComponentPropsWithoutRef<'button'>
  /** dnd-kit listeners spread onto the row itself (touch long-press). */
  rowListeners?: React.HTMLAttributes<HTMLLIElement>
  itemRef?: (node: HTMLLIElement | null) => void
}

/** Must match the TouchSensor activation delay in RankedCoasterList. */
export const TOUCH_DRAG_DELAY_MS = 200
/** Must match the TouchSensor tolerance: moves beyond this cancel activation. */
const TOUCH_DRAG_TOLERANCE_PX = 8

export default function RankedCoasterItem({
  ride,
  rank,
  park,
  onRemove,
  onRank,
  highlight,
  removing,
  touchDraggable,
  dragging,
  style,
  handleProps,
  rowListeners,
  itemRef,
}: Props) {
  const liRef = useRef<HTMLLIElement>(null)
  const parkText = parkLabel(park, '')

  // Pull a highlighted (just-added) row up to ~2/3 of the viewport instead of
  // the bare minimum, so it never lands flush against the bottom device edge.
  useEffect(() => {
    if (!highlight || removing || !liRef.current) return
    const rect = liRef.current.getBoundingClientRect()
    const vh = window.innerHeight
    const offscreen = rect.top < 0 || rect.bottom > vh || rect.top > vh * 0.8
    if (offscreen) {
      window.scrollBy({ top: rect.top - vh * 0.62, behavior: 'smooth' })
    }
  }, [highlight, removing])

  // Dissolve-out when locally removed (undo window): collapse + fade, matching
  // the rank-pop visual language. jsdom has no Element.animate — skip there.
  useEffect(() => {
    const el = liRef.current
    if (!el) return
    if (!removing) {
      el.style.pointerEvents = ''
      return
    }
    el.style.pointerEvents = 'none'
    if (typeof el.animate !== 'function') return
    const anim = el.animate(
      [
        {
          opacity: 1,
          maxHeight: `${el.offsetHeight}px`,
          transform: 'scale(1)',
          paddingTop: '0.75rem',
          paddingBottom: '0.75rem',
        },
        {
          opacity: 0,
          maxHeight: '0px',
          transform: 'scale(0.97)',
          paddingTop: '0px',
          paddingBottom: '0px',
          borderWidth: '0px',
        },
      ],
      { duration: 260, easing: 'ease-out', fill: 'forwards' },
    )
    return () => anim.cancel()
  }, [removing])

  // Whole-row touch drag needs the browser kept out of the gesture: with
  // touch-action: pan-y, the FIRST significant move lets Chrome claim the pan
  // and fire pointercancel — before React can even render `dragging`. So the
  // non-passive touchmove guard attaches at pointerdown + the activation
  // delay, but only if the finger hasn't drifted past the sensor tolerance
  // (a real scroll swipe detaches cleanly and pans as usual).
  useEffect(() => {
    if (!touchDraggable) return
    const node = liRef.current
    if (!node) return

    function onPointerDown(e: PointerEvent) {
      if (e.pointerType !== 'touch') return
      const startX = e.clientX
      const startY = e.clientY
      let detached = false
      let guard: ((ev: TouchEvent) => void) | null = null
      const detachPending = () => {
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', detachPending)
        window.removeEventListener('pointercancel', detachPending)
      }
      function onPointerMove(ev: PointerEvent) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > TOUCH_DRAG_TOLERANCE_PX) {
          detached = true
          clearTimeout(timer)
          detachPending()
        }
      }
      const timer = window.setTimeout(() => {
        if (detached) return
        detachPending()
        guard = (touch: TouchEvent) => touch.preventDefault()
        liRef.current?.addEventListener('touchmove', guard, { passive: false })
      }, TOUCH_DRAG_DELAY_MS)
      const detachAll = () => {
        clearTimeout(timer)
        if (guard) liRef.current?.removeEventListener('touchmove', guard)
        guard = null
        detachPending()
      }
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', detachAll)
      window.addEventListener('pointercancel', detachAll)
    }

    node.addEventListener('pointerdown', onPointerDown)
    return () => node.removeEventListener('pointerdown', onPointerDown)
  }, [touchDraggable])

  function mergedRef(node: HTMLLIElement | null) {
    liRef.current = node
    itemRef?.(node)
  }

  const nameClasses = 'min-w-0 truncate font-semibold text-ink'
  return (
    <li
      ref={mergedRef}
      style={style}
      aria-hidden={removing || undefined}
      {...rowListeners}
      className={`flex items-center gap-3 rounded-xl border bg-surface-bright px-3 py-3 text-sm transition-colors ${
        highlight ? 'border-accent-strong shadow-accent' : 'border-line'
      } ${dragging ? 'z-20 shadow-lg opacity-90' : ''} ${removing ? 'pointer-events-none' : ''} ${
        touchDraggable ? 'touch-pan-y select-none [-webkit-touch-callout:none]' : ''
      }`}
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
      <span
        key={rank}
        className="display-heading w-8 animate-rank-pop text-center text-lg text-muted"
      >
        {rank > 0 ? rank : '—'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 gap-x-2 gap-y-0.5 max-sm:flex-col sm:items-baseline">
          {touchDraggable ? (
            <span className={nameClasses}>{ride.coaster.name}</span>
          ) : (
            <Link
              to={`/coasters/${ride.coaster.slug}`}
              className={`${nameClasses} underline-offset-4 hover:underline`}
            >
              {ride.coaster.name}
            </Link>
          )}
          {parkText && (
            <span className="min-w-0 truncate text-xs text-muted max-sm:text-sm">{parkText}</span>
          )}
        </div>
      </div>
      <span className="hidden shrink-0 truncate text-xs text-muted sm:inline">
        {ride.coaster.manufacturer_name ?? '—'}
      </span>
      <span className="hidden shrink-0 truncate text-xs text-muted sm:inline">
        {ride.coaster.park_country ?? '—'}
      </span>
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
