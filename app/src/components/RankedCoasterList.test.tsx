import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useParks } from '../lib/coasters'
import { useRemoveRide, useSaveRanks } from '../lib/rides'
import RankedCoasterList from './RankedCoasterList'
import { makeUserRide, makeUserRideCoaster } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return { ...actual, useParks: vi.fn() }
})

vi.mock('../lib/rides', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rides')>()
  return { ...actual, useRemoveRide: vi.fn(), useSaveRanks: vi.fn() }
})

function makeRides() {
  return [
    makeUserRide({ coaster: makeUserRideCoaster({ id: 'c1', name: 'Alpha' }), rank: 1 }),
    makeUserRide({ coaster: makeUserRideCoaster({ id: 'c2', name: 'Beta' }), rank: 2 }),
    makeUserRide({ coaster: makeUserRideCoaster({ id: 'c3', name: 'Gamma' }), rank: null }),
  ]
}

function mockMutations({
  saveSucceeds = true,
  removeSucceeds = true,
}: { saveSucceeds?: boolean; removeSucceeds?: boolean } = {}) {
  const saveMutate = vi.fn(
    saveSucceeds
      ? (_ranks: unknown, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()
      : (_ranks: unknown, opts?: { onError?: (e: unknown) => void }) =>
          opts?.onError?.(new Error('save failed')),
  )
  const removeMutate = vi.fn(
    removeSucceeds
      ? (_id: string, opts?: { onSuccess?: () => void }) => opts?.onSuccess?.()
      : (_id: string, opts?: { onError?: (e: unknown) => void }) =>
          opts?.onError?.(new Error('remove failed')),
  )
  vi.mocked(useSaveRanks).mockReturnValue({ mutate: saveMutate } as never)
  vi.mocked(useRemoveRide).mockReturnValue({ mutate: removeMutate } as never)
  vi.mocked(useParks).mockReturnValue({ data: [] } as never)
  return { saveMutate, removeMutate }
}

function renderList(props: Partial<React.ComponentProps<typeof RankedCoasterList>> = {}) {
  return render(
    <MemoryRouter>
      <RankedCoasterList rides={makeRides()} {...props} />
    </MemoryRouter>,
  )
}

describe('RankedCoasterList', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMutations()
  })

  it('renders ranked coasters plus the unranked section', () => {
    renderList()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(screen.getByText('1')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('Added but not ranked')).toBeInTheDocument()
    expect(screen.getByText('Gamma')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
  })

  it('shows no insert dividers when there is no pending add', () => {
    renderList()
    expect(screen.queryByRole('button', { name: /add to top/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /add to bottom/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /insert at #/i })).not.toBeInTheDocument()
  })

  it('inserts a pending coaster at the top', async () => {
    const user = userEvent.setup()
    const { saveMutate } = mockMutations()
    const onInserted = vi.fn()
    const onPendingClear = vi.fn()
    renderList({ pendingAdd: { id: 'c9', name: 'New One' }, onInserted, onPendingClear })
    await user.click(screen.getByRole('button', { name: /add to top/i }))
    expect(saveMutate).toHaveBeenCalledWith(
      [
        { coaster_id: 'c9', rank: 1 },
        { coaster_id: 'c1', rank: 2 },
        { coaster_id: 'c2', rank: 3 },
      ],
      expect.anything(),
    )
    expect(onInserted).toHaveBeenCalledWith('c9', 'New One', 1)
    expect(onPendingClear).toHaveBeenCalled()
  })

  it('inserts a pending coaster at a specific index', async () => {
    const user = userEvent.setup()
    const { saveMutate } = mockMutations()
    const onInserted = vi.fn()
    renderList({ pendingAdd: { id: 'c9', name: 'New One' }, onInserted })
    await user.click(screen.getByRole('button', { name: 'Insert at #2' }))
    expect(saveMutate).toHaveBeenCalledWith(
      [
        { coaster_id: 'c1', rank: 1 },
        { coaster_id: 'c9', rank: 2 },
        { coaster_id: 'c2', rank: 3 },
      ],
      expect.anything(),
    )
    expect(onInserted).toHaveBeenCalledWith('c9', 'New One', 2)
  })

  it('inserts a pending coaster at the bottom', async () => {
    const user = userEvent.setup()
    const { saveMutate } = mockMutations()
    const onInserted = vi.fn()
    renderList({ pendingAdd: { id: 'c9', name: 'New One' }, onInserted })
    await user.click(screen.getByRole('button', { name: /add to bottom/i }))
    expect(saveMutate).toHaveBeenCalledWith(
      [
        { coaster_id: 'c1', rank: 1 },
        { coaster_id: 'c2', rank: 2 },
        { coaster_id: 'c9', rank: 3 },
      ],
      expect.anything(),
    )
    expect(onInserted).toHaveBeenCalledWith('c9', 'New One', 3)
  })

  it('offers a single insert point when the list is empty', async () => {
    const user = userEvent.setup()
    const { saveMutate } = mockMutations()
    const onInserted = vi.fn()
    render(
      <MemoryRouter>
        <RankedCoasterList
          rides={[]}
          pendingAdd={{ id: 'c9', name: 'New One' }}
          onInserted={onInserted}
        />
      </MemoryRouter>,
    )
    expect(screen.queryByText(/no coasters ranked yet/i)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /add here/i }))
    expect(saveMutate).toHaveBeenCalledWith([{ coaster_id: 'c9', rank: 1 }], expect.anything())
    expect(onInserted).toHaveBeenCalledWith('c9', 'New One', 1)
  })

  it('reverts the insert and reports an error when saving fails', async () => {
    const user = userEvent.setup()
    const { saveMutate } = mockMutations({ saveSucceeds: false })
    const onInserted = vi.fn()
    const onError = vi.fn()
    renderList({ pendingAdd: { id: 'c9', name: 'New One' }, onInserted, onError })
    await user.click(screen.getByRole('button', { name: /add to top/i }))
    expect(saveMutate).toHaveBeenCalled()
    expect(onInserted).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/couldn't add new one/i))
    expect(screen.queryByText('New One')).not.toBeInTheDocument()
  })

  it('removes a ranked coaster and renumbers the remaining ranks', async () => {
    const user = userEvent.setup()
    const { saveMutate, removeMutate } = mockMutations()
    renderList()
    await user.click(screen.getByRole('button', { name: /remove alpha/i }))
    expect(removeMutate).toHaveBeenCalledWith('c1', expect.anything())
    expect(saveMutate).toHaveBeenCalledWith([{ coaster_id: 'c2', rank: 1 }], expect.anything())
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
  })

  it('does not renumber when removing an unranked coaster', async () => {
    const user = userEvent.setup()
    const { saveMutate, removeMutate } = mockMutations()
    renderList()
    await user.click(screen.getByRole('button', { name: /remove gamma/i }))
    expect(removeMutate).toHaveBeenCalledWith('c3', expect.anything())
    expect(saveMutate).not.toHaveBeenCalled()
  })

  it('reverts removal and reports an error when deleting fails', async () => {
    const user = userEvent.setup()
    mockMutations({ removeSucceeds: false })
    const onError = vi.fn()
    renderList({ onError })
    await user.click(screen.getByRole('button', { name: /remove beta/i }))
    expect(screen.getByText('Beta')).toBeInTheDocument()
    expect(onError).toHaveBeenCalledWith(expect.stringMatching(/couldn't remove beta/i))
  })

  it('ranks an unranked coaster via the add-to-ranking action', async () => {
    const user = userEvent.setup()
    const { saveMutate } = mockMutations()
    const onInserted = vi.fn()
    renderList({ onInserted })
    await user.click(screen.getByRole('button', { name: /add gamma to ranking/i }))
    expect(saveMutate).toHaveBeenCalledWith(
      [
        { coaster_id: 'c1', rank: 1 },
        { coaster_id: 'c2', rank: 2 },
        { coaster_id: 'c3', rank: 3 },
      ],
      expect.anything(),
    )
    expect(onInserted).toHaveBeenCalledWith('c3', 'Gamma', 3)
  })
})
