import { useMemo } from 'react'
import ConfirmEmailGate from '../components/ConfirmEmailGate'
import CoasterSearchBar from '../components/CoasterSearchBar'
import RankedCoasterList from '../components/RankedCoasterList'
import { useAuth } from '../lib/auth-context'
import { useMyRides } from '../lib/rides'

export default function MyCoastersPage() {
  const { user, isConfirmed } = useAuth()
  const { data: rides, isPending, isError } = useMyRides()

  const existingIds = useMemo(() => new Set((rides ?? []).map((r) => r.coaster_id)), [rides])
  const rankedCount = useMemo(() => (rides ?? []).filter((r) => r.rank !== null).length, [rides])

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

      <div className="mt-6">
        <CoasterSearchBar existingCoasterIds={existingIds} />
      </div>

      <div className="mt-6">
        {isPending ? (
          <p className="py-8 text-center text-sm text-slate-500">Loading your rides…</p>
        ) : isError ? (
          <p className="py-8 text-center text-sm text-red-600">Couldn&apos;t load your rides.</p>
        ) : (
          <RankedCoasterList rides={rides} />
        )}
      </div>
    </div>
  )
}
