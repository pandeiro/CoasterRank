import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ParkBulkAddModal from './ParkBulkAddModal'
import { useAllCoasters, useParks } from '../lib/coasters'
import type { RankingRow } from '../lib/coasters'
import { makePark, makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return { ...actual, useAllCoasters: vi.fn(), useParks: vi.fn() }
})

const carowinds = makePark({
  id: 'park-carowinds',
  name: 'Carowinds',
  city: 'Charlotte',
  country: 'United States',
})
const cedar = makePark({
  id: 'park-cp',
  name: 'Cedar Point',
  city: 'Sandusky',
  country: 'United States',
})

const fury = makeRankingRow({
  id: 'fury',
  name: 'Fury 325',
  park_id: 'park-carowinds',
  park_name: 'Carowinds',
  rank: 3,
})
const copperhead = makeRankingRow({
  id: 'copperhead',
  name: 'Copperhead Strike',
  park_id: 'park-carowinds',
  park_name: 'Carowinds',
  rank: 40,
})
const hurler = makeRankingRow({
  id: 'hurler',
  name: 'Hurler',
  park_id: 'park-carowinds',
  park_name: 'Carowinds',
  status: 'defunct',
  rank: 120,
})
const steve = makeRankingRow({
  id: 'steve',
  name: 'Steel Vengeance',
  park_id: 'park-cp',
  park_name: 'Cedar Point',
  rank: 1,
})
const gatekeeper = makeRankingRow({
  id: 'gatekeeper',
  name: 'GateKeeper',
  park_id: 'park-cp',
  park_name: 'Cedar Point',
  rank: 25,
})

const board: RankingRow[] = [steve, fury, gatekeeper, copperhead, hurler]

function mockEnv() {
  vi.mocked(useAllCoasters).mockReturnValue({
    data: board,
    isPending: false,
    isLoading: false,
    isError: false,
  } as never)
  vi.mocked(useParks).mockReturnValue({ data: [carowinds, cedar] } as never)
}

function renderModal(
  overrides: { existingIds?: Set<string>; onCommit?: (rows: RankingRow[]) => void } = {},
) {
  const onCommit = overrides.onCommit ?? vi.fn()
  render(
    <ParkBulkAddModal
      isOpen
      onClose={vi.fn()}
      existingIds={overrides.existingIds ?? new Set()}
      onCommit={onCommit}
    />,
  )
  return { onCommit }
}

/** Searches for a park (the list is query-gated) and expands its row. */
async function expandPark(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const search = screen.getByRole('searchbox', { name: /search parks/i })
  await user.clear(search)
  await user.type(search, name)
  const header = await screen.findByRole('button', { name: new RegExp(name) })
  await user.click(header)
  expect(header).toHaveAttribute('aria-expanded', 'true')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEnv()
})

describe('ParkBulkAddModal', () => {
  it('finds parks by name and by city', async () => {
    const user = userEvent.setup()
    renderModal()
    const search = screen.getByRole('searchbox', { name: /search parks/i })
    await user.type(search, 'charlotte')
    expect(await screen.findByText('Carowinds')).toBeInTheDocument()
    await user.clear(search)
    await user.type(search, 'cedar point')
    expect(await screen.findByText('Cedar Point')).toBeInTheDocument()
  })

  it('shows an empty state for unmatched queries', async () => {
    const user = userEvent.setup()
    renderModal()
    await user.type(screen.getByRole('searchbox', { name: /search parks/i }), 'zootopia')
    expect(await screen.findByText(/no parks match/i)).toBeInTheDocument()
  })

  it('defaults to operating coasters and reports already-listed ones', async () => {
    const user = userEvent.setup()
    renderModal({ existingIds: new Set(['fury']) })
    await expandPark(user, 'Carowinds')
    const copperheadBox = screen.getByRole('checkbox', { name: /Copperhead Strike/ })
    const hurlerBox = screen.getByRole('checkbox', { name: /Hurler/ })
    const furyBox = screen.getByRole('checkbox', { name: /Fury 325/ })
    expect(copperheadBox).toBeChecked()
    // Non-operating rows default unchecked but stay selectable.
    expect(hurlerBox).not.toBeChecked()
    expect(hurlerBox).toBeEnabled()
    // Already-listed rows are checked-and-locked (re-adding is a no-op).
    expect(furyBox).toBeChecked()
    expect(furyBox).toBeDisabled()
    expect(screen.getByText(/1 already in your list/)).toBeInTheDocument()
  })

  it('commits the selection in board-rank order across parks', async () => {
    const user = userEvent.setup()
    const { onCommit } = renderModal()
    // Carowinds first: defaults (Fury, Copperhead) checked; deselect
    // Copperhead, add defunct Hurler. The selection persists while we
    // switch parks (only the searched park's checklist stays mounted).
    await expandPark(user, 'Carowinds')
    await user.click(screen.getByRole('checkbox', { name: /Copperhead Strike/ }))
    await user.click(screen.getByRole('checkbox', { name: /Hurler/ }))
    // Cedar Point: defaults Steel Vengeance + GateKeeper.
    await expandPark(user, 'Cedar Point')
    await user.click(screen.getByRole('button', { name: /^Add 4 coasters$/i }))
    expect(onCommit).toHaveBeenCalledWith([steve, fury, gatekeeper, hurler])
  })

  it('master checkbox flips between check-all and uncheck-all', async () => {
    const user = userEvent.setup()
    renderModal()
    await expandPark(user, 'Carowinds')
    // 2/3 default-checked (operating) → the master offers "check all".
    const master = screen.getByRole('checkbox', { name: /check all \(3\)/i })
    await user.click(master)
    expect(screen.getByRole('checkbox', { name: /Hurler/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /uncheck all \(3\)/i })).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox', { name: /uncheck all \(3\)/i }))
    expect(screen.getByRole('checkbox', { name: /Copperhead Strike/ })).not.toBeChecked()
    expect(screen.getByRole('checkbox', { name: /Hurler/ })).not.toBeChecked()
  })

  it('disables commit with an empty selection', async () => {
    const user = userEvent.setup()
    renderModal()
    await expandPark(user, 'Carowinds')
    await user.click(screen.getByRole('checkbox', { name: /Fury 325/ }))
    await user.click(screen.getByRole('checkbox', { name: /Copperhead Strike/ }))
    expect(screen.getByRole('button', { name: /^Add 0 coasters$/i })).toBeDisabled()
  })

  it('re-expanding a park never resurrects deselected defaults', async () => {
    const user = userEvent.setup()
    renderModal()
    await expandPark(user, 'Carowinds')
    await user.click(screen.getByRole('checkbox', { name: /Copperhead Strike/ }))
    // Collapse + re-expand: defaults apply once per park, first expand only.
    await user.click(screen.getByRole('button', { name: /Carowinds/ }))
    await user.click(screen.getByRole('button', { name: /Carowinds/ }))
    expect(screen.getByRole('checkbox', { name: /Copperhead Strike/ })).not.toBeChecked()
  })
})
