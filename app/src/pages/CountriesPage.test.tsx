import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import CountriesPage from './CountriesPage'
import { useAllCoasters } from '../lib/coasters'
import { makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useAllCoasters: vi.fn(),
  }
})

function renderCountries() {
  return render(
    <HelmetProvider>
      <MemoryRouter initialEntries={['/countries']}>
        <Routes>
          <Route path="/countries" element={<CountriesPage />} />
        </Routes>
      </MemoryRouter>
    </HelmetProvider>,
  )
}

function mockRows(data: Parameters<typeof makeRankingRow>[0][]) {
  vi.mocked(useAllCoasters).mockReturnValue({
    data: data.map((o) => makeRankingRow(o)),
    isPending: false,
    isError: false,
  } as never)
}

describe('CountriesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows skeleton pulses while pending', () => {
    vi.mocked(useAllCoasters).mockReturnValue({
      data: undefined,
      isPending: true,
      isError: false,
    } as never)
    const { container } = renderCountries()
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(5)
    expect(screen.queryByRole('heading', { name: 'Germany' })).not.toBeInTheDocument()
  })

  it('shows an error state on failure', () => {
    vi.mocked(useAllCoasters).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    } as never)
    renderCountries()
    expect(screen.getByText("Couldn't load the country standings.")).toBeInTheDocument()
  })

  it('orders countries by ghost-padded average with stats and board-style rows', () => {
    mockRows([
      {
        id: 'de-1',
        name: 'De One',
        slug: 'de-one',
        park_country: 'Germany',
        park_name: 'Europa-Park',
        park_slug: 'europa-park',
        rank: 2,
      },
      {
        id: 'de-2',
        name: 'De Two',
        slug: 'de-two',
        park_country: 'Germany',
        park_name: 'Phantasialand',
        park_slug: 'phantasialand',
        rank: 4,
        manufacturer_names: ['Intamin'],
        manufacturer_ids: ['i-id'],
      },
      {
        id: 'us-1',
        name: 'Us One',
        slug: 'us-one',
        park_country: 'United States',
        park_name: 'Cedar Point',
        park_slug: 'cedar-point',
        rank: 1,
      },
      {
        id: 'us-2',
        name: 'Us Two',
        slug: 'us-two',
        park_country: 'United States',
        park_name: 'Six Flags',
        park_slug: 'six-flags',
        rank: 9,
      },
    ])
    renderCountries()

    // Four ranked rides board-wide, so ghosts sit at rank 5: Germany
    // (2 + 4 + 5 + 5 + 5) / 5 = 4.2 outranks the United States at 5.0.
    // No short-bench badges anywhere.
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Germany', 'United States'])
    expect(screen.getByText('avg 4.2')).toBeInTheDocument()
    expect(screen.getByText('avg 5.0')).toBeInTheDocument()
    expect(screen.queryByText(/Short bench/)).not.toBeInTheDocument()

    // Stats: totals, ranked counts, lineage-inclusive builder.
    expect(screen.getAllByText(/2 coasters · 2 ranked/)).toHaveLength(2)
    expect(screen.getByText(/most-built: Intamin \(1\)/)).toBeInTheDocument()

    // Board-style rows: coaster + park links, score pill present.
    expect(screen.getByRole('link', { name: 'De One' })).toHaveAttribute('href', '/coasters/de-one')
    expect(screen.getByRole('link', { name: 'Europa-Park' })).toHaveAttribute(
      'href',
      '/parks/europa-park',
    )
  })

  it('caps each country at its five best-ranked rides', () => {
    mockRows(
      Array.from({ length: 6 }, (_, i) => ({
        id: `us-${i}`,
        name: `Ride ${i + 1}`,
        slug: `ride-${i + 1}`,
        park_country: 'United States',
        rank: i + 1,
      })),
    )
    renderCountries()
    expect(screen.getByRole('link', { name: 'Ride 5' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Ride 6' })).not.toBeInTheDocument()
  })

  it('sets title, description, and canonical', async () => {
    mockRows([{ id: 'f-1', name: 'F One', slug: 'f-one', park_country: 'France', rank: 3 }])
    renderCountries()
    await screen.findByRole('heading', { level: 2, name: 'France' })
    expect(document.title).toBe('Countries — CoasterRank')
    expect(
      document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
    ).toContain('top five')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe(
      `${window.location.origin}/countries`,
    )
  })
})
