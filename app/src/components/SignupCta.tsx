import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SIGNUP_CTA_HEADLINES } from '../lib/signup-cta'

type Props = {
  onDismiss: () => void
  /** Mark Mode entry (GUEST_UX.md §3.1): the primary CTA launches selection
   *  on the board instead of routing to the signup form. */
  onRankMyRides?: () => void
}

// Floating signup footer for the board. Compact card on all viewports
// (deliberately no drag-to-expand sheet — see PLAN decision log): centered,
// above the footer chrome, clear of most of the viewing surface.
export default function SignupCta({ onDismiss, onRankMyRides }: Props) {
  // Entrance: a half-second rise with a slight overshoot (custom bezier —
  // the card travels a touch past rest, then settles back). Transform +
  // opacity only, so it stays on the compositor at 60fps; no layout, no
  // paint. Reduced-motion users get it instantly instead.
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [])

  // One copy pair per mount (rotating, not reactive).
  const [copy] = useState(
    () => SIGNUP_CTA_HEADLINES[Math.floor(Math.random() * SIGNUP_CTA_HEADLINES.length)],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onDismiss])

  return (
    <div
      role="dialog"
      aria-label="Sign up invitation"
      aria-live="polite"
      className={`pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] transition-all duration-500 ease-[cubic-bezier(0.22,1.36,0.36,1)] motion-reduce:transition-none ${
        entered ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-10 scale-[0.97] opacity-0'
      }`}
    >
      <div className="pointer-events-auto w-full max-w-xl rounded-2xl border border-coral/45 bg-surface-bright/95 shadow-panel backdrop-blur">
        {/* Top-aligned row: the × stays pinned top-right now that the card
            runs three-plus lines tall. */}
        <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            {/* Two-line type: brand display face for the question (same
                voice as the share-nudge banner), Inter for the follow-up —
                and the break always falls between the phrases, never
                mid-phrase on mobile. */}
            <p className="display-heading text-[17px] leading-tight text-ink">{copy.question}</p>
            <p className="text-[13px] leading-snug text-muted">{copy.followUp}</p>
            <p className="mt-1 text-xs text-muted">
              Free · No ads or trackers · Private by default
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
              {onRankMyRides ? (
                // Mark Mode IS the signup path now (§3.1): one primary CTA,
                // no secondary "or sign up" — that read as clutter.
                <button
                  type="button"
                  onClick={onRankMyRides}
                  className="rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-strong"
                >
                  Rank My Rides
                </button>
              ) : (
                <Link
                  to="/signup"
                  onClick={onDismiss}
                  className="rounded-full bg-accent px-3.5 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:bg-accent-strong"
                >
                  Sign up free
                </Link>
              )}
              {/* Soft dismiss: no Log in link — this card only ever renders
                  for logged-out visitors, and regulars know where login lives. */}
              <button
                type="button"
                onClick={onDismiss}
                className="text-[13px] font-medium text-muted underline-offset-4 transition-colors hover:text-ink hover:underline"
              >
                Not now, thanks
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss signup prompt"
            className="shrink-0 rounded-full p-1.5 text-muted transition-colors hover:bg-surface hover:text-ink"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
