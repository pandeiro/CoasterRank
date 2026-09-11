import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FeedbackModal from './FeedbackModal'
import { useAuth } from '../lib/auth-context'
import {
  getMyFeedback,
  markMyFeedbackSeen,
  replyToFeedback,
  submitFeedback,
  type UserFeedback,
} from '../lib/feedback'

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/feedback', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/feedback')>()
  return {
    ...actual,
    getMyFeedback: vi.fn(),
    submitFeedback: vi.fn(),
    replyToFeedback: vi.fn(),
    markMyFeedbackSeen: vi.fn(),
  }
})

vi.mock('./ConfirmEmailGate', () => ({
  default: ({ email }: { email?: string }) => <div data-testid="confirm-gate">{email}</div>,
}))

function renderModal({ path = '/coasters/steel-vengeance' } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <FeedbackModal isOpen onClose={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockConfirmed(confirmed = true) {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', email: 'rider@example.com' },
    isConfirmed: confirmed,
  } as never)
}

function makeThread(overrides: Partial<UserFeedback> = {}): UserFeedback {
  return {
    id: 'f1',
    category: 'bug',
    message: 'The board double-counts my rides',
    context: { page: '/me', user_agent: 'jest', screen: '800x600', language: 'en' },
    submitted_by: 'u1',
    status: 'open',
    seen_by_submitter_at: null,
    created_at: '2026-09-10T00:00:00Z',
    replies: [],
    ...overrides,
  }
}

async function pickCategory(label: RegExp) {
  await userEvent.click(screen.getByRole('button', { name: label }))
}

describe('FeedbackModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfirmed()
    vi.mocked(getMyFeedback).mockResolvedValue([])
    vi.mocked(submitFeedback).mockResolvedValue(makeThread())
    vi.mocked(replyToFeedback).mockResolvedValue({ id: 'r1' } as never)
    vi.mocked(markMyFeedbackSeen).mockResolvedValue(undefined)
  })

  it('shows the email gate when the email is not confirmed', () => {
    mockConfirmed(false)
    renderModal()
    expect(screen.getByTestId('confirm-gate')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /send it/i })).not.toBeInTheDocument()
  })

  it('blocks submission until a category and message are provided', async () => {
    renderModal()
    await userEvent.type(screen.getByLabelText('Tell me about it'), 'x')
    await userEvent.click(screen.getByRole('button', { name: /send it/i }))
    expect(await screen.findByText('Pick what this is about.')).toBeInTheDocument()
    expect(submitFeedback).not.toHaveBeenCalled()
  })

  it('submits the picked category, message, and captured context', async () => {
    renderModal()
    await pickCategory(/something's broken/i)
    await userEvent.type(screen.getByLabelText('Tell me about it'), 'Board is broken')
    await userEvent.click(screen.getByRole('button', { name: /send it/i }))
    await waitFor(() => expect(submitFeedback).toHaveBeenCalledTimes(1))
    // useMutation calls the mutationFn with (variables, context) — assert the variables shape.
    expect(submitFeedback).toHaveBeenCalledWith(
      {
        category: 'bug',
        message: 'Board is broken',
        context: expect.objectContaining({
          coaster_slug: 'steel-vengeance',
          page: expect.any(String),
          user_agent: expect.any(String),
          screen: expect.any(String),
          language: expect.any(String),
        }),
      },
      expect.anything(),
    )
    // Success feedback + form reset.
    expect(await screen.findByText('Sent — thank you!')).toBeInTheDocument()
    expect(screen.getByLabelText('Tell me about it')).toHaveValue('')
  })

  it('lists past threads with status pills and marks unseen admin replies seen', async () => {
    vi.mocked(getMyFeedback).mockResolvedValue([
      makeThread({
        id: 'f-open',
        message: 'Open one',
        status: 'open',
      }),
      makeThread({
        id: 'f-replied',
        message: 'Thread with a fresh reply',
        status: 'replied',
        replies: [
          {
            id: 'r1',
            feedback_id: 'f-replied',
            author_id: 'admin1',
            message: 'Fixed, thanks for the report!',
            created_at: '2026-09-10T12:00:00Z',
            profiles: { id: 'admin1', username: 'admin', is_admin: true },
          },
        ],
      }),
      makeThread({
        id: 'f-closed',
        message: 'Closed one',
        status: 'closed',
        seen_by_submitter_at: '2026-09-11T00:00:00Z',
      }),
    ])
    renderModal()
    expect(await screen.findByText('Open one')).toBeInTheDocument()
    // Auto-expanded threads render the message twice (collapsed row + body).
    expect(screen.getAllByText('Thread with a fresh reply').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Closed one')).toBeInTheDocument()
    // Status pills per thread.
    expect(screen.getAllByText('Open').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Replied')).toBeInTheDocument()
    expect(screen.getByText('Closed')).toBeInTheDocument()
    // Fresh admin reply → "New" pill, auto-expanded thread, and a seen stamp.
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(await screen.findByText('Fixed, thanks for the report!')).toBeInTheDocument()
    expect(markMyFeedbackSeen).toHaveBeenCalledTimes(1)
  })

  it('offers the reply box only once the team has responded', async () => {
    vi.mocked(getMyFeedback).mockResolvedValue([
      makeThread({
        id: 'f-replied',
        message: 'Answered thread',
        status: 'replied',
        replies: [
          {
            id: 'r1',
            feedback_id: 'f-replied',
            author_id: 'admin1',
            message: 'Looking into it',
            created_at: '2026-09-10T12:00:00Z',
            profiles: { id: 'admin1', username: 'admin', is_admin: true },
          },
        ],
      }),
      makeThread({ id: 'f-open', message: 'Waiting thread', status: 'open' }),
    ])
    renderModal()
    // The replied thread auto-expands (unseen admin reply).
    expect(await screen.findByText('Looking into it')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reply' })).toBeInTheDocument()

    // Expanding the unanswered thread reveals no reply box.
    await userEvent.click(screen.getByRole('button', { name: /waiting thread/i }))
    // Expanded: the message now appears in both the row and the body.
    expect(screen.getAllByText('Waiting thread').length).toBe(2)
    expect(screen.getByText('Sent — the team will reply here.')).toBeInTheDocument()
  })

  it('sends a user reply on an admin-answered thread', async () => {
    vi.mocked(getMyFeedback).mockResolvedValue([
      makeThread({
        id: 'f-replied',
        message: 'Answered thread',
        status: 'replied',
        replies: [
          {
            id: 'r1',
            feedback_id: 'f-replied',
            author_id: 'admin1',
            message: 'Looking into it',
            created_at: '2026-09-10T12:00:00Z',
            profiles: { id: 'admin1', username: 'admin', is_admin: true },
          },
        ],
      }),
    ])
    renderModal()
    await userEvent.type(await screen.findByLabelText(/reply to thread/i), 'It also happens on iOS')
    await userEvent.click(screen.getByRole('button', { name: 'Reply' }))
    await waitFor(() =>
      expect(replyToFeedback).toHaveBeenCalledWith('f-replied', 'It also happens on iOS'),
    )
    expect(await screen.findByText('Reply sent.')).toBeInTheDocument()
  })

  it('caps open threads and disables the form at the limit', async () => {
    vi.mocked(getMyFeedback).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) =>
        makeThread({ id: `f${i}`, message: `Thread ${i}`, status: 'open' }),
      ),
    )
    renderModal()
    expect(await screen.findByText(/5 open threads — the maximum/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send it/i })).toBeDisabled()
  })

  it('shows an error toast when submission fails', async () => {
    vi.mocked(submitFeedback).mockRejectedValue(new Error('DB exploded'))
    renderModal()
    await pickCategory(/i have an idea/i)
    await userEvent.type(screen.getByLabelText('Tell me about it'), 'Add dark mode')
    await userEvent.click(screen.getByRole('button', { name: /send it/i }))
    expect(await screen.findByText('DB exploded')).toBeInTheDocument()
  })
})
