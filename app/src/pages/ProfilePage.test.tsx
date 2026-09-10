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

  it('maps a reserved-list CHECK hit (deploy skew / API caller) to a friendly error', async () => {
    updateEq.mockResolvedValue({
      error: {
        code: '23514',
        message: 'new row violates check constraint "profiles_username_reserved_check"',
      },
    })
    renderProfile()

    await screen.findByDisplayValue('coaster_fan')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('That username is reserved.')).toBeInTheDocument()
  })

  it('maps any other CHECK hit to a generic invalid-username error', async () => {
    updateEq.mockResolvedValue({
      error: {
        code: '23514',
        message: 'new row violates check constraint "profiles_username_format_check"',
      },
    })
    renderProfile()

    await screen.findByDisplayValue('coaster_fan')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('That username is invalid.')).toBeInTheDocument()
  })

  it('publishes immediately when the share toggle is checked — no Save required', async () => {
    updateEq.mockResolvedValue({ error: null })
    renderProfile()
    await screen.findByDisplayValue('coaster_fan')

    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument()

    // After the optimistic toggle the refetch should keep the public flag on
    // (the server now has it); otherwise the invalidation would revert the UI.
    selectSingle.mockResolvedValue({
      data: { ...fakeProfile, public_list: true },
      error: null,
    })

    await userEvent.click(screen.getByLabelText(/share my ranking/i))

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ public_list: true }))
    })
    // Optimistic update makes the copyable link appear instantly; the URL was
    // never copyable pre-Save, so unfurlers never see a 404.
    expect(await screen.findByText(`${window.location.origin}/@coaster_fan`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('shows the copyable link immediately when sharing is already persisted', async () => {
    selectSingle.mockResolvedValue({
      data: { ...fakeProfile, public_list: true },
      error: null,
    })
    renderProfile()
    await screen.findByDisplayValue('coaster_fan')

    expect(screen.getByText(`${window.location.origin}/@coaster_fan`)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
  })

  it('rejects claiming a reserved username with a friendly error', async () => {
    updateEq.mockResolvedValue({ error: null })
    renderProfile()
    await screen.findByDisplayValue('coaster_fan')

    const username = screen.getByDisplayValue('coaster_fan')
    await userEvent.clear(username)
    await userEvent.type(username, 'admin')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('That username is reserved.')).toBeInTheDocument()
    expect(updateEq).not.toHaveBeenCalled()
  })

  it('lets a grandfathered reserved username save unchanged', async () => {
    selectSingle.mockResolvedValue({
      data: { ...fakeProfile, username: 'admin' },
      error: null,
    })
    updateEq.mockResolvedValue({ error: null })
    renderProfile()
    await screen.findByDisplayValue('admin')

    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Saved.')).toBeInTheDocument()
    expect(updateEq).toHaveBeenCalled()
  })

  it('renders avatar badges for changing and removing the photo', async () => {
    renderProfile()
    await screen.findByDisplayValue('coaster_fan')

    expect(screen.getByRole('button', { name: /change profile photo/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove profile photo/i })).toBeInTheDocument()
  })

  it('does not bundle sharing into the Save payload — the toggle saves itself', async () => {
    updateEq.mockResolvedValue({ error: null })
    // Start privately, then publish via the immediate toggle.
    renderProfile()
    await screen.findByDisplayValue('coaster_fan')

    selectSingle.mockResolvedValue({
      data: { ...fakeProfile, public_list: true },
      error: null,
    })
    await userEvent.click(screen.getByLabelText(/share my ranking/i))
    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ public_list: true }))
    })
    vi.clearAllMocks()
    updateSpy.mockReturnValue({ eq: updateEq })

    // Now change the username and Save — the payload should only carry the
    // name fields, not public_list (which is already live).
    const username = screen.getByDisplayValue('coaster_fan')
    await userEvent.clear(username)
    await userEvent.type(username, 'new_handle')
    await userEvent.click(screen.getByRole('button', { name: /save/i }))

    await screen.findByText('Saved.')
    const lastPayload = vi.mocked(updateSpy).mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(lastPayload).toEqual(expect.objectContaining({ username: 'new_handle' }))
    expect(lastPayload).not.toHaveProperty('public_list')
  })
})
