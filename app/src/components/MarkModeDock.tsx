import { useEffect, useState } from 'react'
import { ArrowRight, Eraser } from 'lucide-react'

type Props = {
  selectedCount: number
  /** Authenticated flow commits the append directly (Mode 6) — Phase 4. */
  authed?: boolean
  onRank: () => void
  onClear: () => void
}

// GUEST_UX.md §3.2: floating dock, bottom-center with safe-area insets.
// Slides up once ≥ 1 coaster is marked; count changes announced politely.
export default function MarkModeDock({ selectedCount, authed = false, onRank, onClear }: Props) {
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  const label = authed
    ? `Add (${selectedCount}) to My Coasters`
    : `Rank My Rides (${selectedCount})`

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${
        entered ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
      }`}
    >
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-line/80 bg-surface-bright/95 py-2 pl-5 pr-2 shadow-panel backdrop-blur"
      >
        <span className="sr-only">{`${selectedCount} coaster${selectedCount === 1 ? '' : 's'} selected`}</span>
        <button
          type="button"
          onClick={onRank}
          className="flex items-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-ink transition-colors hover:bg-accent-strong"
        >
          {label}
          {!authed && <ArrowRight className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-surface hover:text-ink"
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
          Clear
        </button>
      </div>
    </div>
  )
}
