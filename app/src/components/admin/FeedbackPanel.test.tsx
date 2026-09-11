import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FeedbackPanel from './FeedbackPanel'
import {
  getFeedbackThreads,
  replyToFeedback,
  setFeedbackStatus,
  type UserFeedback,
} from '../../lib/feedback'

vi.mock('../../lib/feedback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/feedback')>()
  return {
    ...actual,
    getFeedbackThreads: vi.fn(),
    replyToFeedback: vi.fn(),
    setFeedbackStatus: vi.fn(),
  }
})

const notify = vi.fn()

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FeedbackPanel notify={notify} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function makeThread(overrides: Partial<UserFeedback> = {}): UserFeedback {
  return {
    id: 'f1',
    category: 'bug',
    message: 'The board drops my #1 coaster',
    context: {
      page: '/coasters/steel-vengeance',
      user_agent: 'Mozilla/5.0 (iPhone)',
      screen: '390x844',
      language: 'en-US',
      coaster_slug: 'steel-vengeance',
    },
    submitted_by: 'u1',
    status: 'open',
    seen_by_submitter_at: null,
    created_at: '2026-09-10T00:00:00Z',
    profiles: { id: 'u1', avatar_url: null, username: 'rider_one' },
    replies: [],
    ...overrides,
  }
}

describe('FeedbackPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getFeedbackThreads).mockResolvedValue([])
    vi.mocked(replyToFeedback).mockResolvedValue({ id: 'r1' } as never)
    vi.mocked(setFeedbackStatus).mockResolvedValue(undefined)
  })

  it('shows the empty state', async () => {
    renderPanel()
    expect(await screen.findByText('No open threads.')).toBeInTheDocument()
  })

  it('shows an error state when the queue fails to load', async () => {
    vi.mocked(getFeedbackThreads).mockRejectedValue(new Error('boom'))
    renderPanel()
    expect(await screen.findByText("Couldn't load feedback.")).toBeInTheDocument()
  })

  it('renders a thread with category, submitter, context links, and replies', async () => {
    vi.mocked(getFeedbackThreads).mockResolvedValue([
      makeThread({
        context: {
          page: '/me',
          user_agent: 'Mozilla/5.0 (iPhone)',
          screen: '390x844',
          language: 'en-US',
          coaster_slug: 'steel-vengeance',
        },
        replies: [
          {
            id: 'r1',
            feedback_id: 'f1',
            author_id: 'admin1',
            message: 'Fixed — thanks for the report!',
            created_at: '2026-09-10T12:00:00Z',
            profiles: { id: 'admin1', username: 'admin', is_admin: true },
          },
        ],
      }),
    ])
    renderPanel()
    expect(await screen.findByText('The board drops my #1 coaster')).toBeInTheDocument()
    expect(screen.getByText('rider_one')).toBeInTheDocument()
    // Context: page + coaster links point back at the reported surface.
    expect(screen.getByRole('link', { name: '/me' })).toHaveAttribute('href', '/me')
    expect(screen.getByRole('link', { name: '/coasters/steel-vengeance' })).toHaveAttribute(
      'href',
      '/coasters/steel-vengeance',
    )
    expect(screen.getByText('Mozilla/5.0 (iPhone)')).toBeInTheDocument()
    expect(screen.getByText('Fixed — thanks for the report!')).toBeInTheDocument()
  })

  it('sends an admin reply from the card', async () => {
    vi.mocked(getFeedbackThreads).mockResolvedValue([makeThread()])
    renderPanel()
    await userEvent.type(
      await screen.findByLabelText('Reply to feedback from rider_one'),
      'Looking into this now',
    )
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await waitFor(() => expect(replyToFeedback).toHaveBeenCalledWith('f1', 'Looking into this now'))
    // Toasts are owned by AdminPage — the panel reports through notify().
    expect(notify).toHaveBeenCalledWith('Reply sent.')
  })

  it('closes an open thread and reopens a closed one', async () => {
    vi.mocked(getFeedbackThreads).mockResolvedValue([
      makeThread({ id: 'f-open', status: 'open' }),
      makeThread({ id: 'f-closed', message: 'Old thread', status: 'closed' }),
    ])
    renderPanel()
    // Default filter is 'open'; switch to All so both threads are reachable.
    await userEvent.click(await screen.findByRole('button', { name: /All \(2\)/ }))
    await userEvent.click(await screen.findByTitle('Close thread'))
    await waitFor(() => expect(setFeedbackStatus).toHaveBeenCalledWith('f-open', 'closed'))
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Thread closed.'))

    await userEvent.click(screen.getByTitle('Reopen'))
    await waitFor(() => expect(setFeedbackStatus).toHaveBeenCalledWith('f-closed', 'open'))
    await waitFor(() => expect(notify).toHaveBeenCalledWith('Thread reopened.'))
  })

  it('filters the queue by status', async () => {
    vi.mocked(getFeedbackThreads).mockResolvedValue([
      makeThread({ id: 'f-open', message: 'Fresh one', status: 'open' }),
      makeThread({ id: 'f-closed', message: 'Done one', status: 'closed' }),
    ])
    renderPanel()
    expect(await screen.findByText('Fresh one')).toBeInTheDocument()
    expect(screen.queryByText('Done one')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /All \(2\)/ }))
    expect(screen.getByText('Fresh one')).toBeInTheDocument()
    expect(screen.getByText('Done one')).toBeInTheDocument()
  })
})
