import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import CoasterTable from './CoasterTable'
import { FEW_VOTES_THRESHOLD, type RankingRow } from '../lib/coasters'
import { makeRankingRow } from '../test/fixtures'

function rowsFrom(overrides: Parameters<typeof makeRankingRow>[0][] = []): RankingRow[] {
  return overrides.length
    ? overrides.map((o) => makeRankingRow(o))
    : [makeRankingRow({ name: 'Steel Vengeance', slug: 'steel-vengeance' })]
}

function renderTable(
  rows: RankingRow[],
  firstPlaceIds: Set<string> = new Set(),
  showPark = true,
  variant: 'default' | 'board' = 'default',
) {
  return render(
    <MemoryRouter>
      <CoasterTable
        rows={rows}
        firstPlaceIds={firstPlaceIds}
        showPark={showPark}
        variant={variant}
      />
    </MemoryRouter>,
  )
}

function RouteProbe() {
  const location = useLocation()
  return <div data-testid="route-probe">{location.pathname}</div>
}

function renderWithRoutes(ui: React.ReactElement) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={ui} />
        <Route path="*" element={<RouteProbe />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('CoasterTable', () => {
  it('renders rank, name, park, and material', () => {
    renderTable(rowsFrom([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }]))
    expect(screen.getByText('Steel Vengeance')).toBeInTheDocument()
    expect(screen.getByText('Test Park')).toBeInTheDocument()
    expect(screen.getByText('Steel')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('Manufacturer')).not.toBeInTheDocument()
  })

  it('links to the coaster and park detail pages', () => {
    renderTable(rowsFrom([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }]))
    expect(screen.getByRole('link', { name: 'Steel Vengeance' })).toHaveAttribute(
      'href',
      '/coasters/steel-vengeance',
    )
    expect(screen.getByRole('link', { name: 'Test Park' })).toHaveAttribute(
      'href',
      '/parks/test-park',
    )
  })

  it('shows an em dash for a row without park data', () => {
    renderTable(rowsFrom([{ name: 'Orphan', park_name: null, park_slug: null }]))
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(1)
  })

  it('shows an em dash for unrated rows in the rank column', () => {
    renderTable(
      rowsFrom([
        { name: 'Unrated', rank: null, score: null, comparisons: null, participants: null },
      ]),
    )
    expect(screen.getByText('Unrated')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('numbers the visible list gaplessly, skipping unrated rows', () => {
    renderTable(
      rowsFrom([
        { name: 'Fifth', rank: 5 },
        { name: 'Unrated', rank: null, score: null, comparisons: null, participants: null },
        { name: 'Seventh', rank: 7 },
      ]),
    )
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText('5')).not.toBeInTheDocument()
    expect(screen.queryByText('7')).not.toBeInTheDocument()
  })

  it('shows first-place votes for gated-in coasters', () => {
    const rows = rowsFrom([{ name: 'Steel Vengeance', first_place_votes: 114, participants: 131 }])
    renderTable(rows, new Set([rows[0].id]))
    expect(screen.getByText('114 (87%)')).toBeInTheDocument()
  })

  it('hides first-place data for gated-out coasters even when votes exist', () => {
    renderTable(rowsFrom([{ name: 'Popular', first_place_votes: 9, participants: 10 }]))
    expect(screen.queryByText('9 (90%)')).not.toBeInTheDocument()
  })

  it('shows a status pill — SBNO or Historic — and none for operating coasters', () => {
    renderTable(
      rowsFrom([
        { name: 'Standing', status: 'sbno' },
        { name: 'Gone', status: 'defunct' },
        { name: 'Live', status: 'operating' },
      ]),
    )
    expect(screen.getByText('SBNO')).toBeInTheDocument()
    expect(screen.getByText('Historic')).toBeInTheDocument()
    expect(screen.queryByText('Operating')).not.toBeInTheDocument()
  })

  it('does not render a first-place column header', () => {
    renderTable(rowsFrom())
    expect(screen.queryByText('#1 votes')).not.toBeInTheDocument()
  })

  it('shows the few-votes badge for low-comparison coasters', () => {
    renderTable(rowsFrom([{ name: 'Obscure', comparisons: FEW_VOTES_THRESHOLD - 1 }]))
    expect(screen.getByText('few votes')).toBeInTheDocument()
  })

  it('omits the few-votes badge at the threshold', () => {
    renderTable(rowsFrom([{ name: 'Popular', comparisons: FEW_VOTES_THRESHOLD }]))
    expect(screen.queryByText('few votes')).not.toBeInTheDocument()
  })

  it('does not render score, comparisons, or participants columns', () => {
    renderTable(rowsFrom())
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
    expect(screen.queryByText('Comparisons')).not.toBeInTheDocument()
    expect(screen.queryByText('Participants')).not.toBeInTheDocument()
  })

  it('hides the park column when showPark is false', () => {
    renderTable(rowsFrom([{ name: 'Twisted' }]), new Set(), false)
    expect(screen.queryByRole('link', { name: 'Test Park' })).not.toBeInTheDocument()
  })

  it('board variant swaps material for manufacturer and country', () => {
    renderTable(
      rowsFrom([
        {
          name: 'Steel Vengeance',
          slug: 'steel-vengeance',
          manufacturer_name: 'Intamin',
          park_country: 'United States',
        },
      ]),
      new Set(),
      true,
      'board',
    )
    expect(screen.getByText('Intamin')).toBeInTheDocument()
    expect(screen.getByText('United States')).toBeInTheDocument()
    expect(screen.queryByText('Material')).not.toBeInTheDocument()
    expect(screen.queryByText('Manufacturer')).not.toBeNull()
  })

  it('board variant shows an em dash for unknown manufacturer or country', () => {
    renderTable(
      rowsFrom([{ name: 'Mystery', manufacturer_name: null, park_country: null }]),
      new Set(),
      true,
      'board',
    )
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('board variant shows a quiet score column on the index scale, dashing unrated rows', () => {
    renderTable(
      rowsFrom([
        { name: 'Rated', score: 1.876, manufacturer_name: 'Intamin' },
        {
          name: 'Unrated',
          rank: null,
          score: null,
          comparisons: null,
          participants: null,
          manufacturer_name: 'Intamin',
        },
      ]),
      new Set(),
      true,
      'board',
    )
    expect(screen.getByText('Score')).toBeInTheDocument()
    // Index scale: 100 = community average (1.876 × 100 → 187.6).
    expect(screen.getByText('187.6')).toBeInTheDocument()
    // The unrated row dashes in both the rank and score columns.
    expect(screen.getAllByText('—')).toHaveLength(2)
  })

  it('default variant does not render a score column', () => {
    renderTable(rowsFrom())
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
  })

  it('board variant abbreviates the long manufacturer names with the full name on title', () => {
    renderTable(
      rowsFrom([
        { name: 'A', manufacturer_name: 'Rocky Mountain Construction' },
        { name: 'B', manufacturer_name: 'Bolliger & Mabillard' },
        { name: 'C', manufacturer_name: 'Intamin' },
      ]),
      new Set(),
      true,
      'board',
    )
    expect(screen.getByText('RMC')).toHaveAttribute('title', 'Rocky Mountain Construction')
    expect(screen.getByText('B&M')).toHaveAttribute('title', 'Bolliger & Mabillard')
    expect(screen.getByText('Intamin')).toHaveAttribute('title', 'Intamin')
  })

  it('navigates to the coaster page when a row is clicked', () => {
    renderWithRoutes(
      <CoasterTable
        rows={rowsFrom([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }])}
        firstPlaceIds={new Set()}
        showPark
        variant="board"
      />,
    )
    fireEvent.click(screen.getByText('1'))
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/coasters/steel-vengeance')
  })

  it('keeps the park link on its own target instead of the row target', () => {
    renderWithRoutes(
      <CoasterTable
        rows={rowsFrom([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }])}
        firstPlaceIds={new Set()}
        showPark
        variant="board"
      />,
    )
    fireEvent.click(screen.getByRole('link', { name: 'Test Park' }))
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/parks/test-park')
  })

  it('renders an empty message for no rows', () => {
    renderTable([])
    expect(screen.getByText('No coasters match those filters.')).toBeInTheDocument()
  })

  it('renders the stacked mobile list — name, badges, park, no material', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    )
    try {
      renderTable(rowsFrom([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }]))
      expect(screen.getByRole('link', { name: 'Steel Vengeance' })).toHaveAttribute(
        'href',
        '/coasters/steel-vengeance',
      )
      expect(screen.getByText('Test Park')).toBeInTheDocument()
      expect(screen.queryByText('Steel')).not.toBeInTheDocument()
      expect(screen.queryByRole('columnheader', { name: 'Coaster' })).not.toBeInTheDocument()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
