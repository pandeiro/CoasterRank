import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import StatBlock from './StatBlock'

describe('StatBlock', () => {
  it('renders the label and value', () => {
    render(<StatBlock label="Height" value="32 m" />)
    expect(screen.getByText('Height')).toBeInTheDocument()
    expect(screen.getByText('32 m')).toBeInTheDocument()
  })

  it('renders an element value', () => {
    render(
      <StatBlock
        label="Score"
        value={
          <span>
            <strong>1.5</strong>
          </span>
        }
      />,
    )
    expect(screen.getByText('Score')).toBeInTheDocument()
    expect(screen.getByText('1.5')).toBeInTheDocument()
  })
})
