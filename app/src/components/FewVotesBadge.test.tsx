import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import FewVotesBadge from './FewVotesBadge'
import { FEW_VOTES_THRESHOLD } from '../lib/coasters'

describe('FewVotesBadge', () => {
  it('renders nothing for null comparisons', () => {
    render(<FewVotesBadge comparisons={null} />)
    expect(screen.queryByText('few votes')).not.toBeInTheDocument()
  })

  it('renders the badge below the threshold', () => {
    render(<FewVotesBadge comparisons={FEW_VOTES_THRESHOLD - 1} />)
    expect(screen.getByText('few votes')).toBeInTheDocument()
  })

  it('renders nothing at or above the threshold', () => {
    render(<FewVotesBadge comparisons={FEW_VOTES_THRESHOLD} />)
    expect(screen.queryByText('few votes')).not.toBeInTheDocument()
  })
})
