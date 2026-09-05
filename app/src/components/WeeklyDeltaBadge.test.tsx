import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import WeeklyDeltaBadge from './WeeklyDeltaBadge'
import { makeRankingRow } from '../test/fixtures'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('WeeklyDeltaBadge', () => {
  it('shows a climb with the word label for screen readers', () => {
    render(<WeeklyDeltaBadge row={makeRankingRow({ rank: 3, rank_last_week: 5 })} />)
    expect(screen.getByText('↑2')).toBeInTheDocument()
    expect(screen.getByText('Up 2 places this week')).toHaveClass('sr-only')
  })

  it('shows a drop', () => {
    render(<WeeklyDeltaBadge row={makeRankingRow({ rank: 5, rank_last_week: 3 })} />)
    expect(screen.getByText('↓2')).toBeInTheDocument()
    expect(screen.getByText('Down 2 places this week')).toHaveClass('sr-only')
  })

  it('uses the singular for one place', () => {
    render(<WeeklyDeltaBadge row={makeRankingRow({ rank: 4, rank_last_week: 5 })} />)
    expect(screen.getByText('Up 1 place this week')).toBeInTheDocument()
  })

  it('renders nothing without a change', () => {
    const { container } = render(
      <WeeklyDeltaBadge row={makeRankingRow({ rank: 3, rank_last_week: 3 })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing without a baseline (first week / new coaster)', () => {
    const { container } = render(
      <WeeklyDeltaBadge row={makeRankingRow({ rank: 3, rank_last_week: null })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the field is MISSING (pre-migration payload skew)', () => {
    // Regression guard: undefined must degrade to silence, never "↓NaN".
    const { container } = render(
      <WeeklyDeltaBadge
        row={makeRankingRow({ rank: 3, rank_last_week: undefined as unknown as number | null })}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
