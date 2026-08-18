import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminPage from './AdminPage'
import { supabase } from '../lib/supabase'

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}))

function renderPage() {
  const queryClient = new QueryClient()
  queryClient.clear()
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminPage />
    </QueryClientProvider>,
  )
}

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('triggers the recompute function and reports the result', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: { updated: 42, durationMs: 120, iterations: 7, converged: true },
      error: null,
    } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /recompute now/i }))
    expect(supabase.functions.invoke).toHaveBeenCalledWith('recompute-rankings', {
      method: 'POST',
    })
    expect(
      await screen.findByText(/Updated 42 coaster ratings in 120 ms.*converged/),
    ).toBeInTheDocument()
  })

  it('shows the failure message when the function errors', async () => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({
      data: null,
      error: { message: 'admin access required' },
    } as never)
    renderPage()
    await userEvent.click(screen.getByRole('button', { name: /recompute now/i }))
    expect(await screen.findByText(/Recompute failed: admin access required/)).toBeInTheDocument()
  })
})
