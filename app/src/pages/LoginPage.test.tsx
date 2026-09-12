import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import LoginPage from './LoginPage'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth-context'

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      resend: vi.fn(),
      updateUser: vi.fn(),
    },
    rpc: vi.fn(),
    // Not hit without guest state, but the guest-promotion lib imports it.
    from: vi.fn(),
  },
}))

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

function renderLogin(initialPath = '/login') {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/me" element={<p>my coasters</p>} />
          <Route path="/riders/:username" element={<p>rider page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
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

    expect(supabase.auth.resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'a@example.com',
      options: { emailRedirectTo: expect.stringContaining('/login?confirmed=1') },
    })
    expect(await screen.findByText('Confirmation email sent.')).toBeInTheDocument()
  })

  it('links to the forgot-password flow', () => {
    renderLogin()
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute(
      'href',
      '/forgot-password',
    )
  })

  it('requires an email before requesting a sign-in link', async () => {
    renderLogin()
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))

    expect(await screen.findByText(/enter your email above first/i)).toBeInTheDocument()
    expect(supabase.auth.signInWithOtp).not.toHaveBeenCalled()
  })

  it('requests a magic link and swaps to the code-entry panel', async () => {
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never)
    renderLogin()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))

    await waitFor(() => {
      expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
        email: 'a@example.com',
        options: { emailRedirectTo: expect.stringContaining('/login?magic=1') },
      })
    })
    expect(await screen.findByText(/check your email/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/sign-in code/i)).toBeInTheDocument()
  })

  it('signs in with the emailed code', async () => {
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never)
    vi.mocked(supabase.auth.verifyOtp).mockResolvedValue({ data: {}, error: null } as never)
    renderLogin()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))
    const codeInput = await screen.findByLabelText(/sign-in code/i)
    await userEvent.type(codeInput, '12345678')
    await userEvent.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => {
      expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
        email: 'a@example.com',
        token: '12345678',
        type: 'email',
      })
    })
    expect(await screen.findByText('my coasters')).toBeInTheDocument()
  })

  it('keeps only digits in the code field', async () => {
    vi.mocked(supabase.auth.signInWithOtp).mockResolvedValue({ data: {}, error: null } as never)
    renderLogin()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.click(screen.getByRole('button', { name: /email me a sign-in link/i }))
    const codeInput = await screen.findByLabelText(/sign-in code/i)
    await userEvent.type(codeInput, '12ab34')

    expect(codeInput).toHaveValue('1234')
  })

  it('shows the invited banner for invite-link arrivals', () => {
    renderLogin('/login?invited=1')
    expect(screen.getByText(/invite accepted — welcome aboard/i)).toBeInTheDocument()
  })

  it('forwards invited users straight to /me when the exchange lands', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      isLoading: false,
    } as never)
    renderLogin('/login?invited=1')
    await waitFor(() => {
      expect(screen.getByText('my coasters')).toBeInTheDocument()
    })
  })

  it('surfaces a resend failure instead of failing silently (resend cooldown 429)', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: {},
      error: { message: 'Email not confirmed' },
    } as never)
    vi.mocked(supabase.auth.resend).mockResolvedValue({
      data: {},
      error: { message: 'rate limited' },
    } as never)
    renderLogin()

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret1')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    const resend = await screen.findByRole('button', { name: /resend confirmation email/i })
    await userEvent.click(resend)

    expect(await screen.findByText(/couldn't resend/i)).toBeInTheDocument()
    expect(screen.queryByText('Confirmation email sent.')).not.toBeInTheDocument()
  })

  it('encodes the deep link into the resend redirect', async () => {
    vi.mocked(supabase.auth.signInWithPassword).mockResolvedValue({
      data: {},
      error: { message: 'Email not confirmed' },
    } as never)
    vi.mocked(supabase.auth.resend).mockResolvedValue({ data: {}, error: null } as never)
    renderLogin('/login?next=%2Friders%2Fana')

    await userEvent.type(screen.getByLabelText(/email/i), 'a@example.com')
    await userEvent.type(screen.getByLabelText(/password/i), 'secret1')
    await userEvent.click(screen.getByRole('button', { name: /log in/i }))

    const resend = await screen.findByRole('button', { name: /resend confirmation email/i })
    await userEvent.click(resend)

    const arg = vi.mocked(supabase.auth.resend).mock.calls[0][0] as {
      options?: { emailRedirectTo?: string }
    }
    expect(arg.options?.emailRedirectTo).toContain(encodeURIComponent('/riders/ana'))
  })
})

// ── Guest promotion gate (GUEST_UX.md §4.2/§4.4, review round 2 B/C/E)

import { writeGuestRanking, type GuestRankingState } from '../lib/guest-rides'

function seedGuestState(ids: string[], createdAt = 1_757_600_000_000) {
  const state: GuestRankingState = {
    version: 1,
    orderedIds: ids,
    items: Object.fromEntries(
      ids.map((id) => [
        id,
        {
          coaster_id: id,
          name: `Coaster ${id}`,
          slug: id,
          park_id: null,
          park_slug: null,
          park_name: null,
          park_country: null,
          manufacturer_name: null,
          material: 'steel',
          status: 'operating',
          board_rank: null,
          added_at: createdAt,
        },
      ]),
    ),
    orderLocked: false,
    createdAt,
    updatedAt: createdAt,
  }
  writeGuestRanking(state)
}

function mockRidesQuery(rows: { coaster_id: string; rank: number | null }[]) {
  vi.mocked(supabase.from).mockReturnValue({
    select: () => ({
      not: () => ({
        order: () => ({
          range: () => Promise.resolve({ data: rows, error: null }),
        }),
      }),
    }),
  } as never)
}

describe('LoginPage guest promotion gate', () => {
  beforeEach(() => {
    // Call counts accumulate across tests otherwise (shared module mocks).
    vi.clearAllMocks()
    window.localStorage.clear()
    vi.mocked(supabase.auth.updateUser).mockResolvedValue({
      data: { user: {} },
      error: null,
    } as never)
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 2, error: null } as never)
  })

  it('holds navigation while a pending payload materializes, then wipes it (review B)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      user: {
        id: 'u1',
        user_metadata: {
          pending_guest_rides: { ids: ['g1', 'g2'], started_at: '2026-09-11T00:00:00.000Z' },
        },
      },
      isLoading: false,
    } as never)
    renderLogin('/login?confirmed=1')
    await waitFor(() => {
      expect(screen.getByText('my coasters')).toBeInTheDocument()
    })
    expect(supabase.rpc).toHaveBeenCalledWith('materialize_guest_rides', {
      p_rides: ['g1', 'g2'],
      p_kind: 'materialize',
      p_started_at: '2026-09-11T00:00:00.000Z',
    })
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      data: { pending_guest_rides: null },
    })
    // The local list is consumed too.
    expect(window.localStorage.getItem('cr.guest-rides.v1')).toBeNull()
  })

  it('treats the stale errcode as wipe-and-continue (review E)', async () => {
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      user: {
        id: 'u1',
        user_metadata: {
          pending_guest_rides: { ids: ['g1'], started_at: '2026-09-11T00:00:00.000Z' },
        },
      },
      isLoading: false,
    } as never)
    vi.mocked(supabase.rpc).mockResolvedValue({
      data: null,
      error: { code: 'PGRD1', message: 'stale' },
    } as never)
    renderLogin('/login?confirmed=1')
    await waitFor(() => {
      expect(screen.getByText('my coasters')).toBeInTheDocument()
    })
    // Materialize was attempted once; the wipe still ran; the user landed.
    expect(supabase.rpc).toHaveBeenCalledTimes(1)
    expect(supabase.auth.updateUser).toHaveBeenCalledWith({
      data: { pending_guest_rides: null },
    })
  })

  it('shows the merge modal for a local guest list and holds navigation (review C)', async () => {
    seedGuestState(['g1', 'g2'])
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      user: { id: 'u1', user_metadata: {} },
      isLoading: false,
    } as never)
    mockRidesQuery([{ coaster_id: 'r1', rank: 1 }])
    renderLogin('/login')
    const dialog = await screen.findByRole('dialog', { name: /merge your guest ranking/i })
    expect(dialog).toBeInTheDocument()
    // Navigation is held until a choice is made.
    expect(screen.queryByText('my coasters')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /discard session/i }))
    await waitFor(() => {
      expect(screen.getByText('my coasters')).toBeInTheDocument()
    })
    expect(supabase.rpc).toHaveBeenCalledWith('log_guest_merge_decision', {
      p_kind: 'merge_discard',
    })
    expect(window.localStorage.getItem('cr.guest-rides.v1')).toBeNull()
  })

  it('append submits the COMPLETE merged ladder (review round 1, blocker 2)', async () => {
    seedGuestState(['g1', 'g2'])
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      user: { id: 'u1', user_metadata: {} },
      isLoading: false,
    } as never)
    mockRidesQuery([{ coaster_id: 'r1', rank: 1 }])
    renderLogin('/login')
    await screen.findByRole('dialog', { name: /merge your guest ranking/i })
    await userEvent.click(screen.getByRole('button', { name: /add 2 to the bottom/i }))
    await waitFor(() => {
      expect(screen.getByText('my coasters')).toBeInTheDocument()
    })
    expect(supabase.rpc).toHaveBeenCalledWith('materialize_guest_rides', {
      p_rides: ['r1', 'g1', 'g2'],
      p_kind: 'merge_append',
      p_started_at: new Date(1_757_600_000_000).toISOString(),
    })
    expect(window.localStorage.getItem('cr.guest-rides.v1')).toBeNull()
  })

  it('silently clears a guest list that adds nothing new (§4.4 Rule 4)', async () => {
    seedGuestState(['r1'])
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      user: { id: 'u1', user_metadata: {} },
      isLoading: false,
    } as never)
    mockRidesQuery([{ coaster_id: 'r1', rank: 1 }])
    renderLogin('/login')
    await waitFor(() => {
      expect(screen.getByText('my coasters')).toBeInTheDocument()
    })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(supabase.rpc).not.toHaveBeenCalledWith('materialize_guest_rides', expect.anything())
    expect(window.localStorage.getItem('cr.guest-rides.v1')).toBeNull()
  })

  it('materializes directly when the account has zero ranked rides (seed mode)', async () => {
    seedGuestState(['g1'])
    vi.mocked(useAuth).mockReturnValue({
      session: { access_token: 'tok' },
      user: { id: 'u1', user_metadata: {} },
      isLoading: false,
    } as never)
    mockRidesQuery([])
    renderLogin('/login')
    await waitFor(() => {
      expect(screen.getByText('my coasters')).toBeInTheDocument()
    })
    expect(supabase.rpc).toHaveBeenCalledWith('materialize_guest_rides', {
      p_rides: ['g1'],
      p_kind: 'materialize',
      p_started_at: new Date(1_757_600_000_000).toISOString(),
    })
  })
})
