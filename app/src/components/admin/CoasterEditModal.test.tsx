import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CoasterEditModal from './CoasterEditModal'
import {
  createCoaster,
  refreshBoardData,
  updateCoaster,
  useCoasterAliases,
  useManufacturers,
  useParks,
} from '../../lib/coasters'

vi.mock('../../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/coasters')>()
  return {
    ...actual,
    updateCoaster: vi.fn(),
    createCoaster: vi.fn(),
    refreshBoardData: vi.fn(),
    useParks: vi.fn(),
    useManufacturers: vi.fn(),
    useCoasterAliases: vi.fn(),
  }
})

const parks = [
  { id: 'p1', name: 'Cedar Point', slug: 'cedar-point', country: 'USA', region: null, city: null },
]

function renderModal(props: Partial<React.ComponentProps<typeof CoasterEditModal>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const onError = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <CoasterEditModal
        initial={{ id: 'c1', name: 'Steel Vengeance', slug: 'steel-vengeance', park_id: 'p1' }}
        mode="edit"
        onClose={onClose}
        onSaved={onSaved}
        onError={onError}
        {...props}
      />
    </QueryClientProvider>,
  )
  return { onClose, onSaved, onError }
}

describe('CoasterEditModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useParks).mockReturnValue({ data: parks } as never)
    vi.mocked(useManufacturers).mockReturnValue({ data: [] } as never)
    vi.mocked(useCoasterAliases).mockReturnValue({ data: [] } as never)
    vi.mocked(updateCoaster).mockResolvedValue(undefined)
    vi.mocked(createCoaster).mockResolvedValue(undefined)
    vi.mocked(refreshBoardData).mockResolvedValue(undefined)
  })

  it('renders the edit form seeded from the initial row', () => {
    renderModal()
    expect(screen.getByText('Edit Coaster')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Steel Vengeance')).toBeInTheDocument()
    expect(screen.getByText('Selected: Cedar Point')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save coaster/i })).toBeInTheDocument()
  })

  it('renders the create form with a blank name', () => {
    renderModal({ initial: null, mode: 'create' })
    expect(screen.getByText('Add New Coaster')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save coaster/i })).toBeInTheDocument()
  })

  it('saves edits through updateCoaster and reports success', async () => {
    const { onSaved, onError } = renderModal()
    await userEvent.click(screen.getByRole('button', { name: /save coaster/i }))
    await waitFor(() =>
      expect(updateCoaster).toHaveBeenCalledWith(
        'c1',
        expect.objectContaining({
          id: 'c1',
          name: 'Steel Vengeance',
          park_id: 'p1',
        }),
      ),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onError).not.toHaveBeenCalled()
    expect(createCoaster).not.toHaveBeenCalled()
  })

  it('surfaces save failures through onError', async () => {
    vi.mocked(updateCoaster).mockRejectedValue(new Error('denied'))
    const { onSaved, onError } = renderModal()
    await userEvent.click(screen.getByRole('button', { name: /save coaster/i }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Couldn't save coaster: denied"))
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('asks for confirmation before deleting when the caller opts in', async () => {
    const onRequestDelete = vi.fn()
    renderModal({ onRequestDelete })
    await userEvent.click(screen.getByRole('button', { name: /delete coaster/i }))
    expect(onRequestDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c1', name: 'Steel Vengeance' }),
    )
  })
})
