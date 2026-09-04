import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import Layout from './Layout'
import { AuthContext, type AuthContextValue } from '../lib/auth-context'

// The board-page hero observer constructs IntersectionObserver unconditionally;
// jsdom has no implementation.
vi.stubGlobal(
  'IntersectionObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
)

const anonymousAuth: AuthContextValue = {
  session: null,
  user: null,
  isLoading: false,
  isConfirmed: false,
  signOut: vi.fn(),
}

function renderLayout(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <AuthContext.Provider value={anonymousAuth}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/" element={<p>board</p>} />
              <Route path="/me" element={<p>my coasters</p>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </AuthContext.Provider>,
  )
}

describe('Layout', () => {
  it('hides the brand logo on the board until the hero is scrolled past', () => {
    renderLayout('/')
    expect(screen.getByText('board')).toBeInTheDocument()
    // The board hero anchors home; the sticky logo only fades in past it
    // (jsdom observer never fires, so we pin the top-of-page state).
    expect(screen.queryByRole('link', { name: /coasterrank/i })).not.toBeInTheDocument()
  })

  it('renders the brand header linking back to the global ranking on sub-pages', () => {
    renderLayout('/me')
    expect(screen.getByText('my coasters')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /coasterrank/i })).toHaveAttribute('href', '/')
    // Sub-pages get the solid scrolled-board chrome, not the transparent hero state.
    expect(screen.getByRole('banner')).toHaveClass('bg-canvas/95', 'border-line/80')
  })
})
