import ConfirmEmailGate from '../components/ConfirmEmailGate'
import { useAuth } from '../lib/auth-context'

export default function MyCoastersPage() {
  const { user, isConfirmed } = useAuth()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">My Coasters</h1>
      {isConfirmed ? (
        <p className="mt-4 text-slate-600">
          Your ranked list will live here — the drag-sort editor arrives in Phase 5.
        </p>
      ) : (
        <div className="mt-6">
          <ConfirmEmailGate email={user?.email} />
        </div>
      )}
    </div>
  )
}
