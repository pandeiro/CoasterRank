import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SharingPanel from './SharingPanel'
import { fetchSharingMetrics, type SharingMetrics } from '../../lib/sharingMetrics'

vi.mock('../../lib/sharingMetrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/sharingMetrics')>()
  return { ...actual, fetchSharingMetrics: vi.fn() }
})

const payload: SharingMetrics = {
  generatedAt: '2026-09-10T12:00:00Z',
  window: { start: '2026-08-11T00:00:00Z', end: '2026-09-10T00:00:00Z' },
  funnel: {
    totals: { totalUsers: 7, withUsername: 7, eligible: 5, nudged: 0, sharingOn: 4 },
    sharers: [
      { username: 'pibe4life', rankedCount: 96, nudged: false },
      { username: 'pandeiro', rankedCount: 87, nudged: false },
    ],
    signupsDaily: [{ day: '2026-09-01', count: 1 }],
  },
  rum: {
    available: true,
    sampleIntervalMax: 10,
    daily: [
      { day: '2026-09-01', pageviews: 3, visits: 2 },
      { day: '2026-09-02', pageviews: 1, visits: 1 },
    ],
    topPaths: [
      { path: '/riders/pibe4life', pageviews: 4, visits: 3, status: 'sharing' },
      { path: '/riders/pandeiro', pageviews: 2, visits: 2, status: 'private' },
      { path: '/riders/mock0001', pageviews: 10, visits: 0, status: 'unknown' },
    ],
    topReferrers: [
      { host: 'www.reddit.com', pageviews: 4, visits: 3 },
      { host: '', pageviews: 2, visits: 2 },
    ],
  },
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <SharingPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.mocked(fetchSharingMetrics).mockReset()
})

describe('SharingPanel', () => {
  it('renders the funnel, sharers, and RUM traffic', async () => {
    vi.mocked(fetchSharingMetrics).mockResolvedValue(payload)
    renderPanel()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Funnel' })).toBeInTheDocument()
    })
    // Funnel stages render with counts and stage-over-stage percentages
    // (labels appear in both the stat row and the table; the table-only one is
    // matched exactly). 5 eligible / 7 riders = 71%; 4 sharing / 0 nudged = —.
    expect(screen.getByText('Eligible')).toBeInTheDocument()
    expect(screen.getAllByText('Sharing on')).toHaveLength(2)
    expect(screen.getByText('71%')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    // Sharers link to their public pages.
    const link = screen.getByRole('link', { name: '@pibe4life' })
    expect(link).toHaveAttribute('href', '/riders/pibe4life')
    // RUM paths + referrers, with "(direct)" for the empty host.
    expect(screen.getByRole('link', { name: '/riders/pandeiro' })).toBeInTheDocument()
    expect(screen.getByText('(direct)')).toBeInTheDocument()
    // Column headers disambiguate views vs visits ("Views" appears in both
    // the top-pages and referrer tables).
    expect(screen.getAllByRole('columnheader', { name: 'Views' })).toHaveLength(2)
    expect(screen.getByRole('columnheader', { name: 'Visits' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'State' })).toBeInTheDocument()
    // Profile-state badges: stale paths read as gone, not as live traffic.
    expect(screen.getByText('sharing')).toBeInTheDocument()
    expect(screen.getByText('private')).toBeInTheDocument()
    expect(screen.getByText('gone')).toBeInTheDocument()
    // Overlay chart is present.
    expect(screen.getByRole('img', { name: /vs/i })).toBeInTheDocument()
  })

  it('degrades the traffic section when RUM is unavailable', async () => {
    vi.mocked(fetchSharingMetrics).mockResolvedValue({
      ...payload,
      rum: {
        available: false,
        reason: 'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID secrets not set',
      },
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('Web Analytics unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText(/secrets not set/)).toBeInTheDocument()
    // Funnel half must still render.
    expect(screen.getByRole('heading', { name: 'Funnel' })).toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /vs/i })).not.toBeInTheDocument()
  })

  it('shows an error state with the failure message', async () => {
    vi.mocked(fetchSharingMetrics).mockRejectedValue(new Error('admin access required'))
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/admin access required/)).toBeInTheDocument()
    })
  })

  it('shows an empty-traffic hint when nobody has viewed shared pages', async () => {
    vi.mocked(fetchSharingMetrics).mockResolvedValue({
      ...payload,
      rum: { ...payload.rum, available: true, daily: [], topPaths: [], topReferrers: [] },
    })
    renderPanel()

    await waitFor(() => {
      expect(screen.getByText(/No human pageviews on shared pages yet/)).toBeInTheDocument()
    })
  })
})
