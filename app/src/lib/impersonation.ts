// Admin impersonation of synthetic users (testride ecosystem).
//
// assumeIdentity() backs up the admin session, gets a one-time magiclink for
// the target from the assume-identity Edge Function, and navigates to it —
// the browser then holds the synthetic user's session. A fixed banner
// (ImpersonationBanner) appears; "Return to admin" restores the backed-up
// admin session. Impersonation never locks the admin out of their account.
// (User listing lives in ./adminUsers; the Edge Function still refuses to
// mint links for real users.)
import { supabase } from './supabase'

const BACKUP_KEY = 'testride-impersonation-backup'

export function isImpersonating(): boolean {
  return localStorage.getItem(BACKUP_KEY) !== null
}

// Tolerates both the current session-storage shape (flat session object) and
// the legacy wrapped shape ({ currentSession: {...} }). Exported for tests.
export function extractTokens(
  saved: unknown,
): { accessToken: string; refreshToken: string } | null {
  if (typeof saved !== 'object' || saved === null) return null
  const obj = saved as Record<string, unknown>
  const nested =
    typeof obj['currentSession'] === 'object' && obj['currentSession'] !== null
      ? (obj['currentSession'] as Record<string, unknown>)
      : obj
  if (typeof nested['access_token'] === 'string' && typeof nested['refresh_token'] === 'string') {
    return {
      accessToken: nested['access_token'],
      refreshToken: nested['refresh_token'],
    }
  }
  return null
}

function parseBackup(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function assumeIdentity(userId: string): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  // Never clobber an existing backup: it always holds the ADMIN session.
  const setBackup = !!session && !isImpersonating()
  if (setBackup && session) {
    localStorage.setItem(BACKUP_KEY, JSON.stringify(session))
  }
  try {
    const { data, error } = await supabase.functions.invoke<{ actionLink: string }>(
      'assume-identity',
      {
        body: { userId, redirectTo: `${window.location.origin}/me` },
      },
    )
    if (error) throw new Error(error.message)
    if (!data?.actionLink) throw new Error('No login link returned')
    // Full navigation: GoTrue's verify endpoint redirects back with session
    // tokens in the URL fragment, which supabase-js picks up on load.
    window.location.assign(data.actionLink)
  } catch (err) {
    if (setBackup) localStorage.removeItem(BACKUP_KEY)
    throw err
  }
}

export async function returnToAdmin(): Promise<void> {
  const raw = localStorage.getItem(BACKUP_KEY)
  localStorage.removeItem(BACKUP_KEY)
  const tokens = raw ? extractTokens(parseBackup(raw)) : null
  if (!tokens) {
    await supabase.auth.signOut()
    window.location.assign('/')
    return
  }
  await supabase.auth.setSession({
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
  })
  window.location.assign('/admin/users')
}
