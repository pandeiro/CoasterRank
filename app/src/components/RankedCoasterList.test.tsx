import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useAllCoasters, useParks } from '../lib/coasters'
import { useRemoveRide, useSaveRanks } from '../lib/rides'
import RankedCoasterList, { REMOVE_UNDO_MS } from './RankedCoasterList'
import { makeRankingRow, makeUserRide, makeUserRideCoaster } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return { ...actual, useAllCoasters: vi.fn(), useParks: vi.fn() }
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
  vi.mocked(useAllCoasters).mockReturnValue({ data: [], isLoading: false } as never)
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

  afterEach(() => {
    vi.useRealTimers()
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

  it('removes a ranked coaster with an undo window before committing', () => {
    vi.useFakeTimers()
    try {
      const { saveMutate, removeMutate } = mockMutations()
      const onRemoved = vi.fn()
      renderList({ onRemoved })
      fireEvent.click(screen.getByRole('button', { name: /remove alpha/i }))
      // Not committed yet; the row is dissolving out but still mounted.
      expect(removeMutate).not.toHaveBeenCalled()
      expect(saveMutate).not.toHaveBeenCalled()
      expect(onRemoved).toHaveBeenCalledWith('Alpha', expect.any(Function))
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      // After the dissolve it stops rendering…
      act(() => vi.advanceTimersByTime(300))
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
      // …and the server delete only commits once the undo window closes.
      act(() => vi.advanceTimersByTime(REMOVE_UNDO_MS))
      expect(removeMutate).toHaveBeenCalledWith('c1', expect.anything())
      expect(saveMutate).toHaveBeenCalledWith([{ coaster_id: 'c2', rank: 1 }], expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores a removed ranked coaster on undo without any server call', () => {
    vi.useFakeTimers()
    try {
      const { saveMutate, removeMutate } = mockMutations()
      const onRemoved = vi.fn()
      renderList({ onRemoved })
      fireEvent.click(screen.getByRole('button', { name: /remove alpha/i }))
      act(() => vi.advanceTimersByTime(300))
      expect(screen.queryByText('Alpha')).not.toBeInTheDocument()
      const undo = onRemoved.mock.calls[0][1] as () => void
      act(() => undo())
      expect(screen.getByText('Alpha')).toBeInTheDocument()
      expect(screen.getByText('1')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(REMOVE_UNDO_MS + 1000))
      expect(removeMutate).not.toHaveBeenCalled()
      expect(saveMutate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('defers removal of an unranked coaster the same way', () => {
    vi.useFakeTimers()
    try {
      const { saveMutate, removeMutate } = mockMutations()
      renderList()
      fireEvent.click(screen.getByRole('button', { name: /remove gamma/i }))
      expect(screen.getByText('Gamma')).toBeInTheDocument()
      act(() => vi.advanceTimersByTime(300))
      expect(screen.queryByText('Gamma')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(REMOVE_UNDO_MS))
      expect(removeMutate).toHaveBeenCalledWith('c3', expect.anything())
      // Unranked rows carry no rank — no renumbering needed.
      expect(saveMutate).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('restores the row and reports an error when the deferred delete fails', () => {
    vi.useFakeTimers()
    try {
      mockMutations({ removeSucceeds: false })
      const onError = vi.fn()
      const onRemoved = vi.fn()
      renderList({ onError, onRemoved })
      fireEvent.click(screen.getByRole('button', { name: /remove beta/i }))
      act(() => vi.advanceTimersByTime(300))
      expect(screen.queryByText('Beta')).not.toBeInTheDocument()
      act(() => vi.advanceTimersByTime(REMOVE_UNDO_MS))
      expect(screen.getByText('Beta')).toBeInTheDocument()
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/couldn't remove beta/i))
    } finally {
      vi.useRealTimers()
    }
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

  it('inserts instantly at the end in instantAdd mode without showing targets', () => {
    // Mobile: select -> insert, no position-picking step.
    const { saveMutate } = mockMutations()
    const onInserted = vi.fn()
    const onPendingClear = vi.fn()
    renderList({
      pendingAdd: { id: 'c9', name: 'New One' },
      instantAdd: true,
      onInserted,
      onPendingClear,
    })
    expect(saveMutate).toHaveBeenCalledWith(
      [
        { coaster_id: 'c1', rank: 1 },
        { coaster_id: 'c2', rank: 2 },
        { coaster_id: 'c9', rank: 3 },
      ],
      expect.anything(),
    )
    expect(onInserted).toHaveBeenCalledWith('c9', 'New One', 3)
    expect(onPendingClear).toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: /add to top/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /insert at #/i })).not.toBeInTheDocument()
  })

  it('consumes a quickInsert request at the top', () => {
    // Desktop banner pill: insert without scrolling to a divider.
    const { saveMutate } = mockMutations()
    const onInserted = vi.fn()
    const onPendingClear = vi.fn()
    renderList({
      pendingAdd: { id: 'c9', name: 'New One' },
      quickInsert: 'top',
      onInserted,
      onPendingClear,
    })
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

  it('consumes a quickInsert request at the bottom', () => {
    const { saveMutate } = mockMutations()
    const onInserted = vi.fn()
    const onPendingClear = vi.fn()
    renderList({
      pendingAdd: { id: 'c9', name: 'New One' },
      quickInsert: 'bottom',
      onInserted,
      onPendingClear,
    })
    expect(saveMutate).toHaveBeenCalledWith(
      [
        { coaster_id: 'c1', rank: 1 },
        { coaster_id: 'c2', rank: 2 },
        { coaster_id: 'c9', rank: 3 },
      ],
      expect.anything(),
    )
    expect(onInserted).toHaveBeenCalledWith('c9', 'New One', 3)
    expect(onPendingClear).toHaveBeenCalled()
  })

  it('ignores a quickInsert request with no pending add', () => {
    const { saveMutate } = mockMutations()
    renderList({ quickInsert: 'top' })
    expect(saveMutate).not.toHaveBeenCalled()
  })

  it('renders an optimistically inserted coaster in full instead of "Saving…"', () => {
    mockMutations()
    vi.mocked(useAllCoasters).mockReturnValue({
      data: [makeRankingRow({ id: 'c9', name: 'New One', slug: 'new-one' })],
      isLoading: false,
    } as never)
    renderList({
      pendingAdd: { id: 'c9', name: 'New One' },
      instantAdd: true,
    })
    expect(screen.getByText('New One')).toBeInTheDocument()
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument()
  })
})
