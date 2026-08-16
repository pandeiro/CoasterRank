import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CoasterTable from './CoasterTable'
import { makeRankingRow } from '../test/fixtures'
import { FEW_VOTES_THRESHOLD } from '../lib/coasters'

function renderTable(overrides: Parameters<typeof makeRankingRow>[0][] = []) {
  const rows = overrides.length
    ? overrides.map((o) => makeRankingRow(o))
    : [makeRankingRow({ name: 'Steel Vengeance', slug: 'steel-vengeance' })]
  return render(
    <MemoryRouter>
      <CoasterTable rows={rows} />
    </MemoryRouter>,
  )
}

describe('CoasterTable', () => {
  it('renders rank, name, park, and material', () => {
    renderTable([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }])
    expect(screen.getByText('Steel Vengeance')).toBeInTheDocument()
    expect(screen.getByText('Test Park')).toBeInTheDocument()
    expect(screen.getByText('Steel')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
  })

  it('links to the coaster and park detail pages', () => {
    renderTable([{ name: 'Steel Vengeance', slug: 'steel-vengeance' }])
    expect(screen.getByRole('link', { name: 'Steel Vengeance' })).toHaveAttribute(
      'href',
      '/coasters/steel-vengeance',
    )
    expect(screen.getByRole('link', { name: 'Test Park' })).toHaveAttribute(
      'href',
      '/parks/test-park',
    )
  })

  it('shows an em dash for missing scores', () => {
    renderTable([{ name: 'Unrated', score: null, comparisons: null, participants: null }])
    expect(screen.getByText('Unrated')).toBeInTheDocument()
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(3)
  })

  it('shows the few-votes badge for low-comparison coasters', () => {
    renderTable([{ name: 'Obscure', comparisons: FEW_VOTES_THRESHOLD - 1 }])
    expect(screen.getByText('few votes')).toBeInTheDocument()
  })

  it('omits the few-votes badge at the threshold', () => {
    renderTable([{ name: 'Popular', comparisons: FEW_VOTES_THRESHOLD }])
    expect(screen.queryByText('few votes')).not.toBeInTheDocument()
  })

  it('hides the park column when showPark is false', () => {
    const rows = [makeRankingRow({ name: 'Twisted' })]
    render(
      <MemoryRouter>
        <CoasterTable rows={rows} showPark={false} />
      </MemoryRouter>,
    )
    expect(screen.queryByRole('link', { name: 'Test Park' })).not.toBeInTheDocument()
  })

  it('renders an empty message for no rows', () => {
    render(
      <MemoryRouter>
        <CoasterTable rows={[]} />
      </MemoryRouter>,
    )
    expect(screen.getByText('No coasters match those filters.')).toBeInTheDocument()
  })
})
