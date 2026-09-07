import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { useQueryClient } from '@tanstack/react-query'
import ImportListModal, { type AppliedImport } from './ImportListModal'
import { useAllCoasters, useParks } from '../../lib/coasters'
import { useAuth } from '../../lib/auth-context'
import { applyImport, logImportEvent } from '../../lib/import/apply'
import { makePark, makeRankingRow, makeUserRide } from '../../test/fixtures'

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>()
  return { ...actual, useQueryClient: vi.fn() }
})
vi.mock('../../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/coasters')>()
  return { ...actual, useAllCoasters: vi.fn(), useParks: vi.fn() }
})
vi.mock('../../lib/auth-context', () => ({
  useAuth: vi.fn(),
}))
vi.mock('../../lib/import/apply', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/import/apply')>()
  return {
    ...actual,
    applyImport: vi.fn(),
    logImportEvent: vi.fn().mockResolvedValue(undefined),
  }
})

const fury = makeRankingRow({ id: 'fury', name: 'Fury 325', park_name: 'Carowinds' })
const batmanSFGAm = makeRankingRow({
  id: 'bat-sfgam',
  name: 'Batman: The Ride',
  park_name: 'Six Flags Great America',
  park_id: 'park-sfgam',
})
const batmanSFGAdv = makeRankingRow({
  id: 'bat-sfgadv',
  name: 'Batman: The Ride',
  park_name: 'Six Flags Great Adventure',
  park_id: 'park-sfgadv',
})
const pantherian = makeRankingRow({
  id: 'pantherian',
  name: 'Pantherian',
  park_name: 'Kings Dominion',
  aliases: ['Intimidator 305'],
})

const board = [fury, batmanSFGAm, batmanSFGAdv, pantherian]
const park = makePark({ id: 'park-1', name: 'Test Park' })

function mockEnv() {
  vi.mocked(useAllCoasters).mockReturnValue({
    data: board,
    isPending: false,
    isLoading: false,
  } as never)
  vi.mocked(useParks).mockReturnValue({ data: [park] } as never)
  vi.mocked(useAuth).mockReturnValue({ user: { id: 'user-1' } } as never)
  vi.mocked(useQueryClient).mockReturnValue({
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
  } as never)
}

type RenderOptions = {
  rides?: ReturnType<typeof makeUserRide>[]
  onApplied?: (result: AppliedImport) => void
}

function renderModal({ rides = [], onApplied = vi.fn() }: RenderOptions = {}) {
  const onError = vi.fn()
  const onClose = vi.fn()
  render(
    <ImportListModal
      isOpen
      onClose={onClose}
      rides={rides}
      onApplied={onApplied}
      onError={onError}
    />,
  )
  return { onApplied, onError, onClose }
}

// Multi-line paste must go through fireEvent — userEvent.type interprets
// \t/\n as Tab/Enter keystrokes instead of inserting characters.
async function pasteText(user: UserEvent, text: string) {
  fireEvent.change(screen.getByLabelText(/or paste rows/i), { target: { value: text } })
  await user.click(screen.getByRole('button', { name: /parse pasted rows/i }))
}

async function pasteAndReview(user: UserEvent, text: string) {
  await pasteText(user, text)
  await screen.findByText('Review import')
}

beforeEach(() => {
  vi.clearAllMocks()
  mockEnv()
  vi.mocked(applyImport).mockResolvedValue(2)
})

describe('ImportListModal — choose step', () => {
  it('guides toward CSV export for Google Sheets and Excel', () => {
    renderModal()
    expect(screen.getByText(/Google Sheets: File → Download/)).toBeInTheDocument()
    expect(screen.getByText(/Excel: File → Save As → CSV UTF-8/)).toBeInTheDocument()
  })

  it('shows a parse error without leaving the choose step', async () => {
    const user = userEvent.setup()
    renderModal()
    // No name column → ParseError from the heuristics.
    await pasteText(user, '1\n2\n3')
    expect(await screen.findByText(/coaster-name column/i)).toBeInTheDocument()
    // Still on the choose step.
    expect(screen.getByText('Import your list')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Import \d+/i })).not.toBeInTheDocument()
  })

  it('logs a failed telemetry event on parse errors', async () => {
    const user = userEvent.setup()
    renderModal()
    await pasteText(user, '1\n2\n3')
    await waitFor(() => {
      expect(logImportEvent).toHaveBeenCalledWith('failed', 'paste', expect.anything())
    })
  })
})

describe('ImportListModal — review step', () => {
  it('summarizes auto matches, needs-a-pick, and misses', async () => {
    const user = userEvent.setup()
    renderModal()
    await pasteAndReview(user, 'Fury 325\tCarowinds\nBatman: The Ride\nMadeup Coaster XYZ')
    expect(screen.getByText('1 matched')).toBeInTheDocument()
    expect(screen.getByText('1 need a pick')).toBeInTheDocument()
    expect(screen.getByText('1 not found')).toBeInTheDocument()
    // Apply is enabled with the 1 auto-match even though other rows await picks.
    expect(screen.getByRole('button', { name: /^Import 1 coasters$/i })).toBeEnabled()
  })

  it('auto-matches the alias tier (Intimidator 305 → Pantherian)', async () => {
    const user = userEvent.setup()
    const { onApplied } = renderModal()
    await pasteAndReview(user, 'Intimidator 305')
    expect(screen.getByText(/→ Pantherian/)).toBeInTheDocument()
    const apply = screen.getByRole('button', { name: /^Import 1 coasters$/i })
    expect(apply).toBeEnabled()
    await user.click(apply)
    await waitFor(() => {
      expect(applyImport).toHaveBeenCalledWith({
        orderedIds: ['pantherian'],
        replace: false,
        source: 'paste',
        stats: expect.objectContaining({ auto_matched: 1, not_found: 0 }),
      })
      expect(onApplied).toHaveBeenCalledWith(
        expect.objectContaining({
          appliedCount: 2,
          mode: 'append',
          source: 'paste',
          priorRankedIds: [],
        }),
      )
    })
  })

  it('demotes the parkless Batman tie to a pick and resolves via candidate chip', async () => {
    const user = userEvent.setup()
    renderModal()
    await pasteAndReview(user, 'Batman: The Ride')
    expect(screen.getByText('1 need a pick')).toBeInTheDocument()
    // Candidate chips show the park context.
    const chip = screen.getByRole('button', {
      name: /Batman: The Ride — Six Flags Great America/,
    })
    await user.click(chip)
    expect(screen.getByText(/→ Batman: The Ride — Six Flags Great America/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeChecked()
    expect(screen.getByRole('button', { name: /^Import 1 coasters$/i })).toBeEnabled()
  })

  it('resolves a missing row through the manual search picker', async () => {
    const user = userEvent.setup()
    renderModal()
    await pasteAndReview(user, 'Madeup Coaster XYZ')
    await user.click(screen.getByRole('button', { name: 'Find' }))
    await user.type(screen.getByPlaceholderText('Search the catalog…'), 'fury')
    const result = await screen.findByRole('button', { name: /Fury 325 — Carowinds/ })
    await user.click(result)
    expect(screen.getByRole('button', { name: /^Import 1 coasters$/i })).toBeEnabled()
  })

  it('excludes search results that are already ranked', async () => {
    const user = userEvent.setup()
    renderModal({
      rides: [makeUserRide({ coaster_id: 'fury', rank: 1 })],
    })
    await pasteAndReview(user, 'Madeup Coaster XYZ')
    await user.click(screen.getByRole('button', { name: 'Find' }))
    await user.type(screen.getByPlaceholderText('Search the catalog…'), 'fury')
    expect(screen.queryByRole('button', { name: /Fury 325/ })).not.toBeInTheDocument()
  })

  it('marks rows matching an already-ranked coaster as skipped', async () => {
    const user = userEvent.setup()
    renderModal({
      rides: [makeUserRide({ coaster_id: 'fury', rank: 1 })],
    })
    await pasteAndReview(user, 'Fury 325\tCarowinds')
    expect(screen.getByText('1 already ranked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Import 0 coasters$/i })).toBeDisabled()
    expect(applyImport).not.toHaveBeenCalled()
  })

  it('replace mode keeps already-ranked rows at their imported position', async () => {
    // Regression: the apply set used to exclude 'already' rows unconditionally,
    // so replace mode deleted them from the account (RPC clears ranked rows
    // first, payload was missing them).
    const user = userEvent.setup()
    renderModal({
      rides: [makeUserRide({ coaster_id: 'fury', rank: 1 })],
    })
    await pasteAndReview(user, 'Fury 325\tCarowinds\nPantherian')
    expect(screen.getByRole('button', { name: /^Import 1 coasters$/i })).toBeEnabled()
    await user.click(screen.getByRole('radio', { name: /replace my list/i }))
    // The already-ranked row becomes keepable and defaults to kept.
    expect(screen.getByText('already in list')).toBeInTheDocument()
    const keep = screen.getByRole('checkbox', { name: /keep in my list/i })
    expect(keep).toBeChecked()
    // Still keepable-but-off: user can exclude it from the replaced list.
    await user.click(keep)
    expect(screen.getByRole('button', { name: /review replace…/i })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /review replace…/i }))
    await user.click(screen.getByRole('button', { name: /replace list with 1 coasters/i }))
    await waitFor(() => {
      expect(applyImport).toHaveBeenCalledWith(
        expect.objectContaining({ orderedIds: ['pantherian'], replace: true }),
      )
    })
  })

  it('replace mode includes kept already-ranked rows at imported position', async () => {
    const user = userEvent.setup()
    renderModal({
      rides: [makeUserRide({ coaster_id: 'fury', rank: 1 })],
    })
    await pasteAndReview(user, 'Fury 325\tCarowinds\nPantherian')
    await user.click(screen.getByRole('radio', { name: /replace my list/i }))
    await user.click(screen.getByRole('button', { name: /review replace…/i }))
    await user.click(screen.getByRole('button', { name: /replace list with 2 coasters/i }))
    await waitFor(() => {
      expect(applyImport).toHaveBeenCalledWith(
        expect.objectContaining({ orderedIds: ['fury', 'pantherian'], replace: true }),
      )
    })
  })

  it('append mode stays excluded for already-ranked rows even after a replace detour', async () => {
    const user = userEvent.setup()
    renderModal({
      rides: [makeUserRide({ coaster_id: 'fury', rank: 1 })],
    })
    await pasteAndReview(user, 'Fury 325\tCarowinds\nPantherian')
    await user.click(screen.getByRole('radio', { name: /replace my list/i }))
    await user.click(screen.getByRole('radio', { name: /add after my list/i }))
    expect(screen.getByRole('button', { name: /^Import 1 coasters$/i })).toBeEnabled()
    expect(screen.queryByRole('checkbox', { name: /keep in my list/i })).not.toBeInTheDocument()
  })

  it('reports promoted holding-pen rows for undo', async () => {
    const user = userEvent.setup()
    const { onApplied } = renderModal({
      rides: [makeUserRide({ coaster_id: 'fury', rank: null })],
    })
    await pasteAndReview(user, 'Fury 325')
    // A pen-row match is a normal add (the RPC upsert promotes the same row).
    expect(screen.getByText('matched', { selector: 'span' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Import 1 coasters$/i }))
    await waitFor(() => {
      expect(onApplied).toHaveBeenCalledWith(
        expect.objectContaining({
          priorRankedIds: [],
          appliedIds: ['fury'],
          unrankIds: ['fury'],
        }),
      )
    })
  })

  it('appends after the existing ranked list in file order', async () => {
    const user = userEvent.setup()
    const { onApplied } = renderModal({
      // Server rides arrive rank-sorted; mirror that here.
      rides: [
        makeUserRide({ coaster_id: 'prior-1', rank: 1 }),
        makeUserRide({ coaster_id: 'prior-2', rank: 2 }),
      ],
    })
    // Both rows auto-match against the fixture board (Fury + Pantherian).
    await pasteAndReview(user, 'Fury 325\nPantherian')
    await user.click(screen.getByRole('button', { name: /^Import 2 coasters$/i }))
    await waitFor(() => {
      expect(applyImport).toHaveBeenCalledWith({
        orderedIds: ['prior-1', 'prior-2', 'fury', 'pantherian'],
        replace: false,
        source: 'paste',
        stats: expect.objectContaining({ auto_matched: 2 }),
      })
      expect(onApplied).toHaveBeenCalledWith(
        expect.objectContaining({
          priorRankedIds: ['prior-1', 'prior-2'],
        }),
      )
    })
  })

  it('reverses accepted order when "first row is last" is chosen', async () => {
    const user = userEvent.setup()
    renderModal()
    await pasteAndReview(user, 'Fury 325\nPantherian')
    await user.click(screen.getByRole('radio', { name: /first row is last/i }))
    await user.click(screen.getByRole('button', { name: /^Import 2 coasters$/i }))
    await waitFor(() => {
      expect(applyImport).toHaveBeenCalledWith(
        expect.objectContaining({ orderedIds: ['pantherian', 'fury'] }),
      )
    })
  })

  it('gates replace mode behind an explicit confirm', async () => {
    const user = userEvent.setup()
    renderModal({
      rides: [makeUserRide({ coaster_id: 'prior-1', rank: 1 })],
    })
    await pasteAndReview(user, 'Fury 325')
    await user.click(screen.getByRole('radio', { name: /replace my list/i }))
    expect(screen.getByRole('button', { name: /review replace…/i })).toBeInTheDocument()
    expect(applyImport).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: /review replace…/i }))
    const replace = screen.getByRole('button', { name: /replace list with 1 coasters/i })
    expect(replace).toHaveClass('bg-danger-text')
    await user.click(replace)
    await waitFor(() => {
      expect(applyImport).toHaveBeenCalledWith(
        expect.objectContaining({ orderedIds: ['fury'], replace: true }),
      )
    })
  })

  it('surfaces RPC failures via onError and a failed telemetry event', async () => {
    vi.mocked(applyImport).mockRejectedValue(new Error('Stale list'))
    const user = userEvent.setup()
    const { onError } = renderModal({
      rides: [makeUserRide({ coaster_id: 'prior-1', rank: 1 })],
    })
    await pasteAndReview(user, 'Fury 325')
    await user.click(screen.getByRole('button', { name: /^Import 1 coasters$/i }))
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(expect.stringContaining('Stale list'))
      expect(logImportEvent).toHaveBeenCalledWith('failed', 'paste', expect.anything())
    })
  })

  it('paginates large reviews with a show-more control', async () => {
    const user = userEvent.setup()
    renderModal()
    const many = Array.from({ length: 130 }, (_, i) => `Fury 325 variant ${i + 1}`).join('\n')
    await pasteAndReview(user, many)
    const shown = screen.getAllByText(/variant \d+/)
    expect(shown).toHaveLength(100)
    await user.click(screen.getByRole('button', { name: /show more rows/i }))
    expect(screen.getAllByText(/variant \d+/)).toHaveLength(130)
  })

  it('logs a parsed telemetry event when entering review', async () => {
    const user = userEvent.setup()
    renderModal()
    await pasteAndReview(user, 'Fury 325')
    await waitFor(() => {
      expect(logImportEvent).toHaveBeenCalledWith(
        'parsed',
        'paste',
        expect.objectContaining({ rowsTotal: 1 }),
      )
    })
  })

  it('unmatched-names telemetry excludes already-ranked rows', async () => {
    const user = userEvent.setup()
    renderModal({
      rides: [makeUserRide({ coaster_id: 'fury', rank: 1 })],
    })
    await pasteAndReview(user, 'Fury 325\nMadeup Coaster XYZ')
    await waitFor(() => {
      expect(logImportEvent).toHaveBeenCalledWith(
        'parsed',
        'paste',
        expect.objectContaining({
          stats: expect.objectContaining({ unmatched_names: ['Madeup Coaster XYZ'] }),
        }),
      )
    })
  })

  it('surfaces catalog load failures instead of silently doing nothing', async () => {
    vi.mocked(useAllCoasters).mockReturnValue({
      data: undefined,
      isPending: false,
      isLoading: false,
      isError: true,
    } as never)
    const user = userEvent.setup()
    renderModal()
    await pasteText(user, 'Fury 325')
    expect(await screen.findByText(/coaster catalog couldn.t be loaded/i)).toBeInTheDocument()
    expect(screen.getByText(/imports need it for matching/i)).toBeInTheDocument()
    expect(applyImport).not.toHaveBeenCalled()
  })

  it('caps absurd pastes with guidance', async () => {
    const user = userEvent.setup()
    renderModal()
    await pasteText(user, 'x'.repeat(1_100_000))
    expect(await screen.findByText(/too much text/i)).toBeInTheDocument()
    expect(screen.getByText('Import your list')).toBeInTheDocument()
  })
})

describe('ImportListModal — empty list', () => {
  it('hides the merge choice with no ranked coasters', async () => {
    const user = userEvent.setup()
    renderModal()
    await pasteAndReview(user, 'Fury 325')
    expect(screen.queryByRole('radio', { name: /replace my list/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Import 1 coasters$/i })).toBeEnabled()
  })
})
