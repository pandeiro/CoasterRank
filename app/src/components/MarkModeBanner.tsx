import { X } from 'lucide-react'

type Props = {
  /** Authenticated visitors get the fast-add framing (Mode 6); guests the
   *  two-step onboarding framing (Mode 2). */
  authed?: boolean
  selectedCount: number
  onExit: () => void
}

// GUEST_UX.md §3.2: slim guidance banner pinned above the filter bar while
// Mark Mode is active. Non-blocking — pure guidance, exits cleanly.
export default function MarkModeBanner({ authed = false, selectedCount, onExit }: Props) {
  return (
    <div className="mb-3 flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/10 px-4 py-2.5 text-sm">
      <p className="min-w-0 flex-1 text-ink-soft">
        {authed ? (
          <>
            <span className="font-semibold text-ink">Add ridden coasters to your ranking</span>
            {selectedCount > 0 && <span className="text-muted"> · {selectedCount} selected</span>}
          </>
        ) : (
          <>
            <span className="font-semibold text-ink">
              Step 1 of 2: Select the coasters you've ridden
            </span>
            <span className="text-muted">
              {' '}
              · Filter by park or search below. When finished, tap Rank My Rides.
            </span>
          </>
        )}
      </p>
      <button
        type="button"
        onClick={onExit}
        className="flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:bg-accent/15 hover:text-ink"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        Exit
      </button>
    </div>
  )
}
