import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from '@supabase/supabase-js'
import MyCoastersPage from './MyCoastersPage'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      resend: vi.fn(),
    },
  },
}))

function mockAuth({ confirmed }: { confirmed: boolean }) {
  const user = {
    id: 'u1',
    email: 'a@example.com',
    email_confirmed_at: confirmed ? '2026-01-01' : null,
  } as unknown as User
  vi.mocked(useAuth).mockReturnValue({
    session: null,
    user,
    isLoading: false,
    isConfirmed: confirmed,
    signOut: vi.fn(),
  })
}

describe('MyCoastersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows the list placeholder for confirmed users', () => {
    mockAuth({ confirmed: true })
    render(<MyCoastersPage />)
    expect(screen.getByText(/drag-sort editor arrives in phase 5/i)).toBeInTheDocument()
  })

  it('gates unconfirmed users behind email confirmation', () => {
    mockAuth({ confirmed: false })
    render(<MyCoastersPage />)
    expect(screen.getByText('Confirm your email')).toBeInTheDocument()
    expect(screen.queryByText(/drag-sort editor/i)).not.toBeInTheDocument()
  })

  it('lets unconfirmed users resend the confirmation email', async () => {
    mockAuth({ confirmed: false })
    vi.mocked(supabase.auth.resend).mockResolvedValue({ data: {}, error: null } as never)
    render(<MyCoastersPage />)

    await userEvent.click(screen.getByRole('button', { name: /resend confirmation email/i }))

    expect(supabase.auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@example.com' })
    expect(await screen.findByText('Confirmation email sent')).toBeInTheDocument()
  })
})
