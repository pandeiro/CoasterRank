import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { fetchProfile } from '../lib/profile'
import { MessageState } from './ui'

/**
 * Gate for admin routes (PLAN §6). Anonymous visitors bounce to /login like
 * RequireAuth; authed non-admins get an explicit "admins only" dead end
 * (their JWT could still hit the function, but the server re-checks
 * is_admin anyway — this gate is UX, the Edge Function is the boundary).
 */
export default function RequireAdmin() {
  const { session, isLoading } = useAuth()
  const location = useLocation()

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['profile', session?.user?.id],
    enabled: Boolean(session?.user?.id),
    queryFn: () => fetchProfile(session!.user!.id),
  })

  if (isLoading || (Boolean(session) && profileLoading)) {
    return <MessageState>Loading…</MessageState>
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  if (!profile?.is_admin) {
    return <MessageState>Admins only.</MessageState>
  }

  return <Outlet />
}
