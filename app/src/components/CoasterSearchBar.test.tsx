import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import CoasterSearchBar from './CoasterSearchBar'
import { useAllCoasters, useParks, OTHER_PARK_NAME } from '../lib/coasters'
import { makePark, makeRankingRow } from '../test/fixtures'

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return { ...actual, useAllCoasters: vi.fn(), useParks: vi.fn() }
})

const park = makePark({ id: 'park-1', name: 'Test Park' })

function matchingRows(count: number) {
  return Array.from({ length: count }, (_, i) =>
    makeRankingRow({
      id: `alpha-${i + 1}`,
      name: `Alpha ${i + 1}`,
      slug: `alpha-${i + 1}`,
      park_id: 'park-1',
    }),
  )
}

function mockCatalog(rows: ReturnType<typeof matchingRows>) {
  vi.mocked(useAllCoasters).mockReturnValue({ data: rows, isLoading: false } as never)
  vi.mocked(useParks).mockReturnValue({ data: [park] } as never)
}

function renderBar(existingCoasterIds: Set<string> = new Set()) {
  return render(<CoasterSearchBar existingCoasterIds={existingCoasterIds} onAdd={vi.fn()} />)
}

async function typeQuery(user: UserEvent, text: string) {
  const input = screen.getByRole('combobox', { name: /add coasters to your list/i })
  await user.type(input, text)
  return input
}

describe('CoasterSearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCatalog(matchingRows(2))
  })

  it('shows a hint instead of a dead input at one character', async () => {
    // Issue #91: a 1-char query used to leave the dropdown closed with no
    // feedback — the dead-input feel.
    const user = userEvent.setup()
    renderBar()
    const input = await typeQuery(user, 'a')
    expect(await screen.findByText(/type at least 2 characters/i)).toBeInTheDocument()
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.queryByRole('option')).not.toBeInTheDocument()
  })

  it('lists matching coasters for a full query', async () => {
    const user = userEvent.setup()
    renderBar()
    await typeQuery(user, 'alph')
    expect(await screen.findByRole('option', { name: /alpha 1/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /alpha 2/i })).toBeInTheDocument()
  })

  it('shows a cap footer when more matches exist than are rendered', async () => {
    // Issue #91: results beyond the 8-item cap were silently unreachable.
    mockCatalog(matchingRows(10))
    const user = userEvent.setup()
    renderBar()
    await typeQuery(user, 'alpha')
    expect(await screen.findByText(/showing 8 of 10 — refine your search/i)).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(8)
  })

  it('hides the cap footer when every match is rendered', async () => {
    const user = userEvent.setup()
    renderBar()
    await typeQuery(user, 'alpha')
    expect(await screen.findByRole('option', { name: /alpha 1/i })).toBeInTheDocument()
    expect(screen.queryByText(/showing \d+ of \d+/i)).not.toBeInTheDocument()
  })

  it('counts only reachable matches toward the cap total', async () => {
    // Excluded (already-added) coasters are filtered before slicing, so the
    // footer reports matches the user can actually still add.
    mockCatalog(matchingRows(12))
    const user = userEvent.setup()
    renderBar(new Set(['alpha-1', 'alpha-2', 'alpha-3']))
    await typeQuery(user, 'alpha')
    expect(await screen.findByText(/showing 8 of 9 — refine your search/i)).toBeInTheDocument()
  })

  it('clears the query after selecting a result', async () => {
    // Regression pin for issue #91 search gap 3 (query persisting after add).
    const user = userEvent.setup()
    renderBar()
    const input = await typeQuery(user, 'alpha')
    await user.click(await screen.findByRole('option', { name: /alpha 1/i }))
    expect(input).toHaveValue('')
  })

  it('shows a neutral label instead of the synthetic Other park name', async () => {
    // Issue #91: "Other (unknown location)" leaked verbatim into results.
    const user = userEvent.setup()
    mockCatalog([makeRankingRow({ name: 'Dragon Coaster', slug: 'dragon-coaster' })])
    vi.mocked(useParks).mockReturnValue({
      data: [makePark({ name: OTHER_PARK_NAME })],
    } as never)
    renderBar()
    await typeQuery(user, 'dragon')
    const option = await screen.findByRole('option', { name: /dragon coaster/i })
    expect(option).toHaveTextContent('Unknown park')
    expect(option).not.toHaveTextContent(OTHER_PARK_NAME)
  })
})
