import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useIsAdmin } from './useIsAdmin'
import { useAuth } from './auth-context'
import { fetchProfile } from './profile'

vi.mock('./auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./auth-context')>()
  return { ...actual, useAuth: vi.fn() }
})

vi.mock('./profile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./profile')>()
  return { ...actual, fetchProfile: vi.fn() }
})

function Probe() {
  return <div data-testid="probe">{useIsAdmin() ? 'admin' : 'not-admin'}</div>
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={queryClient}>
      <Probe />
    </QueryClientProvider>,
  )
}

describe('useIsAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('is false for anonymous visitors without fetching a profile', async () => {
    vi.mocked(useAuth).mockReturnValue({ session: null } as never)
    renderProbe()
    expect(await screen.findByTestId('probe')).toHaveTextContent('not-admin')
    expect(fetchProfile).not.toHaveBeenCalled()
  })

  it('is true when the profile has the admin flag', async () => {
    vi.mocked(useAuth).mockReturnValue({ session: { user: { id: 'u1' } } } as never)
    vi.mocked(fetchProfile).mockResolvedValue({ is_admin: true } as never)
    renderProbe()
    expect(await screen.findByText('admin')).toBeInTheDocument()
    await waitFor(() => expect(fetchProfile).toHaveBeenCalledWith('u1'))
  })

  it('is false for authed non-admins', async () => {
    vi.mocked(useAuth).mockReturnValue({ session: { user: { id: 'u2' } } } as never)
    vi.mocked(fetchProfile).mockResolvedValue({ is_admin: false } as never)
    renderProbe()
    expect(await screen.findByTestId('probe')).toHaveTextContent('not-admin')
  })
})
