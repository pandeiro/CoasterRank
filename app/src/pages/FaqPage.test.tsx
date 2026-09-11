import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { HelmetProvider } from 'react-helmet-async'
import { MemoryRouter } from 'react-router-dom'
import FaqPage from './FaqPage'

function renderFaq() {
  return render(
    <HelmetProvider>
      <MemoryRouter>
        <FaqPage />
      </MemoryRouter>
    </HelmetProvider>,
  )
}

describe('FaqPage', () => {
  it('renders all questions with in-app links', () => {
    renderFaq()
    expect(screen.getByRole('heading', { name: 'FAQ' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 })).toHaveLength(8)
    expect(screen.queryByRole('link', { name: /back to the board/i })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'How the ranking works' })).toHaveAttribute(
      'href',
      '/about',
    )
    expect(screen.getByRole('link', { name: 'Submit page' })).toHaveAttribute('href', '/submit')
  })

  it('sets SEO meta and FAQPage JSON-LD covering every question', async () => {
    renderFaq()
    await waitFor(() => {
      expect(document.title).toBe('FAQ — CoasterRank')
    })
    expect(
      document.head.querySelector('meta[name="description"]')?.getAttribute('content'),
    ).toContain('head-to-head')
    expect(document.head.querySelector('link[rel="canonical"]')?.getAttribute('href')).toContain(
      '/faq',
    )
    const jsonLd = JSON.parse(
      document.querySelector('script[type="application/ld+json"]')?.textContent ?? 'null',
    )
    expect(jsonLd['@type']).toBe('FAQPage')
    expect(jsonLd.mainEntity).toHaveLength(8)
    expect(jsonLd.mainEntity[0].name).toContain('head-to-head')
    expect(jsonLd.mainEntity[0].acceptedAnswer.text).toContain('Star averages')
  })
})
