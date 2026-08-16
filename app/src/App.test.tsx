import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'
import { useRankings, useParks, useCountries, useManufacturers } from './lib/coasters'
import { supabase } from './lib/supabase'
import { makeRankingRow } from './test/fixtures'

vi.mock('./lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/coasters')>()
  return {
    ...actual,
    useRankings: vi.fn(),
    useParks: vi.fn(),
    useCountries: vi.fn(),
    useManufacturers: vi.fn(),
  }
})

vi.mock('./lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signOut: vi.fn(),
    },
  },
}))

describe('App', () => {
  it('renders the board on the home route', async () => {
    vi.mocked(supabase.auth.getSession).mockResolvedValue({
      data: { session: null },
      error: null,
    } as never)
    vi.mocked(supabase.auth.onAuthStateChange).mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    } as never)
    vi.mocked(useParks).mockReturnValue({ data: [] } as never)
    vi.mocked(useCountries).mockReturnValue({ data: [] } as never)
    vi.mocked(useManufacturers).mockReturnValue({ data: [] } as never)
    vi.mocked(useRankings).mockReturnValue({
      data: {
        pages: [[makeRankingRow({ name: 'Steel Vengeance', slug: 'steel-vengeance' })]],
        pageParams: [0],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      fetchNextPage: vi.fn(),
      isFetchingNextPage: false,
    } as never)

    render(<App />)
    expect(await screen.findByRole('heading', { name: /coasterrank/i })).toBeInTheDocument()
    expect(screen.getByText('Steel Vengeance')).toBeInTheDocument()
  })
})
