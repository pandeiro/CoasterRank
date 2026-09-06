import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import LoginPage from './LoginPage'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      resend: vi.fn(),
    },
  },
}))

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

function renderLogin(initialPath = '/login') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/me" element={<p>my coasters</p>} />
        <Route path="/riders/:username" element={<p>rider page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({ session: null, isLoading: false } as never)
  })

  it('logs in and navigates to /me', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: {},
      error: null,
    } as never)
    renderLogin()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret1')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    await waitFor(() => {
      expect(screen.getByText('my coasters')).toBeInTheDocument()
    })
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'a@example.com',
      password: 'secret1',
    })
  })

  it('maps invalid credentials to a friendlier message', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: {},
      error: { message: 'Invalid login credentials' },
    } as never)
    renderLogin()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument()
    expect(screen.queryByText('Invalid login credentials')).not.toBeInTheDocument()
  })

  it('shows the confirmed banner after email confirmation', async () => {
    renderLogin('/login?confirmed=1')
    expect(await screen.findByText(/email confirmed/i)).toBeInTheDocument()
  })

  it('forwards freshly confirmed users to the welcome nudge', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      isLoading: false,
    } as never)
    renderLogin('/login?confirmed=1')
    await waitFor(() => {
      expect(screen.getByText('my coasters')).toBeInTheDocument()
    })
  })

  it('preserves the deep link encoded in next through the email round-trip', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      isLoading: false,
    } as never)
    renderLogin('/login?confirmed=1&next=%2Friders%2Fana')
    await waitFor(() => {
      expect(screen.getByText('rider page')).toBeInTheDocument()
    })
  })

  it('offers to resend the confirmation email when email is unconfirmed', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: {},
      error: { message: 'Email not confirmed' },
    } as never)
    vi.mocked(supabase.auth.resend).mockResolvedValue({ data: {}, error: null } as never)
    renderLogin()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret1')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    const resend = await screen.findByRole('button', { name: /resend confirmation email/i })
    await userEvent.click(resend)

    expect(supabase.auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@example.com' })
    expect(await screen.findByText('Confirmation email sent.')).toBeInTheDocument()
  })
})
