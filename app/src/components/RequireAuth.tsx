import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { MessageState } from './ui'

/**
 * Gate for authed routes (PLAN §6). Redirects anonymous visitors to /login and
 * carries the intended destination along so login can send them back.
 */
export default function RequireAuth() {
  const { session, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return <MessageState>Loading…</MessageState>
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <Outlet />
}
