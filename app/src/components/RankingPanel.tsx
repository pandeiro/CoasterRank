import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import FewVotesBadge from './FewVotesBadge'
import Toast from './Toast'
import { Button } from './ui'
import { useAuth } from '../lib/auth-context'
import type { RankingRow } from '../lib/board-types'
import { firstPlaceLabel, formatNumber, formatScore, useRecomputeFreshness } from '../lib/coasters'
import { formatRelativeTime } from '../lib/relative-time'
import { weekDelta } from '../lib/rankMovement'
import { useAddRide, useMyRides } from '../lib/rides'

// The relative "Updated X ago" label re-renders on this tick without
// refetching (same rationale as LiveStatusPopunder: the payload is cached for
// minutes, so a 30s tick keeps the label honest with zero network traffic).
const FRESHNESS_TICK_MS = 30_000

type ToastAction = { label: string; onClick: () => void }
type ToastState = {
  id: number
  message: string
  tone: 'info' | 'error'
  action?: ToastAction
}

// The hero "Community Ranking" block: rank + score as the dominant figures,
// the supporting BT stats as a compact strip, a freshness marker, a
// self-contained methodology popover, and the convert-the-visitor CTA with
// its three auth states (logged out / not yet listed / listed). Replaces the
// four equal-weight stat cards so the community's opinion reads as one
// living thing.
export default function RankingPanel({ coaster }: { coaster: RankingRow }) {
  const { session, isLoading: authLoading } = useAuth()
  const { data: rides, isPending: ridesPending } = useMyRides()
  const addRide = useAddRide()
  const { data: lastRecomputedAt } = useRecomputeFreshness()
  const navigate = useNavigate()
  const location = useLocation()

  const [toast, setToast] = useState<ToastState | null>(null)
  const toastSeq = useRef(0)
  const [, setTick] = useState(0)
  const [explainerOpen, setExplainerOpen] = useState(false)
  const explainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), FRESHNESS_TICK_MS)
    return () => clearInterval(id)
  }, [])

  // Score-explainer popover dismissal: outside pointer + Escape (the
  // LiveStatusPopunder / FilterBar pattern). Kept click-pinned rather than
  // hover-open so touch users get a stable toggle.
  useEffect(() => {
    if (!explainerOpen) return
    const onPointerDown = (event: PointerEvent) => {
      if (explainerRef.current && !explainerRef.current.contains(event.target as Node)) {
        setExplainerOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExplainerOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [explainerOpen])

  const firstPlace = firstPlaceLabel(coaster.first_place_votes, coaster.participants)
  const delta = weekDelta(coaster)
  // useMyRides is disabled while logged out (isPending forever), so gate the
  // reads on the session — a logged-out visitor must never look "listed".
  const myRide = session ? rides?.find((r) => r.coaster_id === coaster.id) : undefined
  const totalRides = rides?.length ?? 0

  const handleAdd = () => {
    toastSeq.current += 1
    addRide.mutate(coaster.id, {
      onSuccess: () => {
        setToast({
          id: toastSeq.current,
          message: 'Added to your rankings — sort it into place',
          tone: 'info',
          action: { label: 'Sort it', onClick: () => navigate('/me') },
        })
      },
      onError: () => {
        setToast({
          id: toastSeq.current,
          message: "Couldn't add that coaster — try again",
          tone: 'error',
        })
      },
    })
  }

  const showSignupCta = !authLoading && !session
  // While rides load we can't know which CTA applies — render neither, so a
  // logged-in user never sees "Add to your rankings" flash before the chip.
  const showAddCta = Boolean(session) && !ridesPending && !myRide
  const showRankedCta = Boolean(session) && Boolean(myRide)

  return (
    <div className="mt-6 rounded-xl border border-accent/30 bg-accent/5 p-5 shadow-panel sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-text">
          Community ranking
        </p>
        {lastRecomputedAt && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />
            Updated {formatRelativeTime(lastRecomputedAt)}
          </p>
        )}
      </div>

      {/* Hero figures: the rank and the score, noticeably larger than
          anything else on the page (brief §2). */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {coaster.rank === null ? (
          <span className="text-lg font-semibold text-muted">Not yet ranked</span>
        ) : (
          <span className="display-heading text-5xl leading-none text-accent-text sm:text-6xl">
            #{coaster.rank}
            <span className="sr-only"> on the board</span>
          </span>
        )}
        {coaster.score !== null && (
          <span className="display-heading text-4xl leading-none text-ink sm:text-5xl">
            {formatScore(coaster.score)}
          </span>
        )}
        {delta !== null && delta !== 0 && <MovementChip delta={delta} />}
        <FewVotesBadge comparisons={coaster.comparisons} />
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {coaster.comparisons === null ? (
          <span className="text-sm">No ratings yet</span>
        ) : (
          <>
            <span>Community score</span>
            <div ref={explainerRef} className="relative">
              <button
                type="button"
                aria-expanded={explainerOpen}
                onClick={() => setExplainerOpen((open) => !open)}
                className="inline-flex cursor-pointer items-center gap-1.5 py-0.5 font-medium leading-5 text-accent-text hover:underline"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden="true"
                  className="shrink-0"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
                How is this calculated?
              </button>
              {explainerOpen && (
                <div
                  role="note"
                  className="absolute right-0 top-full z-20 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-surface-bright p-3 text-xs leading-5 text-muted shadow-lift sm:left-0 sm:right-auto"
                >
                  <p>
                    Scores come from a Bradley-Terry model built on how riders rank coasters
                    relative to each other. Your say grows with how much you&apos;ve ranked: a
                    longer list carries more total weight, but each opinion in it counts less, and
                    very short lists are damped. The score is shown on an index where{' '}
                    <strong className="text-ink">100 is the community average</strong> — above 100
                    means it rode higher than average more often.
                  </p>
                  <Link
                    to="/about"
                    className="mt-1.5 inline-block font-medium text-accent-text hover:underline"
                  >
                    Learn more
                  </Link>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Supporting stats: one strip inside the panel, secondary to the
          headline figures (brief §2) — not separate equal-weight cards. */}
      <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-accent/15 pt-4">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">Comparisons</dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink">
            {coaster.comparisons === null ? '—' : formatNumber(coaster.comparisons)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">Participants</dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink">
            {coaster.participants === null ? '—' : formatNumber(coaster.participants)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.12em] text-muted">#1 votes</dt>
          <dd className="mt-0.5 text-lg font-semibold text-ink">
            {firstPlace ? `${firstPlace.votes} (${firstPlace.pct}%)` : '—'}
          </dd>
        </div>
      </dl>

      {/* The convert-the-visitor moment, anchored to the community's opinion
          (brief §5). Three auth states; status-vs-action styling mirrors the
          brief — action buttons for the two "not yet listed" states, an
          outline chip reading as status once it's on their list. */}
      {(showSignupCta || showAddCta || showRankedCta) && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-accent/15 pt-4">
          {showSignupCta && (
            <Link
              to="/signup"
              state={{ from: location.pathname }}
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-canvas transition-colors hover:bg-ink-soft"
            >
              Sign up to rank this coaster
            </Link>
          )}
          {showAddCta && (
            <Button onClick={handleAdd} disabled={addRide.isPending}>
              {addRide.isPending ? 'Adding…' : 'Add to your rankings'}
            </Button>
          )}
          {showRankedCta && myRide && (
            <Link
              to="/me"
              className="inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-line bg-surface-bright px-4 text-sm font-medium text-ink transition-colors hover:border-accent-text hover:bg-surface"
            >
              {myRide.rank !== null
                ? `Your ranking: #${myRide.rank} of ${totalRides}`
                : 'In your list — not sorted yet'}
            </Link>
          )}
        </div>
      )}

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          action={toast.action}
          onDismiss={() => setToast(null)}
        />
      )}
    </div>
  )
}

// Weekly movement next to the rank (free: rank_last_week rides on the view
// row). Same compact arrow treatment as the board's WeeklyDeltaBadge —
// visible arrow + count, full label for screen readers and hover.
function MovementChip({ delta }: { delta: number }) {
  const up = delta > 0
  const places = Math.abs(delta)
  const label = up
    ? `Up ${places} place${places === 1 ? '' : 's'} this week`
    : `Down ${places} place${places === 1 ? '' : 's'} this week`
  return (
    <span
      title={label}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
        up ? 'bg-success/15 text-success-text' : 'bg-danger/10 text-danger-text'
      }`}
    >
      <span aria-hidden="true">
        {up ? '↑' : '↓'}
        {places}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
