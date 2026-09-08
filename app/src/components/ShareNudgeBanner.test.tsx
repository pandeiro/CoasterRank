import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
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
  it('leads with the want-to-share eyebrow', () => {
    renderBanner()
    expect(screen.getByText('Want to share your board?')).toBeInTheDocument()
  })

  it('previews the mini card with pills, top-3 table, and the copyable url inside', () => {
    renderBanner()
    expect(screen.getByText('@coaster_fan')).toBeInTheDocument()
    expect(screen.getByText('9 ranked')).toBeInTheDocument()
    expect(screen.getByText('5 parks')).toBeInTheDocument()
    expect(screen.getByText(/top 3/i)).toBeInTheDocument()
    expect(screen.getByText('Steel Vengeance')).toBeInTheDocument()
    expect(screen.getByText('Cedar Point')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#3')).toBeInTheDocument()
    // Displayed without the protocol; the copy button still gets the full URL.
    expect(
      screen.getByText(`${window.location.origin.replace(/^https?:\/\//, '')}/riders/coaster_fan`),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /preview/i })).toHaveAttribute(
      'href',
      '/riders/coaster_fan',
    )
  })

  it('prefers the display name when one is set', () => {
    renderBanner({ displayName: 'Ana' })
    expect(screen.getByText('Ana')).toBeInTheDocument()
    expect(screen.queryByText('coaster_fan')).not.toBeInTheDocument()
  })

  it('hides the top-3 table when nothing is ranked', () => {
    renderBanner({ topThree: [] })
    expect(screen.queryByText(/top 3/i)).not.toBeInTheDocument()
  })

  it('asks to turn on sharing when the list is not public', () => {
    renderBanner({ publicList: false })
    expect(screen.getByRole('link', { name: /turn on sharing/i })).toHaveAttribute(
      'href',
      '/me/profile',
    )
    expect(screen.queryByRole('button', { name: /copy/i })).not.toBeInTheDocument()
  })

  it('asks to claim a username when none is set', () => {
    renderBanner({ username: null })
    expect(screen.getByText(/claim a username/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /claim your username/i })).toHaveAttribute(
      'href',
      '/me/profile',
    )
  })

  it('fires onDismiss from the dismiss button', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderBanner()
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
