import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import BoardPage from './BoardPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  PAGE_SIZE,
  useAllCoasters,
  useBoardMeta,
  useRankedUserCount,
  type RankingBoardPayload,
} from '../lib/coasters'
import { makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useAllCoasters: vi.fn(),
    useRankedUserCount: vi.fn(),
    useBoardMeta: vi.fn(),
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

function mockBoardMeta(overrides: Partial<RankingBoardPayload> = {}) {
  vi.mocked(useBoardMeta).mockReturnValue({
    data: {
      last_recomputed_at: '2026-08-31T00:30:00.000Z',
      real_user_count: null,
      generated_at: '2026-08-31T00:00:00.000Z',
      ...overrides,
    },
    isPending: false,
    isError: false,
  } as never)
}

function mockBoardMetaPending() {
  vi.mocked(useBoardMeta).mockReturnValue({
    data: undefined,
    isPending: true,
    isError: false,
  } as never)
}

function statusRadio(name: string) {
  return within(screen.getByRole('radiogroup', { name: 'Status' })).getByRole('radio', { name })
}

function materialRadio(name: string) {
  return within(screen.getByRole('radiogroup', { name: 'Track' })).getByRole('radio', { name })
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
    mockBoardMeta()
    mockAllCoasters([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }])
  })

  it('renders the board heading', () => {
    renderBoard()
    expect(screen.getByRole('heading', { name: /coasterrank/i })).toBeInTheDocument()
  })

  it('shows the catalog size, country count, and live indicator', () => {
    mockAllCoasters([
      { name: 'A', park_country: 'United States' },
      { name: 'B', park_country: 'United States' },
      { name: 'C', park_country: null },
    ])
    renderBoard()
    expect(screen.getByText('3 coasters')).toBeInTheDocument()
    expect(screen.getByText('1 country')).toBeInTheDocument()
    expect(screen.getByText('Live')).toBeInTheDocument()
  })

  it('shows a loading state with skeleton pulses while pending', () => {
    vi.mocked(useAllCoasters).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as never)
    mockBoardMetaPending()
    const { container } = renderBoard()
    // §8.3: no text state — the reserved slot holds skeleton bars, and the
    // hero status line pulses too (§8.1).
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(8)
    expect(container.querySelector('[data-board-hero] .animate-pulse')).not.toBeNull()
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

  it('links About to /about', () => {
    renderBoard()
    expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
  })

  it('shows the user count only past the gate, desktop-only', () => {
    mockBoardMeta({ real_user_count: 61 })
    const { unmount } = renderBoard()
    // Hidden on mobile via CSS (jsdom can't compute CSS — pin the classes).
    expect(screen.getByText('61 users')).toHaveClass('hidden', 'sm:inline')
    unmount()

    mockBoardMeta({ real_user_count: 41 })
    renderBoard()
    expect(screen.queryByText('41 users')).not.toBeInTheDocument()
  })

  it('never shows the user count when the meta payload lacks it', () => {
    mockBoardMeta({ real_user_count: null })
    renderBoard()
    expect(screen.queryByText(/users/)).not.toBeInTheDocument()
  })

  it('opens the Live popunder on click and shows the last-ranked age', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText(/Last ranked/)).toBeInTheDocument()
    // Escape dismisses.
    await user.keyboard('{Escape}')
    expect(screen.queryByText(/Last ranked/)).not.toBeInTheDocument()
  })

  it('dismisses the Live popunder on outside click', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText(/Last ranked/)).toBeInTheDocument()
    await user.click(screen.getByRole('heading', { name: /coasterrank/i }))
    expect(screen.queryByText(/Last ranked/)).not.toBeInTheDocument()
  })

  it('shows a muted fallback in the popunder when no timestamp exists', async () => {
    mockBoardMeta({ last_recomputed_at: null, generated_at: '2026-08-31T00:00:00.000Z' })
    const user = userEvent.setup()
    renderBoard()
    await user.click(screen.getByRole('button', { name: 'Live' }))
    // generated_at is the fallback, so a normal label still renders.
    expect(screen.getByText(/Last ranked/)).toBeInTheDocument()
  })

  it('renders the ranked rows and links to the park', () => {
    renderBoard()
    // Both CSS-gated layouts render the row; scope to the desktop table.
    expect(within(screen.getByRole('table')).getByText('Steel Vengeance')).toBeInTheDocument()
    expect(
      within(screen.getByRole('table')).getByRole('link', { name: 'Test Park' }),
    ).toHaveAttribute('href', '/parks/test-park')
  })

  it('keeps the default URL clean (no querystring)', () => {
    renderBoard()
    expect(screen.getByTestId('location').textContent).toBe('')
  })

  it('writes status=all to the URL when non-operational coasters are included', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(statusRadio('All'))
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('status=all')
    })
  })

  it('reads filters from the URL', () => {
    renderBoard(['/?status=all&material=wood'])
    expect(statusRadio('All')).toBeChecked()
    expect(materialRadio('Wood')).toBeChecked()
  })

  it('shows only operating coasters by default and all when the status is set to All', async () => {
    const table = () => within(screen.getByRole('table'))
    mockAllCoasters([
      { name: 'Open', status: 'operating' },
      { name: 'Gone', status: 'defunct' },
    ])
    renderBoard()
    expect(table().getByText('Open')).toBeInTheDocument()
    expect(table().queryByText('Gone')).not.toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(statusRadio('All'))
    await waitFor(() => {
      expect(table().getByText('Gone')).toBeInTheDocument()
    })
    expect(table().getByText('Open')).toBeInTheDocument()
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
    expect(screen.getAllByText('12 (30%)')).toHaveLength(2)
    expect(screen.getAllByText('8 (27%)')).toHaveLength(2)
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
    const table = within(screen.getByRole('table'))

    expect(table.getByText('Coaster 0')).toBeInTheDocument()
    expect(table.queryByText(`Coaster ${PAGE_SIZE}`)).not.toBeInTheDocument()
    expect(screen.queryByText('End of list')).not.toBeInTheDocument()

    observeCallback?.([{ isIntersecting: true }])
    await waitFor(() => {
      expect(table.getByText(`Coaster ${PAGE_SIZE}`)).toBeInTheDocument()
    })
    expect(screen.getByText('End of list')).toBeInTheDocument()
  })

  it('shows the end-of-list marker when everything fits on the first page', () => {
    mockAllCoasters([{ name: 'A' }, { name: 'B' }, { name: 'C' }])
    renderBoard()
    expect(screen.getByText('End of list')).toBeInTheDocument()
  })
})
