import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { Session, User } from '@supabase/supabase-js'
import { AuthProvider } from './auth'
import { useAuth } from './auth-context'
import { supabase } from './supabase'

vi.mock('./supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

const fakeUser = { id: 'u1', email: 'a@example.com', email_confirmed_at: '2026-01-01' } as User
const fakeSession = { user: fakeUser } as Session

function mockAuthApi() {
  const unsubscribe = vi.fn()
  vi.mocked(supabase.auth.getSession).mockResolvedValue({
    data: { session: fakeSession },
    error: null,
  } as never)
  vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
    data: { subscription: { unsubscribe } },
  } as never)
  return { unsubscribe }
}

function Probe() {
  const { user, isLoading, isConfirmed } = useAuth()
  if (isLoading) return <p>loading</p>
  return <p>{user ? `${user.email}:${String(isConfirmed)}` : 'anon'}</p>
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('restores the session and exposes the user', async () => {
    mockAuthApi()
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => {
      expect(screen.getByText('a@example.com:true')).toBeInTheDocument()
    })
  })

  it('unsubscribes from auth state changes on unmount', () => {
    const { unsubscribe } = mockAuthApi()
    const { unmount } = render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('reports an anonymous visitor once loading settles', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never)
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as never)
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    )
    await waitFor(() => {
      expect(screen.getByText('anon')).toBeInTheDocument()
    })
  })
})
