import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ForgotPasswordPage from './ForgotPasswordPage'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn(),
    },
  },
}))

function renderForgot(state?: { from?: string }) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/forgot-password', state }]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<p>login page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the reset link to the public /reset-password landing page', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: null,
    } as never)
    renderForgot()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('a@example.com', {
        redirectTo: expect.stringContaining('/reset-password'),
      })
    })
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
  })

  it('preserves a stashed deep link as next on the recovery redirect', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: null,
    } as never)
    renderForgot({ from: '/riders/ana' })

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    await waitFor(() => {
      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith('a@example.com', {
        redirectTo: expect.stringContaining('next=%2Friders%2Fana'),
      })
    })
  })

  it('shows a neutral check-email panel (no account enumeration)', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: null,
    } as never)
    renderForgot()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    const panel = await screen.findByText(/has a CoasterRank account/i)
    expect(panel).toBeInTheDocument()
  })

  it('surfaces provider errors', async () => {
    vi.mocked(supabase.auth.resetPasswordForEmail).mockResolvedValue({
      data: {},
      error: { message: 'Rate limit exceeded' },
    } as never)
    renderForgot()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: /send reset link/i }))

    expect(await screen.findByText('Rate limit exceeded')).toBeInTheDocument()
    expect(screen.queryByText(/check your email/i)).not.toBeInTheDocument()
  })
})
