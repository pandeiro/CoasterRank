import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { makeUserRide, makeUserRideCoaster, makePark } from '../test/fixtures'
import RankedCoasterItem from './RankedCoasterItem'

function wrap(node: React.ReactNode) {
  return <MemoryRouter>{node}</MemoryRouter>
}

describe('RankedCoasterItem', () => {
  it('renders rank, coaster name, park, and material', () => {
    const ride = makeUserRide()
    const park = makePark({ name: 'Cedar Point' })
    render(
      wrap(
        <ul>
          <RankedCoasterItem ride={ride} rank={1} park={park} onRemove={vi.fn()} />
        </ul>,
      ),
    )
    expect(screen.getByText('Coaster 1')).toBeInTheDocument()
    expect(screen.getByText('Cedar Point')).toBeInTheDocument()
    expect(screen.getByText('Steel')).toBeInTheDocument()
  })

  it('calls onRemove when the remove button is clicked', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const ride = makeUserRide({
      coaster: {
        id: 'c1',
        name: 'Test Rider',
        slug: 'test-rider',
        status: 'operating',
        material: 'steel',
        park_id: 'p1',
        score: 1,
        comparisons: 10,
      },
    })
    render(
      wrap(
        <ul>
          <RankedCoasterItem ride={ride} rank={1} park={undefined} onRemove={onRemove} />
        </ul>,
      ),
    )
    await user.click(screen.getByRole('button', { name: /remove test rider/i }))
    expect(onRemove).toHaveBeenCalledWith(ride.coaster_id)
  })

  it('links the coaster name to the detail page', () => {
    const ride = makeUserRide({
      coaster: {
        id: 'c1',
        name: 'Steel Vengeance',
        slug: 'steel-vengeance',
        status: 'operating',
        material: 'steel',
        park_id: 'p1',
        score: 2.5,
        comparisons: 50,
      },
    })
    render(
      wrap(
        <ul>
          <RankedCoasterItem ride={ride} rank={3} park={undefined} onRemove={vi.fn()} />
        </ul>,
      ),
    )
    const link = screen.getByRole('link', { name: 'Steel Vengeance' })
    expect(link).toHaveAttribute('href', '/coasters/steel-vengeance')
  })

  it('shows dash for unranked items', () => {
    const ride = makeUserRide({ rank: null })
    render(
      wrap(
        <ul>
          <RankedCoasterItem ride={ride} rank={0} park={undefined} onRemove={vi.fn()} />
        </ul>,
      ),
    )
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows the drag handle only when handleProps is provided', () => {
    const ride = makeUserRide()
    const { rerender } = render(
      wrap(
        <ul>
          <RankedCoasterItem ride={ride} rank={1} park={undefined} onRemove={vi.fn()} />
        </ul>,
      ),
    )
    expect(screen.queryByRole('button', { name: /drag to reorder/i })).not.toBeInTheDocument()
    rerender(
      wrap(
        <ul>
          <RankedCoasterItem
            ride={ride}
            rank={1}
            park={undefined}
            onRemove={vi.fn()}
            handleProps={{}}
          />
        </ul>,
      ),
    )
    expect(screen.getByRole('button', { name: /drag to reorder/i })).toBeInTheDocument()
  })

  it('calls onRank when the add-to-ranking button is clicked', async () => {
    const user = userEvent.setup()
    const onRank = vi.fn()
    const ride = makeUserRide({
      rank: null,
      coaster: makeUserRideCoaster({ id: 'g1', name: 'Ghost Rider' }),
    })
    render(
      wrap(
        <ul>
          <RankedCoasterItem
            ride={ride}
            rank={0}
            park={undefined}
            onRemove={vi.fn()}
            onRank={onRank}
          />
        </ul>,
      ),
    )
    await user.click(screen.getByRole('button', { name: /add ghost rider to ranking/i }))
    expect(onRank).toHaveBeenCalledWith('g1')
  })
})
