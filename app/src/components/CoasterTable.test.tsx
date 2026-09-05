import { describe, it, expect } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import CoasterTable, { rankFontClass } from './CoasterTable'
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

// §8.3: both layouts always render (CSS-gated, no JS breakpoint) — tests
// scope queries per surface instead of stubbing matchMedia.
function desktopTable() {
  return screen.getByRole('table')
}

function mobileList() {
  return screen.getByRole('list')
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
  it('renders rank, name, park, and material in the desktop table', () => {
    renderTable(rowsFrom([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }]))
    const table = within(desktopTable())
    expect(table.getByText('Steel Vengeance')).toBeInTheDocument()
    expect(table.getByText('Test Park')).toBeInTheDocument()
    expect(table.getByText('Steel')).toBeInTheDocument()
    expect(table.getByText('1')).toBeInTheDocument()
    expect(screen.queryByText('Manufacturer')).not.toBeInTheDocument()
  })

  it('renders the same row in the mobile list, without material or headers', () => {
    renderTable(rowsFrom([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }]))
    const list = within(mobileList())
    expect(list.getByRole('link', { name: 'Steel Vengeance' })).toHaveAttribute(
      'href',
      '/coasters/steel-vengeance',
    )
    expect(list.getByText('Test Park')).toBeInTheDocument()
    expect(within(mobileList()).queryByText('Steel')).not.toBeInTheDocument()
    expect(within(mobileList()).queryAllByRole('columnheader')).toHaveLength(0)
  })

  it('links to the coaster and park detail pages', () => {
    renderTable(rowsFrom([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }]))
    for (const link of screen.getAllByRole('link', { name: 'Steel Vengeance' })) {
      expect(link).toHaveAttribute('href', '/coasters/steel-vengeance')
    }
    for (const link of screen.getAllByRole('link', { name: 'Test Park' })) {
      expect(link).toHaveAttribute('href', '/parks/test-park')
    }
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
    expect(screen.getAllByText('Unrated').length).toBe(2)
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2)
  })

  it('numbers the visible list gaplessly, skipping unrated rows', () => {
    renderTable(
      rowsFrom([
        { name: 'Fifth', rank: 5 },
        { name: 'Unrated', rank: null, score: null, comparisons: null, participants: null },
        { name: 'Seventh', rank: 7 },
      ]),
    )
    const table = within(desktopTable())
    expect(table.getByText('1')).toBeInTheDocument()
    expect(table.getByText('2')).toBeInTheDocument()
    expect(table.getByText('—')).toBeInTheDocument()
    expect(table.queryByText('5')).not.toBeInTheDocument()
    expect(table.queryByText('7')).not.toBeInTheDocument()
    // The mobile list mirrors the same numbering.
    const list = within(mobileList())
    expect(list.getByText('1')).toBeInTheDocument()
    expect(list.getByText('2')).toBeInTheDocument()
  })

  it('shows first-place votes for gated-in coasters', () => {
    const rows = rowsFrom([{ name: 'Steel Vengeance', first_place_votes: 114, participants: 131 }])
    renderTable(rows, new Set([rows[0].id]))
    expect(screen.getAllByText('114 (87%)')).toHaveLength(2)
  })

  it('hides first-place data for gated-out coasters even when votes exist', () => {
    renderTable(rowsFrom([{ name: 'Popular', first_place_votes: 9, participants: 10 }]))
    expect(screen.queryByText('9 (90%)')).not.toBeInTheDocument()
  })

  it('shows a status pill — SBNO or Historic — in both layouts, none for operating', () => {
    renderTable(
      rowsFrom([
        { name: 'Standing', status: 'sbno' },
        { name: 'Gone', status: 'defunct' },
        { name: 'Live', status: 'operating' },
      ]),
    )
    expect(screen.getAllByText('SBNO')).toHaveLength(2)
    expect(screen.getAllByText('Historic')).toHaveLength(2)
    expect(screen.queryByText('Operating')).not.toBeInTheDocument()
  })

  it('does not render a first-place column header', () => {
    renderTable(rowsFrom())
    expect(screen.queryByText('#1 votes')).not.toBeInTheDocument()
  })

  it('shows the few-votes badge for low-comparison coasters', () => {
    renderTable(rowsFrom([{ name: 'Obscure', comparisons: FEW_VOTES_THRESHOLD - 1 }]))
    expect(screen.getAllByText('few votes')).toHaveLength(2)
  })

  it('omits the few-votes badge at the threshold', () => {
    renderTable(rowsFrom([{ name: 'Popular', comparisons: FEW_VOTES_THRESHOLD }]))
    expect(screen.queryByText('few votes')).not.toBeInTheDocument()
  })

  it('does not render score, comparisons, or participants columns by default', () => {
    renderTable(rowsFrom())
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
    expect(screen.queryByText('Comparisons')).not.toBeInTheDocument()
    expect(screen.queryByText('Participants')).not.toBeInTheDocument()
  })

  it('hides the park column when showPark is false', () => {
    renderTable(rowsFrom([{ name: 'Twisted' }]), new Set(), false)
    expect(screen.queryAllByRole('link', { name: 'Test Park' })).toHaveLength(0)
  })

  it('board variant swaps material for manufacturer and drops the country column (§4.1)', () => {
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
    // Manufacturer lives in the desktop table only (the mobile list skips it).
    expect(within(desktopTable()).getByText('Intamin')).toBeInTheDocument()
    expect(within(mobileList()).queryByText('Intamin')).not.toBeInTheDocument()
    // §4.1: Country is gone — park/manufacturer carry location.
    expect(within(desktopTable()).queryByText('Country')).not.toBeInTheDocument()
    expect(within(desktopTable()).queryByText('United States')).not.toBeInTheDocument()
    expect(within(desktopTable()).queryByText('Material')).not.toBeInTheDocument()
    expect(within(desktopTable()).getByText('Manufacturer')).toBeInTheDocument()
  })

  it('board variant shows an em dash for unknown manufacturer', () => {
    renderTable(
      rowsFrom([{ name: 'Mystery', manufacturer_name: null, park_country: null }]),
      new Set(),
      true,
      'board',
    )
    // One dash: the manufacturer cell (the country column no longer exists).
    expect(within(desktopTable()).getAllByText('—')).toHaveLength(1)
  })

  it('board variant shows the score column on the index scale, dashing unrated rows', () => {
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
    expect(within(desktopTable()).getByText('Score')).toBeInTheDocument()
    // Index scale: 100 = community average (1.876 × 100 → 187.6).
    expect(within(desktopTable()).getByText('187.6')).toBeInTheDocument()
    // The unrated row dashes in both the rank and score columns.
    expect(within(desktopTable()).getAllByText('—')).toHaveLength(2)
  })

  it('default variant does not render a score column', () => {
    renderTable(rowsFrom())
    expect(screen.queryByText('Score')).not.toBeInTheDocument()
  })

  it('abbreviates long manufacturer names — B&M, RMC, GCI, CCI (§4.2)', () => {
    renderTable(
      rowsFrom([
        { name: 'A', manufacturer_name: 'Rocky Mountain Construction' },
        { name: 'B', manufacturer_name: 'Bolliger & Mabillard' },
        { name: 'C', manufacturer_name: 'Great Coasters International' },
        { name: 'D', manufacturer_name: 'Custom Coasters International' },
        { name: 'E', manufacturer_name: 'Intamin' },
      ]),
      new Set(),
      true,
      'board',
    )
    const table = within(desktopTable())
    expect(table.getByText('RMC')).toHaveAttribute('title', 'Rocky Mountain Construction')
    expect(table.getByText('B&M')).toHaveAttribute('title', 'Bolliger & Mabillard')
    expect(table.getByText('GCI')).toHaveAttribute('title', 'Great Coasters International')
    expect(table.getByText('CCI')).toHaveAttribute('title', 'Custom Coasters International')
    expect(table.getByText('Intamin')).toHaveAttribute('title', 'Intamin')
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
    fireEvent.click(within(desktopTable()).getByText('1'))
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
    fireEvent.click(screen.getAllByRole('link', { name: 'Test Park' })[0])
    expect(screen.getByTestId('route-probe')).toHaveTextContent('/parks/test-park')
  })

  it('renders an empty message for no rows', () => {
    renderTable([])
    expect(screen.getByText('No coasters match those filters.')).toBeInTheDocument()
  })

  // §5.1–5.3, decided: EVERY rank is a white circle (ink drop shadow) with
  // an accent-blue display-font numeral, centered; the podium ramp comes
  // from the row tint instead.
  it('treats every rank as a white circle with a display-font accent numeral', () => {
    renderTable(
      rowsFrom([
        { name: 'First', rank: 1 },
        { name: 'Second', rank: 2 },
        { name: 'Third', rank: 3 },
        { name: 'Fourth', rank: 4 },
      ]),
      new Set(),
      true,
      'board',
    )
    const table = within(desktopTable())
    for (const rank of ['1', '2', '4']) {
      const circle = table.getByText(rank).closest('span')
      expect(circle).toHaveClass('rounded-full', 'bg-white', 'text-accent-strong', 'h-10', 'w-10')
      expect(circle).toHaveClass('display-heading', 'items-center', 'justify-center')
      expect(circle).toHaveClass('shadow-[0_1px_2px_rgb(26_26_46_/_0.18)]')
    }
  })

  it('shrinks wide ranks one tier at ≥100 and again at ≥1000 (§5.2)', () => {
    // The display numbering is gapless over the given rows, so the wide
    // positions are exercised via the pure helper.
    expect(rankFontClass(47)).toBe('text-base')
    expect(rankFontClass(99)).toBe('text-base')
    expect(rankFontClass(100)).toBe('text-sm')
    expect(rankFontClass(999)).toBe('text-sm')
    expect(rankFontClass(1000)).toBe('text-xs')
  })

  it('right-aligns the rank column and keeps the gutter tight (§5.1/§5.2)', () => {
    renderTable(rowsFrom(), new Set(), true, 'board')
    const table = within(desktopTable())
    const rankCell = table.getByText('1').closest('td')
    expect(rankCell).toHaveClass('text-right', 'px-3', 'py-2.5')
    const coasterCell = table.getByText('Steel Vengeance').closest('td')
    expect(coasterCell).toHaveClass('pl-3')
  })

  it('applies the muted coral podium tints — three distinct shades (§6.1)', () => {
    renderTable(
      rowsFrom([
        { name: 'First', rank: 1 },
        { name: 'Second', rank: 2 },
        { name: 'Third', rank: 3 },
        { name: 'Fourth', rank: 4 },
      ]),
      new Set(),
      true,
      'board',
    )
    const table = within(desktopTable())
    expect(table.getByText('First').closest('tr')).toHaveClass('bg-coral/[0.05]')
    expect(table.getByText('Second').closest('tr')).toHaveClass('bg-coral/[0.03]')
    expect(table.getByText('Third').closest('tr')).toHaveClass('bg-coral/[0.015]')
    expect(table.getByText('Fourth').closest('tr')).toHaveClass('hover:bg-canvas')
    expect(table.getByText('Fourth').closest('tr')).not.toHaveClass('bg-coral/[0.05]')
  })

  it('densifies rows ~5% on both layouts (§6.2)', () => {
    renderTable(rowsFrom(), new Set(), true, 'board')
    // Desktop density lives on the cells.
    const row = within(desktopTable()).getAllByRole('row')[1] as HTMLTableRowElement
    for (const cell of Array.from(row.cells)) {
      expect(cell).toHaveClass('py-2.5')
    }
    // Mobile list: tighter padding + a 52px floor + the tightened gutter.
    const li = within(mobileList()).getAllByRole('listitem')[0]
    expect(li).toHaveClass('py-2.5', 'min-h-[52px]', 'gap-2.5')
  })

  it('emphasizes the score with an accent-tinted rounded background (§7.1)', () => {
    renderTable(rowsFrom([{ name: 'Rated', score: 1.029 }]), new Set(), true, 'board')
    const score = within(desktopTable()).getByText('102.9')
    expect(score).toHaveClass('bg-accent/5', 'rounded-md', 'font-semibold', 'tabular-nums', 'text-ink')
  })

  it('centers the mobile score vertically inside the accent pill (§7.2)', () => {
    renderTable(rowsFrom([{ name: 'Rated', score: 1.029 }]))
    const li = within(mobileList()).getAllByRole('listitem')[0]
    expect(li).toHaveClass('items-center')
    const score = within(mobileList()).getByText('102.9')
    expect(score).toHaveClass('self-center', 'bg-accent/5', 'rounded-md')
  })
})
