import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import BoardPage from './pages/BoardPage'

describe('BoardPage', () => {
  it('renders the CoasterRank heading', () => {
    render(<BoardPage />)
    expect(screen.getByRole('heading', { name: /coasterrank/i })).toBeInTheDocument()
  })
})
