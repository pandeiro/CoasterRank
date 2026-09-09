import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import NotFoundPage from './NotFoundPage'

describe('NotFoundPage', () => {
  it('renders the 404 message (navigation happens via the top nav)', () => {
    render(
      <MemoryRouter>
        <NotFoundPage />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: /page not found/i })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /back to the board/i })).not.toBeInTheDocument()
  })
})

function RiderStub() {
  const { pathname } = useLocation()
  return <p data-testid="rider-path">{pathname}</p>
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/riders/:username" element={<RiderStub />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('NotFoundPage: /@username alias redirect', () => {
  it('navigates the /@username alias to the canonical /riders route', () => {
    renderAt('/@pandeiro')
    expect(screen.getByTestId('rider-path')).toHaveTextContent('/riders/pandeiro')
  })

  it('canonicalizes mixed case to the lowercase username', () => {
    renderAt('/@Pandeiro')
    expect(screen.getByTestId('rider-path')).toHaveTextContent('/riders/pandeiro')
  })

  it('decodes %-encoded @ from chat-app shares', () => {
    renderAt('/%40pandeiro')
    expect(screen.getByTestId('rider-path')).toHaveTextContent('/riders/pandeiro')
  })

  it('accepts a trailing slash', () => {
    renderAt('/@pandeiro/')
    expect(screen.getByTestId('rider-path')).toHaveTextContent('/riders/pandeiro')
  })

  it('shows the 404 for segments that cannot be usernames', () => {
    renderAt('/@ab')
    expect(screen.getByText('Page not found')).toBeInTheDocument()
  })

  it('shows the 404 for unrelated unknown paths', () => {
    renderAt('/nowhere')
    expect(screen.getByText('Page not found')).toBeInTheDocument()
  })
})
