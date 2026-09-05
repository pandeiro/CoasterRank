import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ScorePill from './ScorePill'
import { makeRankingRow } from '../test/fixtures'

describe('ScorePill', () => {
  it('renders the index-scale score (score × 100, 1 dp)', () => {
    render(<ScorePill row={makeRankingRow({ score: 1.029 })} />)
    expect(screen.getByText('102.9')).toHaveClass('bg-accent/5', 'tabular-nums', 'text-ink')
  })

  it('renders nothing for an unrated coaster', () => {
    const { container } = render(<ScorePill row={makeRankingRow({ score: null })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the score is MISSING (payload skew, never "NaN")', () => {
    const { container } = render(
      <ScorePill row={makeRankingRow({ score: undefined as unknown as number | null })} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('settles on the new displayed value when the score changes', async () => {
    const { rerender } = render(<ScorePill row={makeRankingRow({ score: 1.029 })} />)
    rerender(<ScorePill row={makeRankingRow({ score: 1.035 })} />)
    // With rAF the value ticks up over ~600ms; without it, it snaps. Either
    // way the pill must end on the new 1-dp value. Generous timeout: under
    // parallel workers the jsdom frame clock can lag behind real time.
    await waitFor(
      () => {
        expect(screen.getByText('103.5')).toBeInTheDocument()
      },
      { timeout: 3000 },
    )
  })
})
