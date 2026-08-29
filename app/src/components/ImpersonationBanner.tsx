import { useAuth } from '../lib/auth-context'
import { isImpersonating, returnToAdmin } from '../lib/impersonation'

// Fixed bottom bar shown while an admin is impersonating a synthetic user.
// Renders nothing for normal sessions.
export default function ImpersonationBanner() {
  const { user } = useAuth()
  if (!user || !isImpersonating()) return null
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-ink text-canvas">
      <div className="page-container flex items-center justify-between gap-4 py-2 text-sm">
        <span>
          Impersonating <span className="font-medium">{user.email ?? user.id}</span>
          <span className="ml-2 text-canvas/70">(session is not your own)</span>
        </span>
        <button
          onClick={() => void returnToAdmin()}
          className="rounded-full bg-canvas px-3 py-1 font-medium text-ink transition-opacity hover:opacity-80"
        >
          Return to admin
        </button>
      </div>
    </div>
  )
}
