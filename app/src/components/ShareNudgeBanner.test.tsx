import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ShareNudgeBanner from './ShareNudgeBanner'

const topThree = [
  { rank: 1, name: 'Steel Vengeance', parkName: 'Cedar Point' },
  { rank: 2, name: 'Fury 325', parkName: 'Carowinds' },
  { rank: 3, name: 'Iron Gwazi', parkName: null },
]

function renderBanner(props: Partial<Parameters<typeof ShareNudgeBanner>[0]> = {}) {
  const onDismiss = vi.fn()
  render(
    <MemoryRouter>
      <ShareNudgeBanner
        userId="u1"
        username="coaster_fan"
        displayName={null}
        avatarUrl={null}
        publicList={true}
        rankedCount={9}
        parkCount={5}
        topThree={topThree}
        onDismiss={onDismiss}
        {...props}
      />
    </MemoryRouter>,
  )
  return { onDismiss }
}

describe('ShareNudgeBanner', () => {
  it('opens with the want-to-share question and the engage tagline', () => {
    renderBanner()
    expect(screen.getByText('Want to share your board?')).toBeInTheDocument()
    expect(screen.getByText(/put your top 3 on the internet/i)).toBeInTheDocument()
  })

  it('shows the condensed share-page skeleton: identity, pills, and top-3', () => {
    renderBanner()
    expect(screen.getByText('@coaster_fan')).toBeInTheDocument()
    expect(screen.getByText('9 ranked')).toBeInTheDocument()
    expect(screen.getByText('5 parks')).toBeInTheDocument()
    expect(screen.getByText('Steel Vengeance')).toBeInTheDocument()
    expect(screen.getByText(/Cedar Point/)).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
  })

  it('prefers the display name when one is set', () => {
    renderBanner({ displayName: 'Ana' })
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.queryByText('coaster_fan')).not.toBeInTheDocument()
  })

  it('hides the top-3 rows when nothing is ranked', () => {
    renderBanner({ topThree: [] })
    expect(screen.queryByText('#1')).not.toBeInTheDocument()
  })

  it('keeps the url hidden until YES unfurls it, protocol-stripped, with copy + preview', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    const user = userEvent.setup()
    renderBanner()
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^yes$/i }))
    // The short /@ share form, displayed without the protocol; the preview
    // link stays on the canonical /riders route.
    expect(
      screen.getByText(`${window.location.origin.replace(/^https?:\/\//, '')}/@coaster_fan`),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /preview/i })).toHaveAttribute(
      'href',
      '/riders/coaster_fan',
    )
    // fireEvent, not user-event for the copy click: user-event installs its
    // own clipboard stub, which would intercept the write and hide it from
    // our spy (see CopyLinkButton.test).
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    fireEvent.click(screen.getByRole('button', { name: /copy/i }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/@coaster_fan`)
    })
  })

  it('unfurls profile-settings instructions when the list is not public', async () => {
    const user = userEvent.setup()
    renderBanner({ publicList: false })
    await user.click(screen.getByRole('button', { name: /^yes$/i }))
    expect(screen.getByRole('link', { name: /profile settings/i })).toHaveAttribute(
      'href',
      '/me/profile',
    )
    expect(screen.getByText(/riders\/coaster_fan/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
  })

  it('unfurls claim instructions when no username is set', async () => {
    const user = userEvent.setup()
    renderBanner({ username: null, displayName: 'Ana' })
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.queryByText('@coaster_fan')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^yes$/i }))
    expect(screen.getByText(/claim a username/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /profile settings/i })).toHaveAttribute(
      'href',
      '/me/profile',
    )
  })

  it('fires onDismiss from NOT RIGHT NOW', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderBanner()
    await user.click(screen.getByRole('button', { name: /not right now/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
