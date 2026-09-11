import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ParkDetailPage from './ParkDetailPage'
import { useAllCoasters, usePark } from '../lib/coasters'
import { useIsAdmin } from '../lib/useIsAdmin'
import { makePark, makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    usePark: vi.fn(),
    useAllCoasters: vi.fn(),
  }
})

vi.mock('../lib/useIsAdmin', () => ({
  useIsAdmin: vi.fn(),
}))

// The quick-edit form is code-split; stub it so these tests stay focused on
// the detail page's gating (the modal itself is covered separately).
vi.mock('../components/admin/ParkEditModal', () => ({
  default: ({ onClose }: { onClose: () => void }) => (
    <div data-testid="park-edit-modal">
      <button type="button" onClick={onClose}>
        Close quick-edit
      </button>
    </div>
  ),
}))

function renderPage(slug = 'cedar-point') {
  return render(
    <MemoryRouter initialEntries={[`/parks/${slug}`]}>
      <Routes>
        <Route path="/parks/:slug" element={<ParkDetailPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

const park = makePark({
  id: 'p1',
  name: 'Cedar Point',
  slug: 'cedar-point',
  country: 'US',
  region: 'Ohio',
  city: 'Sandusky',
})

describe('ParkDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useIsAdmin).mockReturnValue(false)
    vi.mocked(usePark).mockReturnValue({
      data: park,
      isPending: false,
      isError: false,
    } as never)
    vi.mocked(useAllCoasters).mockReturnValue({
      data: [
        makeRankingRow({
          park_id: 'p1',
          name: 'Steel Vengeance',
          slug: 'steel-vengeance',
          rank: 3,
        }),
        makeRankingRow({
          park_id: 'p1',
          name: 'Millennium Force',
          slug: 'millennium-force',
          rank: 12,
        }),
        makeRankingRow({ park_id: 'p2', name: 'Somewhere Else', slug: 'somewhere-else' }),
      ],
      isPending: false,
      isError: false,
    } as never)
  })

  it('shows the park name, location, and coaster count', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Cedar Point' })).toBeInTheDocument()
    expect(screen.getByText(/Sandusky · Ohio · US/)).toBeInTheDocument()
    expect(screen.getByText(/2 coasters/)).toBeInTheDocument()
  })

  it('highlights the park’s top-ranked coaster in the hero', () => {
    renderPage()
    expect(screen.getByText(/Top coaster in this park:/)).toBeInTheDocument()
    const topLink = screen
      .getAllByRole('link', { name: 'Steel Vengeance' })
      .find((link) => link.getAttribute('href') === '/coasters/steel-vengeance')
    expect(topLink).toBeDefined()
    expect(screen.getByText(/#3 on the board/)).toBeInTheDocument()
  })

  it('omits the top-coaster line when nothing is ranked', () => {
    vi.mocked(useAllCoasters).mockReturnValue({
      data: [
        makeRankingRow({
          park_id: 'p1',
          name: 'Steel Vengeance',
          slug: 'steel-vengeance',
          rank: null,
        }),
        makeRankingRow({
          park_id: 'p1',
          name: 'Millennium Force',
          slug: 'millennium-force',
          rank: null,
        }),
      ],
      isPending: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.queryByText(/Top coaster in this park:/)).not.toBeInTheDocument()
  })

  it('shows a park-specific empty state instead of the table filter message', () => {
    vi.mocked(useAllCoasters).mockReturnValue({
      data: [makeRankingRow({ park_id: 'p2', name: 'Somewhere Else', slug: 'somewhere-else' })],
      isPending: false,
      isError: false,
    } as never)
    renderPage()
    expect(screen.getByText('No coasters from this park on the board yet.')).toBeInTheDocument()
    expect(screen.queryByText('Somewhere Else')).not.toBeInTheDocument()
  })

  it('lists only the park coasters', () => {
    renderPage()
    // Both CSS-gated layouts render the park's rows, plus the hero's top-coaster link.
    expect(screen.getAllByText('Steel Vengeance')).toHaveLength(3)
    expect(screen.getAllByText('Millennium Force')).toHaveLength(2)
    expect(screen.queryByText('Somewhere Else')).not.toBeInTheDocument()
  })

  it('omits the park column on its own page', () => {
    renderPage()
    expect(screen.queryAllByRole('link', { name: 'Cedar Point' })).toHaveLength(0)
  })

  it('hides the admin quick-edit for non-admins', () => {
    renderPage()
    expect(screen.queryByRole('button', { name: /edit as admin/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('park-edit-modal')).not.toBeInTheDocument()
  })

  it('opens the admin quick-edit modal for admins', async () => {
    vi.mocked(useIsAdmin).mockReturnValue(true)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /edit as admin/i }))
    expect(await screen.findByTestId('park-edit-modal')).toBeInTheDocument()
  })

  it('handles a park that does not exist', () => {
    vi.mocked(usePark).mockReturnValue({
      data: null,
      isPending: false,
      isError: false,
    } as never)
    renderPage('nope')
    expect(screen.getByText('Park not found.')).toBeInTheDocument()
  })

  it('handles a load error', () => {
    vi.mocked(usePark).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    } as never)
    renderPage()
    expect(screen.getByText("Couldn't load that park.")).toBeInTheDocument()
  })

  it('shows a loading skeleton while pending', () => {
    vi.mocked(usePark).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as never)
    vi.mocked(useAllCoasters).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as never)
    renderPage()
    expect(screen.getByRole('status', { name: 'Loading park details' })).toBeInTheDocument()
  })
})
