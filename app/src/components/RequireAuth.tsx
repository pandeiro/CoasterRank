import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'

/**
 * Gate for authed routes (PLAN §6). Redirects anonymous visitors to /login and
 * carries the intended destination along so login can send them back.
 */
export default function RequireAuth() {
  const { session, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <p className="py-16 text-center text-slate-500">Loading…</p>
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <Outlet />
}
