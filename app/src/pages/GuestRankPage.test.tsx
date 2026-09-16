import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import GuestRankPage from './GuestRankPage'
import { useAuth } from '../lib/auth-context'
import { useMyRides } from '../lib/rides'
import {
  clearGuestRides,
  getGuestRidesSnapshot,
  toggleGuestRide,
  type GuestRankingState,
} from '../lib/guest-rides'
import { makeRankingRow } from '../test/fixtures'

vi.mock('../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../lib/rides', () => ({
  useMyRides: vi.fn(),
}))

// The real RankedCoasterList drags in dnd-kit + adapter plumbing the page
// tests don't need — the store is the assertion surface.
vi.mock('../components/RankedCoasterList', () => ({
  REMOVE_UNDO_MS: 5000,
  default: ({ rides }: { rides: { coaster: { name: string } }[] }) => (
    <ul data-testid="mock-ranked-list">
      {rides.map((r) => (
        <li key={r.coaster.name}>{r.coaster.name}</li>
      ))}
    </ul>
  ),
}))

// Same for search: a one-shot add trigger.
vi.mock('../components/CoasterSearchBar', () => ({
  default: ({ onAdd }: { onAdd: (row: { id: string; name: string }) => void }) => (
    <button
      type="button"
      data-testid="mock-search-add"
      onClick={() => onAdd({ id: 'search-1', name: 'Searched Coaster' })}
    >
      search
    </button>
  ),
}))

// Import modal stub: reports open state and fires the applied result the
// test staged in mockAppliedResult.
let lastModalProps: { isOpen: boolean; onApplied: (r: unknown) => void } | null = null
let mockAppliedResult: unknown = null
vi.mock('../components/import/ImportListModal', () => ({
  IMPORT_UNDO_MS: 10_000,
  default: (props: { isOpen: boolean; onApplied: (r: unknown) => void }) => {
    lastModalProps = props
    if (!props.isOpen) return null
    return (
      <div data-testid="mock-import-modal">
        import modal open
        <button type="button" onClick={() => props.onApplied(mockAppliedResult)}>
          mock-apply
        </button>
      </div>
    )
  },
}))

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return { ...actual, useAllCoasters: vi.fn(), useParks: vi.fn() }
})

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

function pageTree() {
  return (
    <HelmetProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/rank']}>
          <Routes>
            <Route path="/rank" element={<GuestRankPage />} />
            <Route path="*" element={<div data-testid="elsewhere" />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </HelmetProvider>
  )
}

function seedGuestList(count: number): GuestRankingState {
  for (let i = 0; i < count; i += 1) {
    toggleGuestRide(makeRankingRow({ id: `g-${i}`, name: `Guest Coaster ${i}`, rank: i + 1 }))
  }
  return getGuestRidesSnapshot().state!
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  clearGuestRides()
  lastModalProps = null
  vi.mocked(useAuth).mockReturnValue({
    user: null,
    isLoading: false,
    isConfirmed: false,
  } as never)
  vi.mocked(useMyRides).mockReturnValue({
    data: undefined,
    isPending: false,
    isError: false,
  } as never)
})

afterEach(() => clearGuestRides())

describe('GuestRankPage — empty state', () => {
  it('offers the board and a real import entry (no signup gate)', async () => {
    const user = userEvent.setup()
    render(pageTree())
    expect(screen.getByRole('heading', { name: 'Rank My Rides' })).toBeInTheDocument()
    expect(screen.getByText(/no account needed/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /import a spreadsheet/i }))
    await waitFor(() => {
      expect(lastModalProps?.isOpen).toBe(true)
      expect(screen.getByTestId('mock-import-modal')).toBeInTheDocument()
    })
  })
})

describe('GuestRankPage — workbench', () => {
  it('adds from the search bar into the guest list (appends — order locked on visit)', async () => {
    const user = userEvent.setup()
    seedGuestList(1)
    render(pageTree())
    expect(screen.getByTestId('mock-ranked-list')).toHaveTextContent('Guest Coaster 0')
    await user.click(screen.getByTestId('mock-search-add'))
    expect(getGuestRidesSnapshot().state?.orderedIds).toEqual(['g-0', 'search-1'])
  })

  it('opens the import modal from the footer', async () => {
    const user = userEvent.setup()
    seedGuestList(2)
    render(pageTree())
    await user.click(screen.getByRole('button', { name: /import list/i }))
    expect(lastModalProps?.isOpen).toBe(true)
  })

  it('shows an undoable toast after an applied import; undo restores the prior snapshot', async () => {
    const user = userEvent.setup()
    const prior = seedGuestList(1)
    mockAppliedResult = {
      appliedCount: 2,
      mode: 'append',
      source: 'paste',
      priorRankedIds: ['g-0'],
      appliedIds: ['a', 'b'],
      unrankIds: [],
      guestPriorState: prior,
    }
    render(pageTree())
    await user.click(screen.getByRole('button', { name: /import list/i }))
    await user.click(screen.getByRole('button', { name: /mock-apply/i }))
    expect(await screen.findByText(/Imported 2 coasters/i)).toBeInTheDocument()
    // The toast's undo restores the exact pre-import store snapshot.
    await user.click(screen.getByRole('button', { name: /undo/i }))
    await waitFor(() => {
      expect(screen.getByText(/Import undone/i)).toBeInTheDocument()
      expect(getGuestRidesSnapshot().state?.orderedIds).toEqual(prior.orderedIds)
    })
  })
})
