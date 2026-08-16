import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import CoasterDetailPage from './CoasterDetailPage'
import { useCoaster } from '../lib/coasters'
import { makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useCoaster: vi.fn(),
  }
})

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
  })

  it('shows the coaster stats and links to its park', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({
        name: 'Steel Vengeance',
        slug: 'steel-vengeance',
        height_m: 61,
        speed_kmh: 119,
        length_m: 1146,
        inversions: 4,
        rank: 3,
        comparisons: 42,
        participants: 8,
        score: 2.5,
        park_name: 'Cedar Point',
        park_slug: 'cedar-point',
        park_country: 'US',
        park_city: 'Sandusky',
        manufacturer_name: 'Rocky Mountain Construction',
      }),
      isPending: false,
      isError: false,
    } as never)
    renderPage()

    expect(screen.getByRole('heading', { name: 'Steel Vengeance' })).toBeInTheDocument()
    expect(screen.getByText('#3 on the board')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cedar Point' })).toHaveAttribute(
      'href',
      '/parks/cedar-point',
    )
    expect(screen.getByText(/Rocky Mountain Construction/)).toBeInTheDocument()
    expect(screen.getByText('2.50')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('61 m')).toBeInTheDocument()
    expect(screen.getByText('119 km/h')).toBeInTheDocument()
    expect(screen.getByText('Operating')).toBeInTheDocument()
    expect(screen.getByText('Steel')).toBeInTheDocument()
  })

  it('shows an em dash for missing stats', () => {
    vi.mocked(useCoaster).mockReturnValue({
      data: makeRankingRow({
        name: 'Mystery',
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
    expect(screen.getByText('No ratings yet')).toBeInTheDocument()
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(6)
  })

  it('shows the few-votes badge for a low-comparison coaster', () => {
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
