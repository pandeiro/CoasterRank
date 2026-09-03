import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { HelmetProvider } from 'react-helmet-async'
import RiderPage from './RiderPage'
import { useRiderPage, type RiderPageData } from '../lib/rider'
import { AuthContext, type AuthContextValue } from '../lib/auth-context'

vi.mock('../lib/rider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/rider')>()
  return {
    ...actual,
    useRiderPage: vi.fn(),
  }
})

const anonymousAuth: AuthContextValue = {
  session: null,
  user: null,
  isLoading: false,
  isConfirmed: false,
  signOut: vi.fn(),
}

const riderData: RiderPageData = {
  profile: {
    username: 'coaster_fan',
    display_name: 'Coaster Fan',
    avatar_url: null,
    og_image_url: null,
    member_since: '2024-03-01T00:00:00Z',
  },
  rides: [
    {
      coaster_id: 'c1',
      rank: 1,
      name: 'Steel Vengeance',
      slug: 'steel-vengeance',
      material: 'steel',
      status: 'operating',
      park_name: 'Cedar Point',
      park_slug: 'cedar-point',
      score: 1.23,
    },
    {
      coaster_id: 'c2',
      rank: 2,
      name: 'Fury 325',
      slug: 'fury-325',
      material: 'steel',
      status: 'operating',
      park_name: 'Carowinds',
      park_slug: 'carowinds',
      score: 1.1,
    },
  ],
}

function renderAt(path = '/riders/coaster_fan', auth: AuthContextValue = anonymousAuth) {
  return render(
    <HelmetProvider>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/riders/:username" element={<RiderPage />} />
          </Routes>
        </MemoryRouter>
      </AuthContext.Provider>
    </HelmetProvider>,
  )
}

describe('RiderPage', () => {
  beforeEach(() => {
    document.title = ''
    vi.clearAllMocks()
  })

  it('renders the rider hero, stats, and ranked list', () => {
    vi.mocked(useRiderPage).mockReturnValue({
      data: riderData,
      isPending: false,
      isError: false,
    } as never)
    renderAt()

    expect(screen.getByText('Coaster Fan')).toBeInTheDocument()
    expect(screen.getByText(/@coaster_fan/)).toBeInTheDocument()
    expect(screen.getByText(/member since 2024/)).toBeInTheDocument()
    // The #1 pick appears both in the stats row and at the top of the list.
    expect(screen.getAllByText('Steel Vengeance').length).toBeGreaterThan(0)
    expect(screen.getByText('Fury 325')).toBeInTheDocument()
    expect(screen.getByText('Cedar Point')).toBeInTheDocument()
    expect(screen.getByText('#1 pick')).toBeInTheDocument()
    expect(screen.getByText('Build your own ranking')).toBeInTheDocument()
  })

  it('hides the signup CTA for logged-in users', () => {
    vi.mocked(useRiderPage).mockReturnValue({
      data: riderData,
      isPending: false,
      isError: false,
    } as never)
    renderAt('/riders/coaster_fan', {
      ...anonymousAuth,
      session: {} as never,
      user: { id: 'u1' } as never,
    })

    expect(screen.queryByText('Build your own ranking')).not.toBeInTheDocument()
    expect(screen.queryByText('Sign up free')).not.toBeInTheDocument()
  })

  it('sets human-facing title and meta description via helmet', async () => {
    vi.mocked(useRiderPage).mockReturnValue({
      data: riderData,
      isPending: false,
      isError: false,
    } as never)
    renderAt()

    await waitFor(() => {
      expect(document.title).toBe('Coaster Fan (@coaster_fan) — CoasterRank')
    })
    const description = document.head.querySelector('meta[name="description"]')
    expect(description?.getAttribute('content')).toContain('2 coasters ranked')
    expect(description?.getAttribute('content')).toContain('#1: Steel Vengeance')
  })

  it('falls back to the static brand card for og:image when no custom card exists', async () => {
    vi.mocked(useRiderPage).mockReturnValue({
      data: riderData,
      isPending: false,
      isError: false,
    } as never)
    renderAt()
    await waitFor(() => {
      expect(document.head.querySelector('meta[property="og:image"]')).not.toBeNull()
    })
    expect(document.head.querySelector('meta[property="og:image"]')?.getAttribute('content')).toBe(
      `${window.location.origin}/og-default.png`,
    )
  })

  it('uses the per-rider share card for og:image when one exists', async () => {
    vi.mocked(useRiderPage).mockReturnValue({
      data: {
        ...riderData,
        profile: { ...riderData.profile, og_image_url: 'https://img.test/og-card.png' },
      },
      isPending: false,
      isError: false,
    } as never)
    renderAt()
    await waitFor(() => {
      expect(
        document.head.querySelector('meta[property="og:image"]')?.getAttribute('content'),
      ).toBe('https://img.test/og-card.png')
    })
  })

  it('shows the not-found state for unknown or non-shared usernames', () => {
    vi.mocked(useRiderPage).mockReturnValue({
      data: null,
      isPending: false,
      isError: false,
    } as never)
    renderAt()

    expect(screen.getByText(/doesn't exist or isn't shared/i)).toBeInTheDocument()
  })

  it('shows the empty-list state when nothing is ranked', () => {
    vi.mocked(useRiderPage).mockReturnValue({
      data: { ...riderData, rides: [] },
      isPending: false,
      isError: false,
    } as never)
    renderAt()

    expect(screen.getByText('No coasters ranked yet.')).toBeInTheDocument()
  })

  it('shows an error state on fetch failure', () => {
    vi.mocked(useRiderPage).mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
    } as never)
    renderAt()

    expect(screen.getByText(/couldn't load that rider page/i)).toBeInTheDocument()
  })
})
