import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useMyRides } from '../lib/rides'
import { useAuth } from '../lib/auth-context'
import MyCoastersPage from './MyCoastersPage'

vi.mock('../lib/rides', () => ({
  useMyRides: vi.fn(),
  useAddRide: vi.fn(),
  useRemoveRide: vi.fn(),
  useSaveRanks: vi.fn(),
  renumberRanks: vi.fn(),
}))

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../components/CoasterSearchBar', () => ({
  default: () => <div data-testid="search-bar" />,
}))

vi.mock('../components/RankedCoasterList', () => ({
  default: ({ rides }: { rides: unknown[] }) => (
    <div data-testid="ranked-list">{rides.length} items</div>
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

describe('MyCoastersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
    vi.mocked(useAuth).mockReturnValue({
      user: { email: 'test@example.com' },
      isConfirmed: true,
    } as never)
    vi.mocked(useMyRides).mockReturnValue({ data: [], isPending: false, isError: false } as never)
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
    vi.mocked(useAuth).mockReturnValue({
      user: { email: 'test@example.com' },
      isConfirmed: true,
    } as never)
    vi.mocked(useMyRides).mockReturnValue({
      data: [
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
            score: 1,
            comparisons: 10,
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
            score: 0.8,
            comparisons: 8,
          },
        },
      ],
      isPending: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.getByText('2 coasters ranked')).toBeInTheDocument()
  })
})
