import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ParkEditModal from './ParkEditModal'
import { createPark, refreshBoardData, updatePark } from '../../lib/coasters'

vi.mock('../../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/coasters')>()
  return {
    ...actual,
    updatePark: vi.fn(),
    createPark: vi.fn(),
    refreshBoardData: vi.fn(),
  }
})

function renderModal(props: Partial<React.ComponentProps<typeof ParkEditModal>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const onClose = vi.fn()
  const onSaved = vi.fn()
  const onError = vi.fn()
  render(
    <QueryClientProvider client={queryClient}>
      <ParkEditModal
        initial={{ id: 'p1', name: 'Cedar Point', slug: 'cedar-point' }}
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

describe('ParkEditModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updatePark).mockResolvedValue(undefined)
    vi.mocked(createPark).mockResolvedValue({} as never)
    vi.mocked(refreshBoardData).mockResolvedValue(undefined)
  })

  it('renders the edit form seeded from the initial row', () => {
    renderModal()
    expect(screen.getByText('Edit Park')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Cedar Point')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save park/i })).toBeInTheDocument()
  })

  it('renders the create form', () => {
    renderModal({ initial: null, mode: 'create' })
    expect(screen.getByText('Add New Park')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /save park/i })).toBeInTheDocument()
  })

  it('saves edits through updatePark and reports success', async () => {
    const { onSaved, onError } = renderModal()
    await userEvent.click(screen.getByRole('button', { name: /save park/i }))
    await waitFor(() =>
      expect(updatePark).toHaveBeenCalledWith(
        'p1',
        expect.objectContaining({
          id: 'p1',
          name: 'Cedar Point',
        }),
      ),
    )
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    expect(onError).not.toHaveBeenCalled()
    expect(createPark).not.toHaveBeenCalled()
  })

  it('surfaces save failures through onError', async () => {
    vi.mocked(updatePark).mockRejectedValue(new Error('denied'))
    const { onSaved, onError } = renderModal()
    await userEvent.click(screen.getByRole('button', { name: /save park/i }))
    await waitFor(() => expect(onError).toHaveBeenCalledWith("Couldn't save park: denied"))
    expect(onSaved).not.toHaveBeenCalled()
  })
})
