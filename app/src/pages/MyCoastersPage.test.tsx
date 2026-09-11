import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMyRides } from '../lib/rides'
import { fetchProfile } from '../lib/profile'
import { useAuth } from '../lib/auth-context'
import { dismissShareNudge, useShareNudge } from '../lib/share-nudge'
import { readWelcomeDismissed } from '../lib/welcome'
import MyCoastersPage from './MyCoastersPage'

// jsdom has no IntersectionObserver; the page only needs it to no-op here.
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

vi.mock('../lib/rides', () => ({
  useMyRides: vi.fn(),
}))

vi.mock('../lib/profile', () => ({
  fetchProfile: vi.fn(),
}))

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../components/CoasterSearchBar', () => ({
  default: ({ onAdd }: { onAdd: (id: string, name: string) => void }) => (
    <button type="button" data-testid="search-bar" onClick={() => onAdd('c9', 'New Coaster')}>
      search
    </button>
  ),
}))

type MockListProps = {
  rides: unknown[]
  quickInsert?: 'top' | 'bottom' | null
  onPendingClear?: () => void
  onInserted?: (id: string, name: string, rank: number) => void
  onError?: (message: string) => void
}

// Value of quickInsert the mock list last consumed — the transient prop is
// reset as soon as the request is handled, so tests assert on this instead.
let consumedQuickInsert: 'top' | 'bottom' | null = null

vi.mock('../components/RankedCoasterList', async () => {
  const { useEffect } = await import('react')
  function MockRankedCoasterList(props: MockListProps) {
    // Simulate the real list consuming a one-shot quickInsert request.
    useEffect(() => {
      if (props.quickInsert) {
        consumedQuickInsert = props.quickInsert
        props.onPendingClear?.()
      }
    }, [props])
    return (
      <div data-testid="ranked-list">
        {props.rides.length} items
        <button type="button" onClick={() => props.onInserted?.('c9', 'New Coaster', 3)}>
          fire-inserted
        </button>
        <button type="button" onClick={() => props.onError?.('Something failed')}>
          fire-error
        </button>
      </div>
    )
  }
  return { default: MockRankedCoasterList }
})

vi.mock('../components/ConfirmEmailGate', () => ({
  default: ({ email }: { email?: string }) => <div data-testid="confirm-gate">{email}</div>,
}))

vi.mock('../components/WelcomeModal', () => ({
  default: ({ onClose, username }: { onClose: () => void; username: string | null }) => (
    <div data-testid="welcome-modal">
      welcome{username ? ` ${username}` : ''}
      <button type="button" onClick={onClose}>
        start ranking
      </button>
    </div>
  ),
}))

vi.mock('../lib/welcome', () => ({
  readWelcomeDismissed: vi.fn(() => false),
  persistWelcomeDismissed: vi.fn(),
  WELCOME_DISMISS_KEY: 'cr.welcome.dismissed',
}))

vi.mock('../lib/share-nudge', () => ({
  useShareNudge: vi.fn(),
  dismissShareNudge: vi.fn(),
}))

function renderPage(initialPath = '/me') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialPath]}>
        <MyCoastersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockConfirmed(ridesData: unknown[] = [], userId: string | null = null) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: userId, email: 'test@example.com' },
    isConfirmed: true,
  } as never)
  vi.mocked(useMyRides).mockReturnValue({
    data: ridesData,
    isPending: false,
    isError: false,
  } as never)
  vi.mocked(fetchProfile).mockResolvedValue({
    id: 'u1',
    username: 'coaster_fan',
    display_name: null,
    avatar_url: null,
    is_admin: false,
    og_image_url: null,
    public_list: true,
  })
  // Default: no eligible nudge (the page hides the banner unless the RPC
  // claims eligibility for this exact call).
  vi.mocked(useShareNudge).mockReturnValue({
    data: { eligible: false, ranked_count: 0 },
  } as never)
}

function ridesWithRanks(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    coaster_id: `c${i + 1}`,
    rank: i + 1,
    coaster: {
      id: `c${i + 1}`,
      name: `Coaster ${i + 1}`,
      slug: `coaster-${i + 1}`,
      status: 'operating',
      material: 'steel',
      park_id: 'p1',
    },
  }))
}

describe('MyCoastersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(readWelcomeDismissed).mockReturnValue(false)
    consumedQuickInsert = null
    window.localStorage.clear()
  })

  it('shows the email gate when not confirmed', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { email: 'test@example.com' },
      isConfirmed: false,
    } as never)
    vi.mocked(useMyRides).mockReturnValue({ data: [], isPending: false, isError: false } as never)
    vi.mocked(useShareNudge).mockReturnValue({
      data: { eligible: false, ranked_count: 0 },
    } as never)
    renderPage()
    expect(screen.getByTestId('confirm-gate')).toBeInTheDocument()
    expect(screen.queryByTestId('search-bar')).not.toBeInTheDocument()
  })

  it('shows the search bar and list when confirmed', () => {
    mockConfirmed()
    renderPage()
    expect(screen.getByTestId('search-bar')).toBeInTheDocument()
    expect(screen.getByTestId('ranked-list')).toBeInTheDocument()
    expect(screen.queryByTestId('confirm-gate')).not.toBeInTheDocument()
  })

  it('shows loading state', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { email: 'test@example.com' },
      isConfirmed: true,
    } as never)
    vi.mocked(useMyRides).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as never)
    renderPage()
    expect(screen.getByText(/loading your rides/i)).toBeInTheDocument()
  })

  it('shows error state', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { email: 'test@example.com' },
      isConfirmed: true,
    } as never)
    vi.mocked(useMyRides).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    } as never)
    renderPage()
    expect(screen.getByText(/couldn't load your rides/i)).toBeInTheDocument()
  })

  it('shows ranked count when rides exist', () => {
    mockConfirmed([
      {
        coaster_id: 'c1',
        rank: 1,
        coaster: {
          id: 'c1',
          name: 'A',
          slug: 'a',
          status: 'operating',
          material: 'steel',
          park_id: 'p1',
        },
      },
      {
        coaster_id: 'c2',
        rank: 2,
        coaster: {
          id: 'c2',
          name: 'B',
          slug: 'b',
          status: 'operating',
          material: 'wood',
          park_id: 'p1',
        },
      },
    ])
    renderPage()
    expect(screen.getByText('2 coasters ranked')).toBeInTheDocument()
  })

  it('enters pending-add mode from the search bar and can cancel', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    renderPage()
    await user.click(screen.getByTestId('search-bar'))
    expect(screen.getByText('New Coaster')).toBeInTheDocument()
    expect(screen.getByText(/choose a position below/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(screen.queryByText(/choose a position below/i)).not.toBeInTheDocument()
  })

  it('offers add-to-top/bottom pills in pending-add mode', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    renderPage()
    await user.click(screen.getByTestId('search-bar'))
    expect(screen.getByRole('button', { name: 'Add to top' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to bottom' })).toBeInTheDocument()
  })

  it('routes a quickInsert request through the list and leaves pending mode', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    renderPage()
    await user.click(screen.getByTestId('search-bar'))
    await user.click(screen.getByRole('button', { name: 'Add to bottom' }))
    await waitFor(() => expect(consumedQuickInsert).toBe('bottom'))
    // The list consumed the request, so pending-add mode is over.
    await waitFor(() =>
      expect(screen.queryByText(/choose a position below/i)).not.toBeInTheDocument(),
    )
  })

  it('shows a success toast with rank when a coaster is inserted', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'fire-inserted' }))
    expect(await screen.findByText('Added New Coaster at #3')).toBeInTheDocument()
  })

  it('shows an error toast when the list reports a failure', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    renderPage()
    await user.click(screen.getByRole('button', { name: 'fire-error' }))
    expect(await screen.findByText('Something failed')).toBeInTheDocument()
  })

  it('shows the one-shot share nudge above the list when the RPC claims eligibility', async () => {
    mockConfirmed(ridesWithRanks(9))
    vi.mocked(useShareNudge).mockReturnValue({
      data: { eligible: true, ranked_count: 9 },
    } as never)
    renderPage()
    expect(await screen.findByTestId('share-nudge-banner')).toBeInTheDocument()
    expect(screen.getByText(/9 ranked/)).toBeInTheDocument()
  })

  it('shows no share nudge when the RPC reports not eligible', () => {
    mockConfirmed(ridesWithRanks(9))
    vi.mocked(useShareNudge).mockReturnValue({
      data: { eligible: false, ranked_count: 9 },
    } as never)
    renderPage()
    expect(screen.queryByTestId('share-nudge-banner')).not.toBeInTheDocument()
  })

  it('hides the share nudge for the rest of the session after dismissal', async () => {
    const user = userEvent.setup()
    mockConfirmed(ridesWithRanks(9), 'u1')
    vi.mocked(useShareNudge).mockReturnValue({
      data: { eligible: true, ranked_count: 9 },
    } as never)
    renderPage()
    await user.click(await screen.findByRole('button', { name: /not right now/i }))
    expect(screen.queryByTestId('share-nudge-banner')).not.toBeInTheDocument()
    // Dismissal must also reach the shareNudge cache: the staleTime Infinity
    // verdict otherwise resurrects the banner on the next /me remount.
    expect(vi.mocked(dismissShareNudge)).toHaveBeenCalledWith(expect.anything(), 'u1')
  })

  it('shows the welcome nudge on ?welcome=1 for users with nothing ranked', () => {
    mockConfirmed([], 'u1')
    renderPage('/me?welcome=1')
    expect(screen.getByTestId('welcome-modal')).toBeInTheDocument()
  })

  it('hides the welcome nudge without the welcome param even when never dismissed', () => {
    mockConfirmed([], 'u1')
    renderPage('/me')
    expect(screen.queryByTestId('welcome-modal')).not.toBeInTheDocument()
  })

  it('stays hidden on ?welcome=1 after a previous dismissal (e.g. back-button revisit)', () => {
    vi.mocked(readWelcomeDismissed).mockReturnValue(true)
    mockConfirmed([], 'u1')
    renderPage('/me?welcome=1')
    expect(screen.queryByTestId('welcome-modal')).not.toBeInTheDocument()
  })
  it('hides the welcome nudge once the user has ranked something', () => {
    mockConfirmed(ridesWithRanks(2), 'u1')
    renderPage('/me?welcome=1')
    expect(screen.queryByTestId('welcome-modal')).not.toBeInTheDocument()
  })

  it('dismissing the welcome nudge persists and clears the param', async () => {
    const user = userEvent.setup()
    const { persistWelcomeDismissed } = await import('../lib/welcome')
    mockConfirmed([], 'u1')
    renderPage('/me?welcome=1')
    await user.click(screen.getByRole('button', { name: /start ranking/i }))
    expect(vi.mocked(persistWelcomeDismissed)).toHaveBeenCalled()
    expect(screen.queryByTestId('welcome-modal')).not.toBeInTheDocument()
  })
})
