import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import CoasterSearchBar from '../components/CoasterSearchBar'
import RankedCoasterList, { type PendingAdd } from '../components/RankedCoasterList'
import ShareListCard from '../components/ShareListCard'
import Toast from '../components/Toast'
import { MessageState, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import { fetchProfile } from '../lib/profile'
import { useMyRides } from '../lib/rides'
import {
  milestoneForRankedCount,
  persistDismissedMilestone,
  readDismissedMilestone,
  SHARE_CTA_DISMISS_KEY,
} from '../lib/share-cta'

type ToastState = { id: number; message: string; tone: 'info' | 'error' }

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
  const [dismissedMilestone, setDismissedMilestone] = useState(readDismissedMilestone)
  const searchSentinelRef = useRef<HTMLDivElement>(null)
  const [searchStuck, setSearchStuck] = useState(false)

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

  const notify = useCallback((message: string, tone: ToastState['tone'] = 'info') => {
    toastSeq.current += 1
    setToast({ id: toastSeq.current, message, tone })
  }, [])
  const dismissToast = useCallback(() => setToast(null), [])

  const handleAdd = useCallback((coasterId: string, coasterName: string) => {
    setPendingAdd({ id: coasterId, name: coasterName })
  }, [])

  const clearPendingAdd = useCallback(() => setPendingAdd(null), [])

  const handleInserted = useCallback(
    (coasterId: string, coasterName: string, rank: number) => {
      notify(`Added ${coasterName} at #${rank}`)
      setHighlightId(coasterId)
      setTimeout(() => setHighlightId(null), 2000)
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
        {pendingAdd && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-ink-soft">
            <span>
              Adding <span className="font-medium">{pendingAdd.name}</span> — choose a position
              below.
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
            onPendingClear={clearPendingAdd}
            onInserted={handleInserted}
            onError={handleError}
          />
        )}
      </div>

      {toast && (
        <Toast key={toast.id} message={toast.message} tone={toast.tone} onDismiss={dismissToast} />
      )}
    </div>
  )
}
