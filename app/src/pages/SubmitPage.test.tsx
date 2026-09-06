import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SubmitPage from './SubmitPage'
import { useAuth } from '../lib/auth-context'
import { getMySubmissions, submitCoaster, useParks, type CoasterSubmission } from '../lib/coasters'

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/coasters', () => ({
  useParks: vi.fn(),
  getMySubmissions: vi.fn(),
  submitCoaster: vi.fn(),
  SUBMISSION_PENDING_CAP: 5,
}))

vi.mock('../components/ConfirmEmailGate', () => ({
  default: ({ email }: { email?: string }) => <div data-testid="confirm-gate">{email}</div>,
}))

const parks = [
  { id: 'p1', name: 'Cedar Point', slug: 'cedar-point', country: 'USA', region: null, city: null },
]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SubmitPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockConfirmed() {
  vi.mocked(useAuth).mockReturnValue({
    user: { id: 'u1', email: 'test@example.com' },
    isConfirmed: true,
  } as never)
  vi.mocked(useParks).mockReturnValue({ data: parks } as never)
}

function makeSubmission(overrides: Partial<CoasterSubmission> = {}): CoasterSubmission {
  return {
    id: `s${Math.random()}`,
    kind: 'new',
    coaster_id: null,
    coaster_name: 'Test Coaster',
    park_name: 'Cedar Point',
    park_id: 'p1',
    suggested_fields: {
      height_m: null,
      speed_kmh: null,
      length_m: null,
      inversions: null,
      material: null,
    },
    submitted_by: 'u1',
    status: 'pending',
    reviewer_note: null,
    reviewed_by: null,
    created_at: '2026-08-19T00:00:00Z',
    reviewed_at: null,
    seen_by_submitter_at: null,
    ...overrides,
  }
}

describe('SubmitPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getMySubmissions).mockResolvedValue([])
    vi.mocked(submitCoaster).mockResolvedValue(makeSubmission())
  })

  it('shows the email gate when not confirmed', () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1', email: 'test@example.com' },
      isConfirmed: false,
    } as never)
    vi.mocked(useParks).mockReturnValue({ data: parks } as never)
    renderPage()
    expect(screen.getByTestId('confirm-gate')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /submit for review/i })).not.toBeInTheDocument()
  })

  it('lists the user’s submissions with status', async () => {
    mockConfirmed()
    vi.mocked(getMySubmissions).mockResolvedValue([
      makeSubmission({ id: 's1', coaster_name: 'Approved One', status: 'approved' }),
      makeSubmission({
        id: 's2',
        coaster_name: 'Rejected One',
        status: 'rejected',
        reviewer_note: 'Duplicate',
      }),
    ])
    renderPage()
    expect(await screen.findByText('Approved One')).toBeInTheDocument()
    expect(screen.getByText('approved')).toBeInTheDocument()
    expect(screen.getByText('Rejected One')).toBeInTheDocument()
    expect(screen.getByText('Reviewer: Duplicate')).toBeInTheDocument()
  })

  it('blocks new submissions at the pending cap', async () => {
    mockConfirmed()
    vi.mocked(getMySubmissions).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => makeSubmission({ id: `s${i}` })),
    )
    renderPage()
    expect(await screen.findByText(/the maximum/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /submit for review/i })).toBeDisabled()
  })

  it('submits the form and shows a success toast', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    renderPage()

    await user.type(await screen.findByLabelText(/coaster name/i), 'Millennium Force')
    await user.type(screen.getByLabelText(/park name/i), 'Cedar Point')
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(await screen.findByText(/submission received/i)).toBeInTheDocument()
    // Second arg is TanStack Query's mutation context.
    expect(submitCoaster).toHaveBeenCalledWith(
      {
        coaster_name: 'Millennium Force',
        park_name: 'Cedar Point',
        park_id: null,
        suggested_fields: {
          height_m: null,
          speed_kmh: null,
          length_m: null,
          inversions: null,
          material: null,
        },
      },
      expect.anything(),
    )
  })

  it('shows an error toast when the insert fails', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    vi.mocked(submitCoaster).mockRejectedValue(new Error('too many pending submissions'))
    renderPage()

    await user.type(await screen.findByLabelText(/coaster name/i), 'Millennium Force')
    await user.type(screen.getByLabelText(/park name/i), 'Cedar Point')
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(await screen.findByText('too many pending submissions')).toBeInTheDocument()
  })
})
