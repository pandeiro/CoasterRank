import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import AboutPage from './AboutPage'

const OPEN_LABEL = "OK, that's enough math for today"

describe('AboutPage', () => {
  it('renders with dek, section headings, and key links', () => {
    render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(
      screen.getByText('CoasterRank is a free, open-source leaderboard for roller coasters.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Backstory' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'How the ranking works' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Open source, and open to you' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '← Back to the board' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'More questions? Read the FAQ' })).toHaveAttribute(
      'href',
      '/faq',
    )
    expect(screen.getByRole('link', { name: 'open source on GitHub' })).toHaveAttribute(
      'href',
      'https://github.com/pandeiro/CoasterRank',
    )
    expect(screen.getByRole('link', { name: 'Bradley-Terry' })).toHaveAttribute(
      'href',
      'https://en.wikipedia.org/wiki/Bradley%E2%80%93Terry_model',
    )
    expect(screen.getByRole('link', { name: 'ACE' })).toHaveAttribute(
      'href',
      'https://aceonline.org/',
    )
    expect(screen.getByRole('link', { name: 'VoteCoasters' })).toHaveAttribute(
      'href',
      'https://votecoasters.com/',
    )
    // Math disclosures start collapsed and KaTeX is not loaded.
    expect(screen.getByRole('button', { name: 'Show me the math' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
    expect(screen.getByRole('button', { name: 'Show me the weighting' })).toBeInTheDocument()
  })

  it('swaps toggle copy and lazy-renders KaTeX when a disclosure is opened', async () => {
    const user = userEvent.setup()
    const { container } = render(
      <MemoryRouter>
        <AboutPage />
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: 'Show me the math' }))
    // Open state shows the dismiss label.
    const openToggle = screen.getByRole('button', { name: OPEN_LABEL })
    expect(openToggle).toHaveAttribute('aria-expanded', 'true')
    // The second disclosure keeps its closed label.
    expect(screen.getByRole('button', { name: 'Show me the weighting' })).toBeInTheDocument()
    // KaTeX arrives via dynamic import; the panel then renders typeset math.
    expect(await screen.findByText(/anchor/)).toBeInTheDocument()
    await waitFor(() => expect(container.querySelectorAll('.katex-display')).toHaveLength(2))
    // Opening a second disclosure keeps the first open (independent state).
    await user.click(screen.getByRole('button', { name: 'Show me the weighting' }))
    await waitFor(() => expect(screen.getAllByRole('button', { name: OPEN_LABEL })).toHaveLength(2))
    expect(container.querySelectorAll('.katex-display')).toHaveLength(4)
  })
})
