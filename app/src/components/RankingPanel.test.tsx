import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import RankingPanel from './RankingPanel'
import { useAuth } from '../lib/auth-context'
import { useRecomputeFreshness } from '../lib/coasters'
import { useAddRide, useMyRides, type UserRide } from '../lib/rides'
import { makeRankingRow, makeUserRide } from '../test/fixtures'

vi.mock('../lib/auth-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/auth-context')>()
  return {
    ...actual,
    useAuth: vi.fn(),
  }
})

vi.mock('../lib/coasters', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/coasters')>()
  return {
    ...actual,
    useRecomputeFreshness: vi.fn(),
  }
})

vi.mock('../lib/rides', () => ({
  useMyRides: vi.fn(),
  useAddRide: vi.fn(),
}))

const SESSION = { user: { id: 'user-1' } }
const sixMinutesAgo = new Date(Date.now() - 6 * 60_000).toISOString()

const row = makeRankingRow({
  name: 'Steel Vengeance',
  slug: 'steel-vengeance',
  rank: 3,
  score: 2.5,
  comparisons: 42,
  participants: 131,
  first_place_votes: 114,
})

function mockUseAuth(session: unknown, isLoading = false) {
  vi.mocked(useAuth).mockReturnValue({ session, isLoading } as never)
}

function mockRides(rides: UserRide[] | undefined, isPending = false) {
  vi.mocked(useMyRides).mockReturnValue({ data: rides, isPending } as never)
}

// A mutate fake that resolves synchronously so the toast assertion can be
// immediate (no fake timers — see jsdom-testing skill).
function mockAddRide(mode: 'success' | 'error' = 'success') {
  const mutate = vi.fn(
    (_coasterId: string, opts?: { onSuccess?: () => void; onError?: () => void }) => {
      if (mode === 'success') opts?.onSuccess?.()
      else opts?.onError?.()
    },
  )
  vi.mocked(useAddRide).mockReturnValue({ mutate, isPending: false } as never)
  return mutate
}

function renderPanel() {
  return render(
    <MemoryRouter>
      <RankingPanel coaster={row} />
    </MemoryRouter>,
  )
}

describe('RankingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useRecomputeFreshness).mockReturnValue({ data: sixMinutesAgo } as never)
  })

  describe('CTA auth states', () => {
    it('shows the signup CTA for logged-out visitors', () => {
      mockUseAuth(null)
      mockRides(undefined, true)
      renderPanel()
      expect(screen.getByRole('link', { name: 'Sign up to rank this coaster' })).toHaveAttribute(
        'href',
        '/signup',
      )
      expect(screen.queryByRole('button', { name: 'Add to your rankings' })).not.toBeInTheDocument()
    })

    it('hides the signup CTA while auth is still loading', () => {
      mockUseAuth(null, true)
      mockRides(undefined, true)
      renderPanel()
      expect(
        screen.queryByRole('link', { name: 'Sign up to rank this coaster' }),
      ).not.toBeInTheDocument()
    })

    it('renders neither CTA while the rides list is loading', () => {
      mockUseAuth(SESSION)
      mockRides(undefined, true)
      renderPanel()
      expect(screen.queryByRole('button', { name: 'Add to your rankings' })).not.toBeInTheDocument()
      expect(
        screen.queryByRole('link', { name: 'Sign up to rank this coaster' }),
      ).not.toBeInTheDocument()
    })

    it('adds unranked on click and confirms with a toast', async () => {
      const user = userEvent.setup()
      mockUseAuth(SESSION)
      mockRides([])
      const mutate = mockAddRide('success')
      renderPanel()

      await user.click(screen.getByRole('button', { name: 'Add to your rankings' }))
      expect(mutate).toHaveBeenCalledWith(row.id, expect.anything())
      expect(screen.getByText('Added to your rankings — sort it into place')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sort it' })).toBeInTheDocument()
    })

    it('shows an error toast when the add fails', async () => {
      const user = userEvent.setup()
      mockUseAuth(SESSION)
      mockRides([])
      mockAddRide('error')
      renderPanel()

      await user.click(screen.getByRole('button', { name: 'Add to your rankings' }))
      expect(screen.getByText("Couldn't add that coaster — try again")).toBeInTheDocument()
    })

    it('shows the placement chip for a coaster already on the list', () => {
      mockUseAuth(SESSION)
      const rides = Array.from({ length: 47 }, (_, i) =>
        makeUserRide({ coaster_id: i === 2 ? row.id : `other-${i}`, rank: i + 1 }),
      )
      mockRides(rides)
      renderPanel()
      expect(screen.getByRole('link', { name: 'Your ranking: #3 of 47' })).toHaveAttribute(
        'href',
        '/me',
      )
      expect(screen.queryByRole('button', { name: 'Add to your rankings' })).not.toBeInTheDocument()
    })

    it('marks a listed-but-unsorted coaster as status, not action', () => {
      mockUseAuth(SESSION)
      mockRides([makeUserRide({ coaster_id: row.id, rank: null })])
      renderPanel()
      expect(screen.getByRole('link', { name: 'In your list — not sorted yet' })).toHaveAttribute(
        'href',
        '/me',
      )
    })
  })

  describe('freshness marker', () => {
    it('shows the relative recompute time', () => {
      mockUseAuth(null)
      mockRides(undefined, true)
      renderPanel()
      expect(screen.getByText(/Updated 6 minutes ago/)).toBeInTheDocument()
    })

    it('hides the marker when the meta RPC is unavailable', () => {
      vi.mocked(useRecomputeFreshness).mockReturnValue({ data: null } as never)
      mockUseAuth(null)
      mockRides(undefined, true)
      renderPanel()
      expect(screen.queryByText(/Updated /)).not.toBeInTheDocument()
    })
  })

  describe('movement chip', () => {
    it('shows the weekly delta next to the rank', () => {
      vi.mocked(useRecomputeFreshness).mockReturnValue({ data: null } as never)
      mockUseAuth(null)
      mockRides(undefined, true)
      const climber = makeRankingRow({ rank: 3, rank_last_week: 5 })
      render(
        <MemoryRouter>
          <RankingPanel coaster={climber} />
        </MemoryRouter>,
      )
      expect(screen.getByTitle('Up 2 places this week')).toBeInTheDocument()
    })

    it('shows nothing when there is no baseline', () => {
      mockUseAuth(null)
      mockRides(undefined, true)
      renderPanel()
      expect(screen.queryByTitle(/place[s]? this week/)).not.toBeInTheDocument()
    })
  })

  describe('score explainer popover', () => {
    beforeEach(() => {
      mockUseAuth(null)
      mockRides(undefined, true)
      vi.mocked(useRecomputeFreshness).mockReturnValue({ data: null } as never)
    })

    it('opens on click with the methodology summary and an about link', async () => {
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByRole('button', { name: /how is this calculated/i }))
      expect(screen.getByText(/Bradley-Terry model/)).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/about')
    })

    it('closes on Escape', async () => {
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByRole('button', { name: /how is this calculated/i }))
      fireEvent.keyDown(document, { key: 'Escape' })
      expect(screen.queryByText(/Bradley-Terry model/)).not.toBeInTheDocument()
    })

    it('closes on an outside pointer press', async () => {
      const user = userEvent.setup()
      renderPanel()
      await user.click(screen.getByRole('button', { name: /how is this calculated/i }))
      fireEvent.pointerDown(document.body)
      expect(screen.queryByText(/Bradley-Terry model/)).not.toBeInTheDocument()
    })
  })

  describe('unrated coasters', () => {
    it('shows the no-ratings state with dashes instead of figures', () => {
      vi.mocked(useRecomputeFreshness).mockReturnValue({ data: null } as never)
      mockUseAuth(null)
      mockRides(undefined, true)
      const unrated = makeRankingRow({
        rank: null,
        score: null,
        comparisons: null,
        participants: null,
        first_place_votes: null,
      })
      render(
        <MemoryRouter>
          <RankingPanel coaster={unrated} />
        </MemoryRouter>,
      )
      expect(screen.getByText('Not yet ranked')).toBeInTheDocument()
      expect(screen.getByText('No ratings yet')).toBeInTheDocument()
      expect(screen.queryByText(/How is this calculated/)).not.toBeInTheDocument()
      expect(screen.getAllByText('—')).toHaveLength(3)
    })
  })
})
