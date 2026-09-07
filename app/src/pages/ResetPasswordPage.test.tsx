import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ResetPasswordPage from './ResetPasswordPage'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      updateUser: vi.fn(),
    },
  },
}))

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

function renderReset(initialPath = '/reset-password') {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/forgot-password" element={<p>forgot page</p>} />
        <Route path="/me" element={<p>my coasters</p>} />
        <Route path="/riders/:username" element={<p>rider page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      isLoading: false,
    } as never)
  })

  it('bounces to forgot-password when no recovery session exists', async () => {
    vi.mocked(useAuth).mockReturnValue({ session: null, isLoading: false } as never)
    renderReset()
    expect(await screen.findByText('forgot page')).toBeInTheDocument()
    expect(screen.queryByLabelText(/new password/i)).not.toBeInTheDocument()
  })

  it('shows a checking state while the session restores', () => {
    vi.mocked(useAuth).mockReturnValue({ session: null, isLoading: true } as never)
    renderReset()
    expect(screen.getByText(/checking your reset link/i)).toBeInTheDocument()
  })

  it('saves the new password and forwards to /me', async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: {}, error: null } as never)
    renderReset()

    await userEvent.type(screen.getByLabelText('New password'), 'freshpw1')
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'freshpw1')
    await userEvent.click(screen.getByRole('button', { name: /save password/i }))

    await waitFor(() => {
      expect(supabase.auth.updateUser).toHaveBeenCalledWith({ password: 'freshpw1' })
    })
    expect(await screen.findByText('my coasters')).toBeInTheDocument()
  })

  it('forwards to the preserved deep link after saving', async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({ data: {}, error: null } as never)
    renderReset('/reset-password?next=%2Friders%2Fana')

    await userEvent.type(screen.getByLabelText('New password'), 'freshpw1')
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'freshpw1')
    await userEvent.click(screen.getByRole('button', { name: /save password/i }))

    expect(await screen.findByText('rider page')).toBeInTheDocument()
  })

  it('rejects mismatched confirmations', async () => {
    renderReset()

    await userEvent.type(screen.getByLabelText('New password'), 'freshpw1')
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'freshpw2')
    await userEvent.click(screen.getByRole('button', { name: /save password/i }))

    expect(await screen.findByText("Passwords don't match.")).toBeInTheDocument()
    expect(supabase.auth.updateUser).not.toHaveBeenCalled()
  })

  it('rejects short passwords', async () => {
    renderReset()

    await userEvent.type(screen.getByLabelText('New password'), 'abc')
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'abc')
    await userEvent.click(screen.getByRole('button', { name: /save password/i }))

    expect(await screen.findByText('Passwords must be at least 6 characters.')).toBeInTheDocument()
    expect(supabase.auth.updateUser).not.toHaveBeenCalled()
  })

  it('surfaces provider errors', async () => {
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: {},
      error: { message: 'New password should be different from the old password.' },
    } as never)
    renderReset()

    await userEvent.type(screen.getByLabelText('New password'), 'freshpw1')
    await userEvent.type(screen.getByLabelText(/confirm new password/i), 'freshpw1')
    await userEvent.click(screen.getByRole('button', { name: /save password/i }))

    expect(await screen.findByText(/should be different from the old password/)).toBeInTheDocument()
  })
})
