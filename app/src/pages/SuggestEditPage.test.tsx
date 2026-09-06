import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SuggestEditPage from './SuggestEditPage'
import { useAuth } from '../lib/auth-context'
import { getMySubmissions, submitEditSuggestion, useCoaster, useParks } from '../lib/coasters'
import { makePark, makeRankingRow } from '../test/fixtures'

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useCoaster: vi.fn(),
    useParks: vi.fn(),
    getMySubmissions: vi.fn(),
    submitEditSuggestion: vi.fn(),
    SUBMISSION_PENDING_CAP: 5,
  }
})

vi.mock('../components/ConfirmEmailGate', () => ({
  default: ({ email }: { email?: string }) => <div data-testid="confirm-gate">{email}</div>,
}))

const coaster = makeRankingRow({
  id: 'c1',
  name: 'Steel Vengeance',
  slug: 'steel-vengeance',
  park_id: 'park-1',
  status: 'operating',
  material: 'hybrid',
  height_m: 62,
  speed_kmh: 119,
  length_m: 1700,
  inversions: 4,
})

const parks = [makePark({ id: 'park-1', name: 'Cedar Point' })]

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/coasters/steel-vengeance/suggest-edit']}>
        <Routes>
          <Route path="/coasters/:slug/suggest-edit" element={<SuggestEditPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('SuggestEditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1', email: 'test@example.com' },
      isConfirmed: true,
    } as never)
    vi.mocked(useCoaster).mockReturnValue({
      data: coaster,
      isPending: false,
      isError: false,
    } as never)
    vi.mocked(useParks).mockReturnValue({ data: parks } as never)
    vi.mocked(getMySubmissions).mockResolvedValue([])
    vi.mocked(submitEditSuggestion).mockResolvedValue({ id: 'e1' } as never)
  })

  it('prefills current values and blocks submit with no changes', async () => {
    renderPage()
    expect(await screen.findByDisplayValue('Steel Vengeance')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Cedar Point')).toBeInTheDocument()
    expect(screen.getByText('No changes yet.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /suggest edit/i })).toBeDisabled()
  })

  it('counts changes live and submits only the diff', async () => {
    const user = userEvent.setup()
    renderPage()
    const height = await screen.findByLabelText(/height \(m\)/i)
    await user.clear(height)
    await user.type(height, '63')
    expect(await screen.findByText('1 change proposed.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /suggest edit/i }))
    expect(vi.mocked(submitEditSuggestion).mock.calls[0][0]).toEqual({
      coaster_id: 'c1',
      coaster_name: 'Steel Vengeance',
      park_name: 'Cedar Point',
      park_id: 'park-1',
      suggested_fields: { height_m: 63 },
    })
  })

  it('shows the email gate when not confirmed', async () => {
    vi.mocked(useAuth).mockReturnValue({
      user: { id: 'u1', email: 'test@example.com' },
      isConfirmed: false,
    } as never)
    renderPage()
    expect(await screen.findByTestId('confirm-gate')).toBeInTheDocument()
  })
})
