import { useEffect, useRef, useState } from 'react'
import { formatRelativeTime, nextRefitLine } from '../lib/relative-time'

// How often the relative "Last ranked X ago" and "Next refit" labels
// re-render without refetching (§2.3): the board payload is cached for 5
// minutes, so a 30s tick keeps both labels honest without any network
// traffic.
const REFRESH_INTERVAL_MS = 30_000

// The board's `Live ●` affordance (§2.3): hover (desktop) or click/tap —
// which also covers keyboard activation — shows a small popunder with the
// last-recompute time and an estimate of the next one. The last line prefers
// the pg_cron success timestamp, falling back to the edge-cache fill time;
// the next line is a pure clock heuristic (refits land on 5-minute cron
// boundaries, so "next slot" is computable from Date.now() alone — no board
// data, no network). Hover is transient; click/tap pins it open so touch
// users get a stable toggle (a second tap closes). Absolutely positioned so
// opening it never shifts the status line; dismisses on outside click or
// Escape.
// turnoverId: when a board turnover lands (a recompute became visible) the
// ping wave remounts, so the dot emits a fresh ripple — the status line
// participates in the "living competition" beat without any new UI.
export default function LiveStatusPopunder({
  lastRankedAt,
  turnoverId,
}: {
  lastRankedAt: string | null
  turnoverId?: string | null
}) {
  const [hovered, setHovered] = useState(false)
  const [pinnedOpen, setPinnedOpen] = useState(false)
  const [, setTick] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)

  const open = hovered || pinnedOpen

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDocumentPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setHovered(false)
        setPinnedOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHovered(false)
        setPinnedOpen(false)
      }
    }
    document.addEventListener('pointerdown', onDocumentPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const label = lastRankedAt ? formatRelativeTime(lastRankedAt) : ''

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setPinnedOpen((value) => !value)}
        className="inline-flex cursor-pointer items-center gap-1.5 rounded font-medium text-accent-text"
      >
        <span className="relative flex h-2 w-2">
          <span
            key={turnoverId ?? 'idle'}
            className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60"
          />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        Live
      </button>
      {open && (
        <div
          role="status"
          className="absolute right-0 top-full z-20 mt-1.5 min-w-max rounded-lg border border-line bg-surface-bright px-3 py-2 text-xs text-muted shadow-lift"
        >
          <div>{label ? `Last changed ${label}` : 'Last changed time unavailable'}</div>
          <div className="mt-0.5 text-muted">
            Next refit {nextRefitLine(lastRankedAt, Date.now())}
          </div>
        </div>
      )}
    </div>
  )
}
