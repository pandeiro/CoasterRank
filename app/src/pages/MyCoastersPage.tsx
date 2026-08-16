import { useCallback, useMemo, useState } from 'react'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import CoasterSearchBar from '../components/CoasterSearchBar'
import RankedCoasterList from '../components/RankedCoasterList'
import Toast from '../components/Toast'
import { useAuth } from '../lib/auth-context'
import { useAddRide, useMyRides } from '../lib/rides'

export default function MyCoastersPage() {
  const { user, isConfirmed } = useAuth()
  const { data: rides, isPending, isError } = useMyRides()
  const addRide = useAddRide()

  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  const existingIds = useMemo(() => new Set((rides ?? []).map((r) => r.coaster_id)), [rides])
  const rankedCount = useMemo(() => (rides ?? []).filter((r) => r.rank !== null).length, [rides])

  const handleAdd = useCallback(
    (coasterId: string, coasterName: string) => {
      addRide.mutate(coasterId, {
        onSuccess: () => {
          setToastMessage(`Added ${coasterName}`)
          setHighlightId(coasterId)
          setTimeout(() => setHighlightId(null), 2000)
        },
      })
    },
    [addRide],
  )

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
      </div>

      <div>
        {isPending ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading your rides…</p>
        ) : isError ? (
          <p className="py-8 text-center text-sm text-red-600">Couldn&apos;t load your rides.</p>
        ) : (
          <RankedCoasterList rides={rides} highlightId={highlightId} />
        )}
      </div>

      {toastMessage && <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />}
    </div>
  )
}
