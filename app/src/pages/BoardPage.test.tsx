import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useSearchParams } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import BoardPage from './BoardPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PAGE_SIZE, useAllCoasters, useBoardMeta, type RankingBoardPayload } from '../lib/coasters'
import { useAuth } from '../lib/auth-context'
import {
  SIGNUP_CTA_ACTIVITY_WINDOW_MS,
  SIGNUP_CTA_ARMED_KEY,
  SIGNUP_CTA_ENGAGED_SECONDS,
  SIGNUP_CTA_RETURN_DELAY_MS,
  SIGNUP_CTA_STORAGE_KEY,
} from '../lib/signup-cta'
import { makeRankingRow } from '../test/fixtures'

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useAllCoasters: vi.fn(),
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

function boardTree(initialEntries = ['/']) {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={initialEntries}>
          <Routes>
            <Route path="/" element={<BoardPage />} />
          </Routes>
          <LocationProbe />
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

function renderBoard(initialEntries = ['/']) {
  return render(boardTree(initialEntries))
}

function mockAllCoasters(data: Parameters<typeof makeRankingRow>[0][] = []) {
  vi.mocked(useAllCoasters).mockReturnValue({
    data: data.length ? data.map((o) => makeRankingRow(o)) : [],
    isPending: false,
    isError: false,
  } as never)
}

function mockAnonymousAuth() {
  vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: false } as never)
}

function mockBoardMeta(overrides: Partial<RankingBoardPayload> = {}) {
  vi.mocked(useBoardMeta).mockReturnValue({
    data: {
      last_recomputed_at: '2026-08-31T00:30:00.000Z',
      real_user_count: null,
      ranked_user_count: null,
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
    window.localStorage.clear()
    mockAnonymousAuth()
    mockBoardMeta()
    mockAllCoasters([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }])
  })

  it('renders the board heading', () => {
    renderBoard()
    expect(screen.getByRole('heading', { name: /coasterrank/i })).toBeInTheDocument()
  })

  it('sets the board title, description, canonical, and WebSite JSON-LD', async () => {
    renderBoard()
    await waitFor(() => {
      expect(document.title).toBe('CoasterRank — A live ranking of the world’s roller coasters')
    })
    expect(
      document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
    ).toContain('community-voted')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${window.location.origin}/`,
    )
    expect(document.querySelector('script[type="application/ld+json"]')?.textContent).toContain(
      '"@type":"WebSite"',
    )
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

  it('writes status=running to the URL when filtered to operating only', async () => {
    const user = userEvent.setup()
    renderBoard()
    await user.click(statusRadio('Running'))
    await waitFor(() => {
      expect(screen.getByTestId('location').textContent).toBe('status=running')
    })
  })

  it('reads filters from the URL', () => {
    renderBoard(['/?status=running&material=wood'])
    expect(statusRadio('Running')).toBeChecked()
    expect(materialRadio('Wood')).toBeChecked()
  })

  it('shows all coasters by default and only operating when filtered to Running', async () => {
    const table = () => within(screen.getByRole('table'))
    mockAllCoasters([
      { name: 'Open', status: 'operating' },
      { name: 'Gone', status: 'defunct' },
    ])
    renderBoard()
    expect(table().getByText('Open')).toBeInTheDocument()
    expect(table().getByText('Gone')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(statusRadio('Running'))
    await waitFor(() => {
      expect(table().queryByText('Gone')).not.toBeInTheDocument()
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
    mockBoardMeta({ ranked_user_count: 50 })
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
    mockBoardMeta({ ranked_user_count: 10 })
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

  it('surfaces live rank movement after a board turnover', () => {
    mockAllCoasters([
      { id: 'a', name: 'Alpha', rank: 1 },
      { id: 'b', name: 'Beta', rank: 2 },
    ])
    mockBoardMeta({ last_recomputed_at: '2026-09-01T00:00:00.000Z' })
    const view = renderBoard()
    // First load: baseline only — movement must be earned by a live turnover.
    expect(within(screen.getByRole('table')).queryByText('↑1')).not.toBeInTheDocument()

    // A recompute lands (last_recomputed_at moves) and the two swap.
    mockAllCoasters([
      { id: 'b', name: 'Beta', rank: 1 },
      { id: 'a', name: 'Alpha', rank: 2 },
    ])
    mockBoardMeta({ last_recomputed_at: '2026-09-01T00:15:00.000Z' })
    view.rerender(boardTree())
    const table = within(screen.getByRole('table'))
    expect(table.getByText('↑1')).toBeInTheDocument()
    expect(table.getByText('↓1')).toBeInTheDocument()
    view.unmount()
  })

  it('does not fake a turnover when only the payload object changes', () => {
    mockAllCoasters([
      { id: 'a', name: 'Alpha', rank: 1 },
      { id: 'b', name: 'Beta', rank: 2 },
    ])
    mockBoardMeta({ last_recomputed_at: '2026-09-01T00:00:00.000Z' })
    const view = renderBoard()

    // Same recompute timestamp (e.g. an edge-cache refill): no chips.
    mockAllCoasters([
      { id: 'b', name: 'Beta', rank: 1 },
      { id: 'a', name: 'Alpha', rank: 2 },
    ])
    view.rerender(boardTree())
    expect(within(screen.getByRole('table')).queryByText('↑1')).not.toBeInTheDocument()
    view.unmount()
  })
})

describe('BoardPage signup CTA', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    window.sessionStorage.clear()
    mockAnonymousAuth()
    mockBoardMeta()
    mockAllCoasters([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function ctaDialog() {
    return screen.queryByRole('dialog', { name: 'Sign up invitation' })
  }

  // Simulate N engaged seconds: one user action per 1s tick. Each scroll
  // stamps activity, then the clock advances one ticker interval (inside
  // act() so the tick's state update flushes before we assert). jsdom never
  // scrolls (scrollY is always 0), so the minimum-scroll gate is stubbed
  // past its threshold for the duration — the "clock alone" test below
  // covers the unstubbed case.
  async function engage(seconds: number) {
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true })
    try {
      for (let i = 0; i < seconds; i += 1) {
        fireEvent.scroll(window)
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000)
        })
      }
    } finally {
      Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
    }
  }

  it('needs real activity: clock time alone never trips the gate', async () => {
    vi.useFakeTimers()
    renderBoard()
    // jsdom has no scrollable depth, so scroll engagement is immediate —
    // only the action-gated dwell is under test here.
    await vi.advanceTimersByTimeAsync(
      (SIGNUP_CTA_ENGAGED_SECONDS + SIGNUP_CTA_ACTIVITY_WINDOW_MS / 1000) * 1000 * 2,
    )
    expect(ctaDialog()).not.toBeInTheDocument()

    // ...but the same span WITH activity fires it.
    await engage(SIGNUP_CTA_ENGAGED_SECONDS)
    expect(ctaDialog()).toBeInTheDocument()
    // §3.1: the CTA's primary button now launches Mark Mode on the board;
    // direct signup demoted to a secondary link.
    expect(screen.getByRole('button', { name: 'Rank My Rides' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'or sign up' })).toHaveAttribute('href', '/signup')
  })

  it('never appears while auth is still loading', async () => {
    vi.useFakeTimers()
    vi.mocked(useAuth).mockReturnValue({ user: null, isLoading: true } as never)
    renderBoard()
    await engage(SIGNUP_CTA_ENGAGED_SECONDS)
    expect(ctaDialog()).not.toBeInTheDocument()
  })

  it('never appears for logged-in users', async () => {
    vi.useFakeTimers()
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1' },
      isLoading: false,
    } as never)
    renderBoard()
    await engage(SIGNUP_CTA_ENGAGED_SECONDS)
    expect(ctaDialog()).not.toBeInTheDocument()
  })

  it('stays hidden when previously dismissed', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem(SIGNUP_CTA_STORAGE_KEY, '1')
    window.sessionStorage.setItem(SIGNUP_CTA_ARMED_KEY, '1')
    renderBoard()
    // Dismissal wins over the return-trip arming too.
    await engage(SIGNUP_CTA_ENGAGED_SECONDS)
    expect(ctaDialog()).not.toBeInTheDocument()
  })

  it('dismissing persists the flag so it never shows again', async () => {
    vi.useFakeTimers()
    renderBoard()
    await engage(SIGNUP_CTA_ENGAGED_SECONDS)
    expect(ctaDialog()).toBeInTheDocument()
    // fireEvent (sync) instead of userEvent: the clock is faked here.
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss signup prompt' }))
    expect(ctaDialog()).not.toBeInTheDocument()
    expect(window.localStorage.getItem(SIGNUP_CTA_STORAGE_KEY)).toBe('1')
  })

  it('dismissing in ?cta=show hides for the session without writing storage', async () => {
    const user = userEvent.setup()
    renderBoard(['/?cta=show'])
    expect(ctaDialog()).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss signup prompt' }))
    expect(ctaDialog()).not.toBeInTheDocument()
    expect(window.localStorage.getItem(SIGNUP_CTA_STORAGE_KEY)).toBeNull()
  })

  it('?cta=show previews instantly without writing storage', () => {
    renderBoard(['/?cta=show'])
    expect(ctaDialog()).toBeInTheDocument()
    expect(window.localStorage.getItem(SIGNUP_CTA_STORAGE_KEY)).toBeNull()
  })

  it('?cta=reset clears a previous dismissal', async () => {
    vi.useFakeTimers()
    window.localStorage.setItem(SIGNUP_CTA_STORAGE_KEY, '1')
    renderBoard(['/?cta=reset'])
    expect(window.localStorage.getItem(SIGNUP_CTA_STORAGE_KEY)).toBeNull()
    await engage(SIGNUP_CTA_ENGAGED_SECONDS)
    expect(ctaDialog()).toBeInTheDocument()
  })

  it('scrolling arms the return trip: coming back shows the card without re-earning', async () => {
    vi.useFakeTimers()
    // First visit: a little engagement, not enough to fire — but the scroll
    // arms the tab for the return trip (e.g. off to a coaster page).
    const first = renderBoard()
    await engage(3)
    expect(ctaDialog()).not.toBeInTheDocument()
    expect(window.sessionStorage.getItem(SIGNUP_CTA_ARMED_KEY)).toBe('1')
    first.unmount()

    // Back on the board: the card appears after the settle delay, with no
    // further activity at all.
    renderBoard()
    expect(ctaDialog()).not.toBeInTheDocument()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_CTA_RETURN_DELAY_MS)
    })
    expect(ctaDialog()).toBeInTheDocument()
  })

  it('a visit with no scroll never arms, so returning stays quiet', async () => {
    vi.useFakeTimers()
    const first = renderBoard()
    // Clock runs but the visitor never acts: nothing arms, nothing shows.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_CTA_RETURN_DELAY_MS * 5)
    })
    expect(window.sessionStorage.getItem(SIGNUP_CTA_ARMED_KEY)).toBeNull()
    first.unmount()

    renderBoard()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SIGNUP_CTA_RETURN_DELAY_MS * 3)
    })
    expect(ctaDialog()).not.toBeInTheDocument()
  })
})
