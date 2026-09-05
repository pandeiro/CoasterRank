import { useEffect, useRef, useState } from 'react'

// How often the relative "Last ranked X ago" label re-renders without
// refetching (§2.3): the underlying payload is cached for 15 minutes, so a
// 30s tick keeps the label honest without any network traffic.
const REFRESH_INTERVAL_MS = 30_000

function formatLastRanked(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const elapsedMs = Date.now() - then
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 1) return 'just now'
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (minutes < 60) return rtf.format(-minutes, 'minute')
  const hours = Math.floor(elapsedMs / 3_600_000)
  if (hours < 24) return rtf.format(-hours, 'hour')
  return rtf.format(-Math.floor(elapsedMs / 86_400_000), 'day')
}

// The board's `Live ●` affordance (§2.3): hover (desktop) or click/tap —
// which also covers keyboard activation — shows a small popunder with the
// last-recompute time; prefer the pg_cron success timestamp, fall back to
// the edge-cache fill time. Hover is transient; click/tap pins it open so
// touch users get a stable toggle (a second tap closes). Absolutely
// positioned so opening it never shifts the status line; dismisses on
// outside click or Escape.
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

  const label = lastRankedAt ? formatLastRanked(lastRankedAt) : ''

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
        className="inline-flex cursor-pointer items-center gap-1.5 rounded font-medium text-accent-strong"
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
          className="absolute right-0 top-full z-10 mt-1.5 min-w-max rounded-lg border border-line bg-surface-bright px-3 py-2 text-xs text-muted shadow-lift"
        >
          {label ? `Last ranked ${label}` : 'Last ranked time unavailable'}
        </div>
      )}
    </div>
  )
}
