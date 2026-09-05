import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import MovementChip from './MovementChip'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MovementChip', () => {
  it('shows a climb and a drop', () => {
    render(
      <>
        <MovementChip delta={2} index={0} />
        <MovementChip delta={-1} index={1} />
      </>,
    )
    expect(screen.getByText('↑2')).toBeInTheDocument()
    expect(screen.getByText('↓1')).toBeInTheDocument()
  })

  it('renders nothing for a zero delta', () => {
    const { container } = render(<MovementChip delta={0} index={0} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is decorative (aria-hidden) and runs the evaporation animation', () => {
    render(<MovementChip delta={3} index={4} />)
    const chip = screen.getByText('↑3')
    expect(chip).toHaveAttribute('aria-hidden', 'true')
    // Stagger is capped so tail rows can't outlive the linger window.
    expect(chip.style.animationDelay).toBe('120ms')
  })

  it('drops the animation under prefers-reduced-motion', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches: true }), // any query → reduced here
    )
    render(<MovementChip delta={3} index={0} />)
    const chip = screen.getByText('↑3')
    expect(chip.className).not.toContain('animate-')
    expect(chip.style.animationDelay).toBe('')
  })
})
