import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMyRides } from '../lib/rides'
import { fetchProfile } from '../lib/profile'
import { useAuth } from '../lib/auth-context'
import MyCoastersPage from './MyCoastersPage'

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

vi.mock('../components/RankedCoasterList', () => ({
  default: ({
    rides,
    onInserted,
    onError,
  }: {
    rides: unknown[]
    onInserted?: (id: string, name: string, rank: number) => void
    onError?: (message: string) => void
  }) => (
    <div data-testid="ranked-list">
      {rides.length} items
      <button type="button" onClick={() => onInserted?.('c9', 'New Coaster', 3)}>
        fire-inserted
      </button>
      <button type="button" onClick={() => onError?.('Something failed')}>
        fire-error
      </button>
    </div>
  ),
}))

vi.mock('../components/ConfirmEmailGate', () => ({
  default: ({ email }: { email?: string }) => <div data-testid="confirm-gate">{email}</div>,
}))

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MyCoastersPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockConfirmed(ridesData: unknown[] = []) {
  vi.mocked(useAuth).mockReturnValue({
    user: { email: 'test@example.com' },
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
    window.localStorage.clear()
  })

  it('shows the email gate when not confirmed', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { email: 'test@example.com' },
      isConfirmed: false,
    } as never)
    vi.mocked(useMyRides).mockReturnValue({ data: [], isPending: false, isError: false } as never)
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

  it('hides the share CTA below the 5-ranked milestone', () => {
    mockConfirmed(ridesWithRanks(4))
    renderPage()
    expect(screen.queryByTestId('share-list-card')).not.toBeInTheDocument()
  })

  it('shows the soft share CTA at the 5-ranked milestone', () => {
    mockConfirmed(ridesWithRanks(5))
    renderPage()
    expect(screen.getByTestId('share-list-card')).toBeInTheDocument()
    expect(screen.getByText('Your list is taking shape')).toBeInTheDocument()
  })

  it('shows the stronger CTA copy at the 10-ranked milestone', () => {
    mockConfirmed(ridesWithRanks(10))
    renderPage()
    expect(screen.getByText('Milestone unlocked')).toBeInTheDocument()
    expect(screen.getByText('10 coasters ranked!')).toBeInTheDocument()
  })

  it('shows the CTA again at a higher milestone after dismissing the earlier one', () => {
    window.localStorage.setItem('cr.share-cta.dismissed-milestone', '1')
    mockConfirmed(ridesWithRanks(10))
    renderPage()
    expect(screen.getByTestId('share-list-card')).toBeInTheDocument()
  })

  it('stays hidden when the current milestone was already dismissed', () => {
    window.localStorage.setItem('cr.share-cta.dismissed-milestone', '2')
    mockConfirmed(ridesWithRanks(10))
    renderPage()
    expect(screen.queryByTestId('share-list-card')).not.toBeInTheDocument()
  })

  it('persists dismissal for the current milestone', async () => {
    const user = userEvent.setup()
    mockConfirmed(ridesWithRanks(5))
    renderPage()
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(screen.queryByTestId('share-list-card')).not.toBeInTheDocument()
    expect(window.localStorage.getItem('cr.share-cta.dismissed-milestone')).toBe('1')
  })

  it('nudges toward claiming a username when the profile has none', () => {
    vi.mocked(fetchProfile).mockResolvedValue({
      id: 'u1',
      username: null,
      display_name: null,
      avatar_url: null,
      is_admin: false,
      og_image_url: null,
      public_list: false,
    })
    mockConfirmed(ridesWithRanks(5))
    renderPage()
    expect(screen.getByText(/claim a username/i)).toBeInTheDocument()
  })
})
