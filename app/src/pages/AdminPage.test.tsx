import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import AdminPage from './AdminPage'
import { supabase } from '../lib/supabase'
import {
  approveSubmission,
  deletePark,
  getAllCoastersAdmin,
  getAllParksAdmin,
  getCoastersInPark,
  getOtherParkId,
  getPendingSubmissions,
  moveCoasterToPark,
  rejectSubmission,
  useParks,
} from '../lib/coasters'

vi.mock('../lib/supabase', () => ({
  supabase: {
    functions: {
      invoke: vi.fn(),
    },
  },
}))

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useParks: vi.fn(),
    getPendingSubmissions: vi.fn(),
    getAllCoastersAdmin: vi.fn(),
    getAllParksAdmin: vi.fn(),
    getOtherParkId: vi.fn(),
    getCoastersInPark: vi.fn(),
    approveSubmission: vi.fn(),
    rejectSubmission: vi.fn(),
    moveCoasterToPark: vi.fn(),
    deletePark: vi.fn(),
  }
})

const parks = [
  {
    id: 'p1',
    name: 'Cedar Point',
    slug: 'cedar-point',
    country: 'USA',
    region: null,
    city: null,
    lat: null,
    lng: null,
    source: 'admin',
    external_id: null,
    coaster_count: 0,
  },
]

function renderPage(initialEntry = '/admin/coasters') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/admin/:tab?" element={<AdminPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function mockBase() {
  vi.mocked(useParks).mockReturnValue({ data: parks } as never)
  vi.mocked(getPendingSubmissions).mockResolvedValue([])
  vi.mocked(getAllCoastersAdmin).mockResolvedValue([])
  vi.mocked(getAllParksAdmin).mockResolvedValue([])
  vi.mocked(getOtherParkId).mockResolvedValue('other-park')
  vi.mocked(getCoastersInPark).mockResolvedValue([])
  vi.mocked(approveSubmission).mockResolvedValue(undefined)
  vi.mocked(rejectSubmission).mockResolvedValue(undefined)
  vi.mocked(moveCoasterToPark).mockResolvedValue(undefined)
  vi.mocked(deletePark).mockResolvedValue(undefined)
}

describe('AdminPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBase()
  })

  describe('recompute', () => {
    it('triggers the recompute function and refreshes logs', async () => {
      vi.mocked(supabase.functions.invoke).mockResolvedValue({
        data: { updated: 42, durationMs: 120, iterations: 7, converged: true },
        error: null,
      } as never)
      renderPage()
      await userEvent.click(screen.getByRole('button', { name: /recompute now/i }))
      expect(supabase.functions.invoke).toHaveBeenCalledWith('recompute-rankings', {
        method: 'POST',
      })
      // Button returns to idle state after mutation settles
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /recompute now/i })).toBeEnabled()
      })
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

  describe('tab routing', () => {
    it('redirects bare /admin to the coasters tab', async () => {
      renderPage('/admin')
      expect(await screen.findByText('No coasters match that search.')).toBeInTheDocument()
    })

    it('redirects unknown tabs to the coasters tab', async () => {
      renderPage('/admin/blah')
      expect(await screen.findByText('No coasters match that search.')).toBeInTheDocument()
    })

    it('navigates between tabs via the tab links', async () => {
      renderPage('/admin/coasters')
      await userEvent.click(screen.getByRole('link', { name: 'Rehome' }))
      expect(await screen.findByText('Re-home Coasters')).toBeInTheDocument()
    })
  })

  describe('submissions tab', () => {
    it('shows the empty state when there are no pending submissions', async () => {
      renderPage('/admin/submissions')
      expect(await screen.findByText('No pending submissions.')).toBeInTheDocument()
    })

    it('shows an error state when the queue fails to load', async () => {
      vi.mocked(getPendingSubmissions).mockRejectedValue(new Error('boom'))
      renderPage('/admin/submissions')
      expect(await screen.findByText("Couldn't load submissions.")).toBeInTheDocument()
    })

    it('approves a submission and confirms', async () => {
      vi.mocked(getPendingSubmissions).mockResolvedValue([
        {
          id: 's1',
          coaster_name: 'New Coaster',
          park_name: 'Cedar Point',
          park_id: 'p1',
          suggested_fields: { height_m: 100 },
          submitted_by: 'u1',
          status: 'pending',
          reviewer_note: null,
          reviewed_by: null,
          created_at: '',
          reviewed_at: null,
        },
      ] as never)
      renderPage('/admin/submissions')
      await userEvent.click(await screen.findByTitle('Approve'))
      expect(
        await screen.findByText('Submission approved and coaster created.'),
      ).toBeInTheDocument()
      expect(approveSubmission).toHaveBeenCalled()
    })
  })

  describe('coasters tab', () => {
    it('shows an error state when coasters fail to load', async () => {
      vi.mocked(getAllCoastersAdmin).mockRejectedValue(new Error('boom'))
      renderPage()
      expect(await screen.findByText("Couldn't load coasters.")).toBeInTheDocument()
    })

    it('shows an empty state when no coasters match', async () => {
      renderPage()
      expect(await screen.findByText('No coasters match that search.')).toBeInTheDocument()
    })

    it('paginates large coaster lists with a show-more button', async () => {
      const rows = Array.from({ length: 60 }, (_, i) => ({
        id: `c${i}`,
        name: `Coaster ${i}`,
        slug: `coaster-${i}`,
        park_id: 'p1',
        status: 'operating',
        material: 'steel',
        parks: { name: 'Cedar Point' },
      }))
      vi.mocked(getAllCoastersAdmin).mockResolvedValue(rows as never)
      renderPage()

      expect(await screen.findByText('Coaster 0')).toBeInTheDocument()
      expect(screen.queryByText('Coaster 55')).not.toBeInTheDocument()
      expect(screen.getByText(/10 remaining/)).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /show more/i }))
      expect(await screen.findByText('Coaster 55')).toBeInTheDocument()
    })
  })

  describe('parks tab', () => {
    async function switchToParks() {
      await userEvent.click(screen.getByRole('link', { name: 'Parks' }))
    }

    it('shows an error state when parks fail to load', async () => {
      vi.mocked(getAllParksAdmin).mockRejectedValue(new Error('boom'))
      renderPage()
      await switchToParks()
      expect(await screen.findByText("Couldn't load parks.")).toBeInTheDocument()
    })

    it('shows an empty state when no parks match', async () => {
      renderPage()
      await switchToParks()
      expect(await screen.findByText('No parks match that search.')).toBeInTheDocument()
    })

    it('renders a table of parks', async () => {
      vi.mocked(getAllParksAdmin).mockResolvedValue([
        {
          id: 'p1',
          name: 'Cedar Point',
          slug: 'cedar-point',
          country: 'USA',
          region: 'OH',
          city: 'Sandusky',
          lat: null,
          lng: null,
          source: 'admin',
          external_id: null,
          coaster_count: 5,
        },
      ])
      renderPage()
      await switchToParks()
      expect(await screen.findByText('Cedar Point')).toBeInTheDocument()
      expect(screen.getByText('USA')).toBeInTheDocument()
      expect(screen.getByText('Sandusky')).toBeInTheDocument()
      expect(screen.getByText('5')).toBeInTheDocument()
    })

    it('opens the add park form', async () => {
      renderPage()
      await switchToParks()
      await userEvent.click(screen.getByRole('button', { name: /add park/i }))
      expect(await screen.findByText('Add New Park')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /save park/i })).toBeInTheDocument()
    })

    it('asks for confirmation and deletes an empty park', async () => {
      vi.mocked(getAllParksAdmin).mockResolvedValue(parks)
      renderPage()
      await switchToParks()
      await userEvent.click(await screen.findByTitle('Delete park'))
      expect(
        await screen.findByText(/Are you sure you want to delete "Cedar Point"\?/),
      ).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Delete' }))
      await waitFor(() => expect(deletePark).toHaveBeenCalledWith('p1'))
    })

    it('warns about cascading coaster deletion when the park has coasters', async () => {
      vi.mocked(getAllParksAdmin).mockResolvedValue([{ ...parks[0], coaster_count: 3 }])
      renderPage()
      await switchToParks()
      await userEvent.click(await screen.findByTitle('Delete park'))
      expect(await screen.findByText(/delete its 3 coaster\(s\)/)).toBeInTheDocument()
    })
  })

  describe('rehome tab', () => {
    async function switchToRehome() {
      await userEvent.click(screen.getByRole('link', { name: 'Rehome' }))
    }

    it('shows an empty state when the Other park has no coasters', async () => {
      renderPage()
      await switchToRehome()
      expect(await screen.findByText("No coasters found in the 'Other' park.")).toBeInTheDocument()
    })

    it('shows an error state when the re-home list fails to load', async () => {
      vi.mocked(getCoastersInPark).mockRejectedValue(new Error('boom'))
      renderPage()
      await switchToRehome()
      expect(await screen.findByText("Couldn't load the re-home list.")).toBeInTheDocument()
    })
  })
})
