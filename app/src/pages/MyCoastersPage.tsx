import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import CoasterSearchBar from '../components/CoasterSearchBar'
import RankedCoasterList, { REMOVE_UNDO_MS, type PendingAdd } from '../components/RankedCoasterList'
import ShareListCard from '../components/ShareListCard'
import Toast from '../components/Toast'
import WelcomeModal from '../components/WelcomeModal'
import { persistWelcomeDismissed, readWelcomeDismissed } from '../lib/welcome'
import { MessageState, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import { fetchProfile } from '../lib/profile'
import { startReplay, stopReplay } from '../lib/sentry'
import { useMyRides } from '../lib/rides'
import { isCoarsePointer } from '../lib/use-media-query'
import {
  milestoneForRankedCount,
  persistDismissedMilestone,
  readDismissedMilestone,
  SHARE_CTA_DISMISS_KEY,
} from '../lib/share-cta'

type ToastAction = { label: string; onClick: () => void }
type ToastState = {
  id: number
  message: string
  tone: 'info' | 'error'
  action?: ToastAction
  durationMs?: number
}

// The sticky search bar only gets its backdrop once it has actually stuck to
// the header — in normal flow it stays transparent so adjacent card shadows
// (milestone card above, first ranked card below) aren't painted over.
const SEARCH_STUCK_ROOT_MARGIN = '-64px 0px 0px 0px'

export default function MyCoastersPage() {
  const { user, isConfirmed } = useAuth()
  const { data: rides, isPending, isError } = useMyRides()

  // Shared ['profile', userId] cache (same key/shape as ProfilePage/Layout).
  const { data: profile } = useQuery({
    queryKey: ['profile', user?.id],
    enabled: Boolean(user),
    queryFn: () => fetchProfile(user!.id),
  })

  const [toast, setToast] = useState<ToastState | null>(null)
  const toastSeq = useRef(0)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null)
  // Desktop shortcut from the pending-add banner: one-shot insertion request
  // at either end of the list, so a long list doesn't force a scroll to reach
  // the top/bottom dividers. The list consumes it and clears pendingAdd.
  const [quickInsert, setQuickInsert] = useState<'top' | 'bottom' | null>(null)
  const [dismissedMilestone, setDismissedMilestone] = useState(readDismissedMilestone)
  // First-run welcome: shown exactly once, on the first login after signup.
  // The redirect chain (signup / login) lands fresh users on /me?welcome=1;
  // the persisted flag is the backstop (back-button revisit, board-link
  // exit) and the zero-rides guard keeps it from ever firing mid-life.
  const [searchParams, setSearchParams] = useSearchParams()
  const [welcomeDismissed, setWelcomeDismissed] = useState(readWelcomeDismissed)
  const showWelcome =
    isConfirmed &&
    !isPending &&
    !isError &&
    (rides ?? []).length === 0 &&
    searchParams.get('welcome') === '1' &&
    !welcomeDismissed

  const dismissWelcome = useCallback(() => {
    persistWelcomeDismissed()
    setWelcomeDismissed(true)
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete('welcome')
        return next
      },
      { replace: true },
    )
  }, [setSearchParams])
  const searchSentinelRef = useRef<HTMLDivElement>(null)
  const [searchStuck, setSearchStuck] = useState(false)
  // Touch users skip position picking: the add lands at the end of the list
  // instantly and can be long-press dragged into place (keyboard/scroll
  // constraints make the desktop pick-a-position flow hostile on mobile).
  const [isTouch] = useState(isCoarsePointer)

  useEffect(() => {
    const sentinel = searchSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) setSearchStuck(!entry.isIntersecting)
      },
      { rootMargin: SEARCH_STUCK_ROOT_MARGIN },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    startReplay()
    return () => stopReplay()
  }, [])

  const existingIds = useMemo(() => new Set((rides ?? []).map((r) => r.coaster_id)), [rides])
  const rankedCount = useMemo(() => (rides ?? []).filter((r) => r.rank !== null).length, [rides])

  const milestone = milestoneForRankedCount(rankedCount)
  const showShareCta = milestone > 0 && milestone > dismissedMilestone

  const dismissShareCta = useCallback(() => {
    setDismissedMilestone(milestone)
    persistDismissedMilestone(milestone)
  }, [milestone])

  // Sync dismissal if storage changes elsewhere (e.g. another tab).
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === SHARE_CTA_DISMISS_KEY) setDismissedMilestone(readDismissedMilestone())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const notify = useCallback(
    (
      message: string,
      tone: ToastState['tone'] = 'info',
      extra?: Omit<ToastState, 'id' | 'message' | 'tone'>,
    ) => {
      toastSeq.current += 1
      setToast({ id: toastSeq.current, message, tone, ...extra })
    },
    [],
  )
  const dismissToast = useCallback(() => setToast(null), [])

  const handleAdd = useCallback((coasterId: string, coasterName: string) => {
    setPendingAdd({ id: coasterId, name: coasterName })
  }, [])

  const clearPendingAdd = useCallback(() => {
    setPendingAdd(null)
    setQuickInsert(null)
  }, [])

  const handleInserted = useCallback(
    (coasterId: string, coasterName: string, rank: number) => {
      notify(`Added ${coasterName} at #${rank}`)
      setHighlightId(coasterId)
      setTimeout(() => setHighlightId(null), 2000)
    },
    [notify],
  )

  // Removal is deferred client-side; the undo action rolls it back with zero
  // server calls. Toast lifetime mirrors the list's undo window.
  const handleRemoved = useCallback(
    (coasterName: string, undo: () => void) => {
      notify(`Removed ${coasterName}`, 'info', {
        action: { label: 'Undo', onClick: undo },
        durationMs: REMOVE_UNDO_MS,
      })
    },
    [notify],
  )

  const handleError = useCallback((message: string) => notify(message, 'error'), [notify])

  if (!isConfirmed) {
    return (
      <div>
        <h1 className="display-heading text-4xl text-ink">My Coasters</h1>
        <div className="mt-6">
          <ConfirmEmailGate email={user?.email} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="My Coasters"
        description={
          rankedCount > 0
            ? `${rankedCount} coaster${rankedCount === 1 ? '' : 's'} ranked`
            : 'Search for coasters below to start building your list.'
        }
      />

      {showWelcome && user?.id && (
        <WelcomeModal
          username={profile?.username ?? null}
          userId={user.id}
          avatarUrl={profile?.avatar_url}
          onClose={dismissWelcome}
        />
      )}

      {showShareCta && (
        <div className="mt-6">
          <ShareListCard
            username={profile?.username ?? null}
            publicList={profile?.public_list ?? false}
            rankedCount={rankedCount}
            milestone={milestone === 2 ? 2 : 1}
            onDismiss={dismissShareCta}
          />
        </div>
      )}

      <div ref={searchSentinelRef} aria-hidden="true" className="h-px" />

      <div
        className={`sticky top-16 z-20 pb-3 pt-3 transition-colors duration-200 ${
          searchStuck ? 'bg-canvas/95 backdrop-blur' : ''
        }`}
      >
        <CoasterSearchBar existingCoasterIds={existingIds} onAdd={handleAdd} />
        {pendingAdd && !isTouch && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-ink-soft">
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span>
                Adding <span className="font-medium">{pendingAdd.name}</span> — choose a position
                below or
              </span>
              {(['top', 'bottom'] as const).map((where) => (
                <button
                  key={where}
                  type="button"
                  onClick={() => setQuickInsert(where)}
                  className="rounded-full border border-accent/50 bg-surface px-2 py-0.5 text-xs font-medium text-ink transition-colors hover:bg-accent/20 hover:text-accent-strong"
                >
                  Add to {where}
                </button>
              ))}
            </span>
            <button
              type="button"
              onClick={clearPendingAdd}
              className="shrink-0 rounded-full px-2.5 py-1 text-xs text-muted hover:bg-accent/20 hover:text-ink"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div>
        {isPending ? (
          <MessageState>Loading your rides…</MessageState>
        ) : isError ? (
          <MessageState tone="danger">Couldn&apos;t load your rides.</MessageState>
        ) : (
          <RankedCoasterList
            rides={rides}
            highlightId={highlightId}
            pendingAdd={pendingAdd}
            quickInsert={quickInsert}
            instantAdd={isTouch}
            onPendingClear={clearPendingAdd}
            onInserted={handleInserted}
            onRemoved={handleRemoved}
            onError={handleError}
          />
        )}
      </div>

      {/* Scroll headroom so the newest row can rest ~2/3 down the viewport
          instead of flush against the bottom device edge. */}
      <div aria-hidden="true" className="h-[30vh]" />

      {toast && (
        <Toast
          key={toast.id}
          message={toast.message}
          tone={toast.tone}
          durationMs={toast.durationMs}
          action={toast.action}
          onDismiss={dismissToast}
        />
      )}
    </div>
  )
}
