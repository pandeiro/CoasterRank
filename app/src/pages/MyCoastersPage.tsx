import { useCallback, useMemo, useRef, useState } from 'react'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import CoasterSearchBar from '../components/CoasterSearchBar'
import RankedCoasterList, { type PendingAdd } from '../components/RankedCoasterList'
import Toast from '../components/Toast'
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
        <h1 className="text-2xl font-semibold text-slate-900">My Coasters</h1>
        <div className="mt-6">
          <ConfirmEmailGate email={user?.email} />
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">My Coasters</h1>
      <p className="mt-1 text-sm text-slate-600">
        {rankedCount > 0
          ? `${rankedCount} coaster${rankedCount === 1 ? '' : 's'} ranked`
          : 'Search for coasters below to start building your list.'}
      </p>

      <div className="sticky top-0 z-10 -mx-8 bg-slate-50 px-8 pb-4 pt-4">
        <CoasterSearchBar existingCoasterIds={existingIds} onAdd={handleAdd} />
        {pendingAdd && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-slate-700">
            <span>
              Adding <span className="font-medium">{pendingAdd.name}</span> — choose a position
              below.
            </span>
            <button
              type="button"
              onClick={clearPendingAdd}
              className="shrink-0 rounded px-2 py-1 text-xs text-slate-500 hover:bg-blue-100 hover:text-slate-700"
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      <div>
        {isPending ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading your rides…</p>
        ) : isError ? (
          <p className="py-8 text-center text-sm text-red-600">Couldn&apos;t load your rides.</p>
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
