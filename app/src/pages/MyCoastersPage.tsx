import { useCallback, useMemo, useRef, useState } from 'react'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import CoasterSearchBar from '../components/CoasterSearchBar'
import RankedCoasterList, { type PendingAdd } from '../components/RankedCoasterList'
import Toast from '../components/Toast'
import { MessageState, PageHeader } from '../components/ui'
import { useAuth } from '../lib/auth-context'
import { useMyRides } from '../lib/rides'

type ToastState = { id: number; message: string; tone: 'info' | 'error' }

export default function MyCoastersPage() {
  const { user, isConfirmed } = useAuth()
  const { data: rides, isPending, isError } = useMyRides()

  const [toast, setToast] = useState<ToastState | null>(null)
  const toastSeq = useRef(0)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null)

  const existingIds = useMemo(() => new Set((rides ?? []).map((r) => r.coaster_id)), [rides])
  const rankedCount = useMemo(() => (rides ?? []).filter((r) => r.rank !== null).length, [rides])

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
        eyebrow="Your ride log"
        title="My Coasters"
        description={
          rankedCount > 0
            ? `${rankedCount} coaster${rankedCount === 1 ? '' : 's'} ranked`
            : 'Search for coasters below to start building your list.'
        }
      />

      <div className="sticky top-16 z-20 -mx-4 bg-canvas/95 px-4 pb-4 pt-4 backdrop-blur sm:-mx-8 sm:px-8">
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
