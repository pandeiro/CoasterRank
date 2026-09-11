import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SubmitPage from './SubmitPage'
import { useAuth } from '../lib/auth-context'
import {
  getMySubmissions,
  submitCoaster,
  useManufacturers,
  useParks,
  type CoasterSubmission,
} from '../lib/coasters'

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useParks: vi.fn(),
    useManufacturers: vi.fn(),
    getMySubmissions: vi.fn(),
    markMySubmissionsSeen: vi.fn(),
    submitCoaster: vi.fn(),
    SUBMISSION_PENDING_CAP: 5,
  }
})

vi.mock('../components/ConfirmEmailGate', () => ({
  default: ({ email }: { email?: string }) => <div data-testid="confirm-gate">{email}</div>,
}))

const parks = [
  { id: 'p1', name: 'Cedar Point', slug: 'cedar-point', country: 'USA', region: null, city: null },
]

const manufacturers = [
  {
    id: 'aaaaaaaa-1111-4111-8111-111111111111',
    name: 'Rocky Mountain Construction',
    slug: 'rocky-mountain-construction',
  },
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
  vi.mocked(useManufacturers).mockReturnValue({ data: manufacturers } as never)
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
    vi.mocked(useManufacturers).mockReturnValue({ data: [] } as never)
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
          manufacturer_ids: null,
          status: null,
          model: null,
          type: null,
          opening_date: null,
        },
        note: null,
      },
      expect.anything(),
    )
  })

  it('carries manufacturer, details, and the note into the payload', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    renderPage()

    await user.type(await screen.findByLabelText(/coaster name/i), 'Steel Vengeance 2')
    await user.type(screen.getByLabelText(/park name/i), 'Cedar Point')
    await user.type(screen.getByLabelText(/manufacturer/i), 'Rocky')
    await user.click(screen.getByText('Rocky Mountain Construction'))
    await user.selectOptions(screen.getByLabelText(/^status/i), 'under_construction')
    await user.type(screen.getByLabelText(/^model/i), 'RMC IBox Track')
    await user.type(screen.getByLabelText(/opening date/i), '2027-05-01')
    await user.type(screen.getByLabelText(/note \(optional\)/i), 'RCDB: https://rcdb.com/9999')
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(await screen.findByText(/submission received/i)).toBeInTheDocument()
    expect(vi.mocked(submitCoaster).mock.calls[0][0]).toMatchObject({
      suggested_fields: {
        manufacturer_ids: ['aaaaaaaa-1111-4111-8111-111111111111'],
        status: 'under_construction',
        model: 'RMC IBox Track',
        opening_date: '2027-05-01',
      },
      note: 'RCDB: https://rcdb.com/9999',
    })
  })

  it('carries a multi-manufacturer lineage into the payload in pick order', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    vi.mocked(useManufacturers).mockReturnValue({
      data: [
        ...manufacturers,
        { id: 'bbbbbbbb-2222-4222-8222-222222222222', name: 'Intamin', slug: 'intamin' },
      ],
    } as never)
    renderPage()

    await user.type(await screen.findByLabelText(/coaster name/i), 'Top Thrill 2')
    await user.type(screen.getByLabelText(/park name/i), 'Cedar Point')
    // First pick leads ("newest wins" default); the second appends after it.
    await user.type(screen.getByLabelText(/manufacturers/i), 'Rocky')
    await user.click(screen.getByText('Rocky Mountain Construction'))
    await user.type(screen.getByLabelText(/manufacturers/i), 'Intamin')
    await user.click(screen.getByText('Intamin'))
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(await screen.findByText(/submission received/i)).toBeInTheDocument()
    expect(
      (
        vi.mocked(submitCoaster).mock.calls[0][0] as {
          suggested_fields: { manufacturer_ids: string[] }
        }
      ).suggested_fields.manufacturer_ids,
    ).toEqual(['bbbbbbbb-2222-4222-8222-222222222222', 'aaaaaaaa-1111-4111-8111-111111111111'])
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

  it('blocks invalid stats at the schema gate without calling submit', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    renderPage()

    await user.type(await screen.findByLabelText(/coaster name/i), 'Millennium Force')
    await user.type(screen.getByLabelText(/park name/i), 'Cedar Point')
    // NB: '-5' is not typable in a jsdom number input (invalid keystrokes are
    // dropped), so exercise the gate with a typable out-of-range value.
    await user.type(screen.getByLabelText(/height \(m\)/i), '9999')
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    // The message renders both inline at the field and in the error toast.
    expect(await screen.findAllByText(/height must be between 0 and 500/i)).not.toHaveLength(0)
    expect(submitCoaster).not.toHaveBeenCalled()
    expect(screen.queryByText(/submission received/i)).not.toBeInTheDocument()
  })

  it('blocks a blank coaster name at the schema gate', async () => {
    const user = userEvent.setup()
    mockConfirmed()
    renderPage()

    // Spaces satisfy the native `required` check but not the schema.
    await user.type(await screen.findByLabelText(/coaster name/i), '   ')
    await user.type(screen.getByLabelText(/park name/i), 'Cedar Point')
    await user.click(screen.getByRole('button', { name: /submit for review/i }))

    expect(await screen.findAllByText(/coaster name must be 1–120/i)).not.toHaveLength(0)
    expect(submitCoaster).not.toHaveBeenCalled()
  })
})
