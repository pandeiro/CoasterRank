import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import SignupPage from './SignupPage'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signUp: vi.fn(),
    },
  },
}))

function renderSignup() {
  return render(
    <MemoryRouter>
      <SignupPage />
    </MemoryRouter>,
  )
}

async function fillAndSubmit(username: string) {
  await userEvent.type(screen.getByLabelText(/username/i), username)
  await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
  await userEvent.type(screen.getByLabelText(/password/i), 'secret1')
  await userEvent.click(screen.getByRole('button', { name: /create account/i }))
}

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects invalid usernames client-side without calling Supabase', async () => {
    renderSignup()
    await fillAndSubmit('Bad Name!')
    expect(await screen.findByText(/username must be/i)).toBeInTheDocument()
    expect(supabase.auth.signUp).not.toHaveBeenCalled()
  })

  it('passes username/display_name through signup metadata', async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { session: null, user: { id: 'u1' } },
      error: null,
    } as never)
    renderSignup()
    await fillAndSubmit('coaster_fan')

    expect(supabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'a@example.com',
        password: 'secret1',
        options: expect.objectContaining({
          data: { username: 'coaster_fan', display_name: 'coaster_fan' },
        }),
      }),
    )
  })

  it('shows the check-your-email panel when confirmation is required', async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { session: null, user: { id: 'u1' } },
      error: null,
    } as never)
    renderSignup()
    await fillAndSubmit('coaster_fan')

    expect(await screen.findByText('Check your email')).toBeInTheDocument()
  })

  it('shows the server error on failure', async () => {
    vi.mocked(supabase.auth.signUp).mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'Password should be at least 6 characters' },
    } as never)
    renderSignup()
    await fillAndSubmit('coaster_fan')

    expect(await screen.findByText('Password should be at least 6 characters')).toBeInTheDocument()
  })
})
