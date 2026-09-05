import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'
import { useAllCoasters, useBoardMeta, useRankedUserCount } from './lib/coasters'
import { supabase } from './lib/supabase'
import { makeRankingRow } from './test/fixtures'

vi.mock('./lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/coasters')>()
  return {
    ...actual,
    useAllCoasters: vi.fn(),
    useRankedUserCount: vi.fn(),
    useBoardMeta: vi.fn(),
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
    vi.mocked(useRankedUserCount).mockReturnValue({
      data: 0,
      isPending: false,
      isError: false,
    } as never)
    vi.mocked(useBoardMeta).mockReturnValue({
      data: { last_recomputed_at: null, real_user_count: null, generated_at: '' },
      isPending: false,
      isError: false,
    } as never)
    vi.mocked(useAllCoasters).mockReturnValue({
      data: [makeRankingRow({ name: 'Steel Vengeance', slug: 'steel-vengeance' })],
      isPending: false,
      isError: false,
    } as never)

    render(<App />)
    expect(await screen.findByRole('heading', { name: /coasterrank/i })).toBeInTheDocument()
    // Both CSS-gated layouts render the row.
    expect(screen.getAllByText('Steel Vengeance')).toHaveLength(2)
  })
})
