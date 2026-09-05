import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import ParkDetailPage from './ParkDetailPage'
import { useAllCoasters, usePark } from '../lib/coasters'
import { makePark, makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    usePark: vi.fn(),
    useAllCoasters: vi.fn(),
  }
})

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

  it('lists only the park coasters', () => {
    renderPage()
    // Both CSS-gated layouts render the park's rows.
    expect(screen.getAllByText('Steel Vengeance')).toHaveLength(2)
    expect(screen.getAllByText('Millennium Force')).toHaveLength(2)
    expect(screen.queryByText('Somewhere Else')).not.toBeInTheDocument()
  })

  it('omits the park column on its own page', () => {
    renderPage()
    expect(screen.queryAllByRole('link', { name: 'Cedar Point' })).toHaveLength(0)
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
})
