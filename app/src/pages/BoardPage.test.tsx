import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import BoardPage from './BoardPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PAGE_SIZE, useAllCoasters, useRankedUserCount } from '../lib/coasters'
import { makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useAllCoasters: vi.fn(),
    useRankedUserCount: vi.fn(),
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

function mockAllCoasters(data: Parameters<typeof makeRankingRow>[0][] = []) {
  vi.mocked(useAllCoasters).mockReturnValue({
    data: data.length ? data.map((o) => makeRankingRow(o)) : [],
    isPending: false,
    isError: false,
  } as never)
}

function statusRadio(name: string) {
  return within(screen.getByRole('radiogroup', { name: 'Status' })).getByRole('radio', { name })
}

function materialRadio(name: string) {
  return within(screen.getByRole('radiogroup', { name: 'Material' })).getByRole('radio', { name })
}

describe('BoardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    observeCallback = null
    vi.mocked(useRankedUserCount).mockReturnValue({
      data: 0,
      isPending: false,
      isError: false,
    } as never)
    mockAllCoasters([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }])
  })

  it('renders the board heading', () => {
    renderBoard()
    expect(screen.getByRole('heading', { name: /community board/i })).toBeInTheDocument()
  })

  it('shows a loading state while pending', () => {
    vi.mocked(useAllCoasters).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as never)
    renderBoard()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })

  it('shows an error state on failure', () => {
    vi.mocked(useAllCoasters).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    } as never)
    renderBoard()
    expect(screen.getByText("Couldn't load the board.")).toBeInTheDocument()
  })

  it('renders the ranked rows and links to the park', () => {
    renderBoard()
    expect(screen.getByText('Steel Vengeance')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Test Park' })).toHaveAttribute(
      'href',
      '/parks/test-park',
    )
  })

  it('keeps the default URL clean (no querystring)', () => {
    renderBoard()
    expect(screen.getByTestId('location').textContent).toBe('')
  })

  it('writes status=all to the URL when non-operational coasters are included', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(statusRadio('Any'))
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('status=all')
    })
  })

  it('reads filters from the URL', () => {
    renderBoard(['/?status=all&material=wood'])
    expect(statusRadio('Any')).toBeChecked()
    expect(materialRadio('Wood')).toBeChecked()
  })

  it('shows only operating coasters by default and all when the status is set to Any', async () => {
    mockAllCoasters([
      { name: 'Live', status: 'operating' },
      { name: 'Gone', status: 'defunct' },
    ])
    renderBoard()
    expect(screen.getByText('Live')).toBeInTheDocument()
    expect(screen.queryByText('Gone')).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(statusRadio('Any'))
    await waitFor(() => {
      expect(screen.getByText('Gone')).toBeInTheDocument()
    })
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('offers country and manufacturer filters in the Filters popover', async () => {
    const user = userEvent.setup()
    renderBoard()
    expect(screen.queryByRole('combobox', { name: 'Country' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /filters/i }))
    expect(screen.getByRole('combobox', { name: 'Country' })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Manufacturer' })).toBeInTheDocument()
  })

  it('shows first-place data only past the user gate', async () => {
    vi.mocked(useRankedUserCount).mockReturnValue({
      data: 50,
      isPending: false,
      isError: false,
    } as never)
    mockAllCoasters([
      { name: 'Favorite', first_place_votes: 12, participants: 40, rank: 1 },
      { name: 'Loved', first_place_votes: 8, participants: 30, rank: 2 },
      { name: 'Unvoted', first_place_votes: 0, participants: 10, rank: 3 },
    ])
    const { unmount } = renderBoard()
    expect(screen.getByText('12 (30%)')).toBeInTheDocument()
    expect(screen.getByText('8 (27%)')).toBeInTheDocument()
    expect(screen.queryByText('0 (0%)')).not.toBeInTheDocument()
    unmount()

    // Below the gate the first-place pill is hidden.
    vi.mocked(useRankedUserCount).mockReturnValue({
      data: 10,
      isPending: false,
      isError: false,
    } as never)
    renderBoard()
    expect(screen.queryByText('12 (30%)')).not.toBeInTheDocument()
  })

  it('renders the first page and loads the rest on scroll', async () => {
    const many = Array.from({ length: PAGE_SIZE + 10 }, (_, i) => ({
      name: `Coaster ${i}`,
      slug: `coaster-${i}`,
    }))
    mockAllCoasters(many)
    renderBoard()

    expect(screen.getByText('Coaster 0')).toBeInTheDocument()
    expect(screen.queryByText(`Coaster ${PAGE_SIZE}`)).not.toBeInTheDocument()
    expect(screen.queryByText('End of list')).not.toBeInTheDocument()

    observeCallback?.([{ isIntersecting: true }])
    await waitFor(() => {
      expect(screen.getByText(`Coaster ${PAGE_SIZE}`)).toBeInTheDocument()
    })
    expect(screen.getByText('End of list')).toBeInTheDocument()
  })

  it('shows the end-of-list marker when everything fits on the first page', () => {
    mockAllCoasters([{ name: 'A' }, { name: 'B' }, { name: 'C' }])
    renderBoard()
    expect(screen.getByText('End of list')).toBeInTheDocument()
  })
})
