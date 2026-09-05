import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import FaqPage from './FaqPage'

describe('FaqPage', () => {
  it('renders all questions with links back to the board', () => {
    render(
      <MemoryRouter>
        <FaqPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'FAQ' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(8)
    expect(screen.getByRole('link', { name: '← Back to the board' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'How the ranking works' })).toHaveAttribute(
      'href',
      '/about',
    )
    expect(screen.getByRole('link', { name: 'Submit page' })).toHaveAttribute('href', '/submit')
  })
})
