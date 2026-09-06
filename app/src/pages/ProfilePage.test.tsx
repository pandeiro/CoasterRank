import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { User } from '@supabase/supabase-js'
import ProfilePage from './ProfilePage'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

const selectSingle = vi.fn()
const updateSpy = vi.fn()
const updateEq = vi.fn()

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: () => ({ eq: () => ({ single: selectSingle }) }),
      update: updateSpy,
    })),
  },
}))

const fakeUser = { id: 'u1', email: 'a@example.com' } as User

const fakeProfile = {
  id: 'u1',
  username: 'coaster_fan',
  display_name: 'Coaster Fan',
  avatar_url: 'https://img.test/avatar.jpg',
  is_admin: false,
  public_list: false,
  og_image_url: null,
}

function renderProfile() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ProfilePage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('ProfilePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    updateSpy.mockReturnValue({ eq: updateEq })
    vi.mocked(useAuth).mockReturnValue({
      session: null,
      user: fakeUser,
      isLoading: false,
      isConfirmed: true,
      signOut: vi.fn(),
    })
    selectSingle.mockResolvedValue({ data: fakeProfile, error: null })
  })

  it('loads the profile into the form', async () => {
    renderProfile()
    expect(await screen.findByDisplayValue('coaster_fan')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Coaster Fan')).toBeInTheDocument()
  })

  it('saves edits and confirms', async () => {
    updateEq.mockResolvedValue({ error: null })
    renderProfile()

    const username = await screen.findByDisplayValue('coaster_fan')
    await userEvent.clear(username)
    await userEvent.type(username, 'new_handle')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(updateEq).toHaveBeenCalled()
    })
    expect(vi.mocked(supabase.from)).toHaveBeenCalledWith('profiles')
    expect(await screen.findByText('Saved.')).toBeInTheDocument()
  })

  it('surfaces a taken username as a friendly error', async () => {
    updateEq.mockResolvedValue({ error: { code: '23505', message: 'duplicate key' } })
    renderProfile()

    await screen.findByDisplayValue('coaster_fan')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('That username is taken.')).toBeInTheDocument()
  })

  it('shows the public page URL only after the share toggle is on', async () => {
    renderProfile()
    await screen.findByDisplayValue('coaster_fan')

    expect(
      screen.queryByText(`${window.location.origin}/riders/coaster_fan`),
    ).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText(/share my ranking/i))

    expect(screen.getByText(`${window.location.origin}/riders/coaster_fan`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('renders avatar badges for changing and removing the photo', async () => {
    renderProfile()
    await screen.findByDisplayValue('coaster_fan')

    expect(screen.getByRole('button', { name: /change profile photo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove profile photo/i })).toBeInTheDocument()
  })

  it('persists the public-list toggle in the update payload', async () => {
    updateEq.mockResolvedValue({ error: null })
    renderProfile()
    await screen.findByDisplayValue('coaster_fan')

    await userEvent.click(screen.getByLabelText(/share my ranking/i))
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await screen.findByText(/view your public page/i)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ username: 'coaster_fan', public_list: true }),
    )
  })
})
