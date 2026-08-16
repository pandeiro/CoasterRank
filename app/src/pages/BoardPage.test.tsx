import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import BoardPage from './BoardPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useRankings, useParks, useCountries, useManufacturers } from '../lib/coasters'
import { makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useRankings: vi.fn(),
    useParks: vi.fn(),
    useCountries: vi.fn(),
    useManufacturers: vi.fn(),
  }
})

type ObserverEntry = { isIntersecting: boolean }
type ObserverCallback = (entries: ObserverEntry[]) => void

let observeCallback: ObserverCallback | null = null

class MockIntersectionObserver {
  constructor(callback: ObserverCallback) {
    observeCallback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

function LocationProbe() {
  const [params] = useSearchParams()
  return <output data-testid="location">{params.toString()}</output>
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function renderBoard(initialEntries = ['/']) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={initialEntries}>
        <Routes>
          <Route path="/" element={<BoardPage />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const rows = [makeRankingRow({ name: 'Steel Vengeance', slug: 'steel-vengeance' })]

describe('BoardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    observeCallback = null
    vi.mocked(useParks).mockReturnValue({ data: [] } as never)
    vi.mocked(useCountries).mockReturnValue({ data: [] } as never)
    vi.mocked(useManufacturers).mockReturnValue({ data: [] } as never)
    vi.mocked(useRankings).mockReturnValue({
      data: { pages: [rows], pageParams: [0] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    } as never)
  })

  it('renders the CoasterRank heading', () => {
    renderBoard()
    expect(screen.getByRole('heading', { name: /coasterrank/i })).toBeInTheDocument()
  })

  it('shows a loading state while pending', () => {
    vi.mocked(useRankings).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    } as never)
    renderBoard()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error state on failure', () => {
    vi.mocked(useRankings).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    } as never)
    renderBoard()
    expect(screen.getByText("Couldn't load the board.")).toBeInTheDocument()
  })

  it('renders the ranked rows', () => {
    renderBoard()
    expect(screen.getByText('Steel Vengeance')).toBeInTheDocument()
    expect(screen.getByText('Test Park')).toBeInTheDocument()
  })

  it('keeps the default URL clean (no querystring)', () => {
    renderBoard()
    expect(screen.getByTestId('location').textContent).toBe('')
  })

  it('writes status to the URL when a non-operating status is chosen', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.selectOptions(screen.getByLabelText('Status'), 'defunct')
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('status=defunct')
    })
  })

  it('reads filters from the URL', () => {
    vi.mocked(useRankings).mockReturnValue({
      data: { pages: [rows], pageParams: [0] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    } as never)
    renderBoard(['/?status=all'])
    expect(screen.getByLabelText('Status')).toHaveValue('all')
  })

  it('loads the next page when scrolled to the bottom', async () => {
    const fetchNextPage = vi.fn()
    vi.mocked(useRankings).mockReturnValue({
      data: { pages: [rows], pageParams: [0] },
      isPending: false,
      isError: false,
      hasNextPage: true,
      fetchNextPage,
      isFetchingNextPage: false,
    } as never)
    renderBoard()
    observeCallback?.([{ isIntersecting: true }])
    await waitFor(() => {
      expect(fetchNextPage).toHaveBeenCalledTimes(1)
    })
  })

  it('does not fetch more when there is no next page', () => {
    const fetchNextPage = vi.fn()
    vi.mocked(useRankings).mockReturnValue({
      data: { pages: [rows], pageParams: [0] },
      isPending: false,
      isError: false,
      hasNextPage: false,
      fetchNextPage,
      isFetchingNextPage: false,
    } as never)
    renderBoard()
    observeCallback?.([{ isIntersecting: true }])
    expect(fetchNextPage).not.toHaveBeenCalled()
  })
})
