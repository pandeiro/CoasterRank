import { useQuery } from '@tanstack/react-query'
import { useAuth } from './auth-context'
import { fetchProfile } from './profile'

/**
 * Admin flag for inline edit affordances (detail pages, etc.).
 *
 * Security: this is UX-only. Writes stay gated server-side by RLS
 * (`is_admin()` on coasters/parks) — a non-admin caller sees no button, and
 * a forged request still fails at the DB boundary.
 *
 * Cost for non-admins: zero extra network. Anonymous users skip the query
 * entirely (`enabled: false`); authed users share the existing
 * `['profile', userId]` cache entry with Layout/RequireAdmin (same queryFn,
 * same SELECT shape — `select` only derives, never narrows the cache).
 */
export function useIsAdmin(): boolean {
  const { session } = useAuth()
  const userId = session?.user?.id
  const { data } = useQuery({
    queryKey: ['profile', userId],
    enabled: Boolean(userId),
    queryFn: () => fetchProfile(userId!),
    select: (profile) => profile.is_admin,
  })
  return data ?? false
}
