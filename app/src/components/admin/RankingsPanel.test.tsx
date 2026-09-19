import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import RankingsPanel from './RankingsPanel'
import { supabase } from '../../lib/supabase'

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            limit: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            })),
          })),
        })),
        order: vi.fn(() => ({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
    })),
    rpc: vi.fn(),
    functions: {
      invoke: vi.fn(),
    },
  },
}))

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })
  return render(
    <QueryClientProvider client={qc}>
      <RankingsPanel />
    </QueryClientProvider>,
  )
}

describe('RankingsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders recompute button and empty state gracefully', () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never)
    renderPanel()
    expect(screen.getByRole('button', { name: /recompute now/i })).toBeInTheDocument()
  })

  it('displays next scheduled run when schedule data is returned', async () => {
    const futureRun = new Date(Date.now() + 180_000).toISOString() // 3m in future
    vi.mocked(supabase.rpc).mockImplementation((async (fn: string) => {
      if (fn === 'ranking_schedule') {
        return {
          data: {
            schedule: '*/5 * * * *',
            active: true,
            cadence_ms: 300000,
            next_run: futureRun,
            next_runs: [futureRun],
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }) as never)

    renderPanel()
    expect(await screen.findByText(/Next scheduled run:/)).toBeInTheDocument()
    expect(screen.getByText(/schedule: \*\//)).toBeInTheDocument()
  })

  it('displays paused message when cron schedule is inactive', async () => {
    vi.mocked(supabase.rpc).mockImplementation((async (fn: string) => {
      if (fn === 'ranking_schedule') {
        return {
          data: {
            schedule: '*/5 * * * *',
            active: false,
            cadence_ms: null,
            next_run: null,
            next_runs: [],
          },
          error: null,
        }
      }
      return { data: null, error: null }
    }) as never)

    renderPanel()
    expect(await screen.findByText('Scheduled runs paused (cron inactive)')).toBeInTheDocument()
  })
})
