import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CoasterDetailPage from './CoasterDetailPage'
import { useAuth } from '../lib/auth-context'
import { useCoaster, useRecomputeFreshness } from '../lib/coasters'
import { useIsAdmin } from '../lib/useIsAdmin'
import { useAddRide, useMyRides } from '../lib/rides'
import { makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useCoaster: vi.fn(),
    useRecomputeFreshness: vi.fn(),
  }
})

vi.mock('../lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth-context')>()
  return {
    ...actual,
    useAuth: vi.fn(),
  }
})

vi.mock('../lib/rides', () => ({
  useMyRides: vi.fn(),
  useAddRide: vi.fn(),
}))

vi.mock('../lib/useIsAdmin', () => ({
  useIsAdmin: vi.fn(),
}))

// The quick-edit form is code-split; stub it so these tests stay focused on
// the detail page's gating (the modal itself is covered separately).
vi.mock('../components/admin/CoasterEditModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="coaster-edit-modal">
      <button type="button" onClick={onClose}>
        Close quick-edit
      </button>
    </div>
  ),
}))

const sixMinutesAgo = new Date(Date.now() - 6 * 60_000).toISOString()

function mockLoggedOut() {
  vi.mocked(useAuth).mockReturnValue({ session: null, isLoading: false } as never)
  vi.mocked(useMyRides).mockReturnValue({ data: undefined, isPending: true } as never)
  vi.mocked(useAddRide).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
}

function renderPage(slug = 'steel-vengeance') {
  return render(
    <MemoryRouter initialEntries={[`/coasters/${slug}`]}>
      <Routes>
        <Route path="/coasters/:slug" element={<CoasterDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CoasterDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockLoggedOut()
    vi.mocked(useIsAdmin).mockReturnValue(false)
    vi.mocked(useRecomputeFreshness).mockReturnValue({ data: sixMinutesAgo } as never)
  })

  it('shows identity, the community ranking panel, and demoted specs', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({
        park_id: 'park-1',
        park_name: 'Cedar Point',
        park_slug: 'cedar-point',
        park_city: 'Sandusky',
        park_country: 'United States',
        manufacturer_name: 'Rocky Mountain Construction',
        name: 'Steel Vengeance',
        slug: 'steel-vengeance',
        model: 'I-Box Track',
        type: 'Steel',
        opening_date: '2018-05-05',
        height_m: 61,
        speed_kmh: 119,
        length_m: 1146,
        inversions: 4,
        rank: 3,
        comparisons: 42,
        participants: 131,
        first_place_votes: 114,
        score: 2.5,
      }),
      isPending: false,
      isError: false,
    } as never)
    renderPage()

    expect(screen.getByRole('heading', { name: 'Steel Vengeance' })).toBeInTheDocument()
    // Rank lives inside the ranking panel now, paired with the score (the
    // "on the board" suffix is sr-only, so match the visible numeral).
    expect(screen.getByText('#3')).toBeInTheDocument()
    expect(screen.getByText('2.50')).toBeInTheDocument()
    expect(screen.getByText('Community ranking')).toBeInTheDocument()
    expect(screen.getByText('Updated 6 minutes ago')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cedar Point' })).toHaveAttribute(
      'href',
      '/parks/cedar-point',
    )
    expect(screen.getByText(/Sandusky, United States/)).toBeInTheDocument()
    expect(screen.getByText(/Rocky Mountain Construction/)).toBeInTheDocument()
    // Supporting BT stats inside the panel strip.
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('131')).toBeInTheDocument()
    expect(screen.getByText('114 (87%)')).toBeInTheDocument()
    // Demoted spec pairs + consolidated metadata line.
    expect(screen.getByText('61 m')).toBeInTheDocument()
    expect(screen.getByText('119 km/h')).toBeInTheDocument()
    expect(screen.getByText('1146 m')).toBeInTheDocument()
    expect(
      screen.getByText(/Track: I-Box Track · Material: Steel · Opened: 2018 · Status: Operating/),
    ).toBeInTheDocument()
    // Logged-out CTA anchored to the panel.
    expect(screen.getByRole('link', { name: 'Sign up to rank this coaster' })).toHaveAttribute(
      'href',
      '/signup',
    )
  })

  it('lists former names from the row aliases', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({ name: 'Iron Gwazi', aliases: ['Gwazi'] }),
      isPending: false,
      isError: false,
    } as never)
    renderPage('iron-gwazi')
    expect(screen.getByText(/Also known as: Gwazi/)).toBeInTheDocument()
  })

  it('links to suggest-edit and scopes the details section', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({ name: 'Steel Vengeance' }),
      isPending: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.getByText('Coaster details')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /see something wrong/i })).toHaveAttribute(
      'href',
      '/coasters/steel-vengeance/suggest-edit',
    )
    expect(screen.queryByRole('link', { name: /back to the board/i })).not.toBeInTheDocument()
  })

  it('shows the weekly movement chip next to the rank', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({ name: 'Climber', rank: 3, rank_last_week: 5 }),
      isPending: false,
      isError: false,
    } as never)
    renderPage('climber')
    expect(screen.getByTitle('Up 2 places this week')).toBeInTheDocument()
  })

  it('shows a down movement chip for a coaster that fell', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({ name: 'Faller', rank: 5, rank_last_week: 3 }),
      isPending: false,
      isError: false,
    } as never)
    renderPage('faller')
    expect(screen.getByTitle('Down 2 places this week')).toBeInTheDocument()
  })

  it('hides the freshness marker when the meta RPC is unavailable', () => {
    vi.mocked(useRecomputeFreshness).mockReturnValue({ data: null } as never)
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({ name: 'Steel Vengeance' }),
      isPending: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.queryByText(/Updated /)).not.toBeInTheDocument()
  })

  it('shows an em dash for missing stats', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({
        name: 'Mystery',
        rank: null,
        score: null,
        comparisons: null,
        participants: null,
        height_m: null,
        speed_kmh: null,
        length_m: null,
        inversions: null,
      }),
      isPending: false,
      isError: false,
    } as never)
    renderPage('mystery')
    expect(screen.getByText('Not yet ranked')).toBeInTheDocument()
    expect(screen.getByText('No ratings yet')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(6)
  })

  it('shows the few-votes badge inside the ranking panel', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({ name: 'Obscure', comparisons: 2 }),
      isPending: false,
      isError: false,
    } as never)
    renderPage('obscure')
    expect(screen.getByText('few votes')).toBeInTheDocument()
  })

  it('handles a coaster that does not exist', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: null,
      isPending: false,
      isError: false,
    } as never)
    renderPage('nope')
    expect(screen.getByText('Coaster not found.')).toBeInTheDocument()
  })

  it('handles a load error', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    } as never)
    renderPage()
    expect(screen.getByText("Couldn't load that coaster.")).toBeInTheDocument()
  })

  it('hides the admin quick-edit for non-admins', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({ name: 'Steel Vengeance' }),
      isPending: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.queryByRole('button', { name: /edit as admin/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('coaster-edit-modal')).not.toBeInTheDocument()
  })

  it('opens the admin quick-edit modal for admins', async () => {
    vi.mocked(useIsAdmin).mockReturnValue(true)
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({ name: 'Steel Vengeance' }),
      isPending: false,
      isError: false,
    } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit as admin/i }))
    expect(await screen.findByTestId('coaster-edit-modal')).toBeInTheDocument()
  })

  it('shows a loading state', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as never)
    renderPage()
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})
