import { createContext, useContext } from 'react'
import type { Session, User } from '@supabase/supabase-js'

export type AuthContextValue = {
  session: Session | null
  user: User | null
  /** True until the initial session restore resolves (or fails). */
  isLoading: boolean
  /**
   * True once the user's email is confirmed. This is the client-side half of
   * the ranking gate (PLAN §4.6); RLS enforces the same check server-side on
   * user_rides/coaster_submissions writes.
   */
  isConfirmed: boolean
  signOut: () => Promise<void>
}

// Kept in its own module (no components exported) so AuthProvider in auth.tsx
// stays fast-refresh-clean.
export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
