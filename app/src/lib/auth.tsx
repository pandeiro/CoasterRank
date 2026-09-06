import { useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { AuthContext, type AuthContextValue } from './auth-context'
import { supabase } from './supabase'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled) return
      // getSession resolves (rather than rejects) on failure: without this
      // branch the app would hang on the loading state forever.
      if (error) {
        console.warn('[auth] getSession failed:', error.message)
      } else {
        setSession(data.session)
      }
      setIsLoading(false)
    })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [])

  const user = session?.user ?? null

  const value: AuthContextValue = {
    session,
    user,
    isLoading,
    isConfirmed: Boolean(user?.email_confirmed_at),
    signOut: async () => {
      const { error } = await supabase.auth.signOut()
      // Thrown (not swallowed): callers must not navigate away as if the
      // logout succeeded — the session is still alive.
      if (error) throw error
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
