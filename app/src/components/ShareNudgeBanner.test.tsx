import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ShareNudgeBanner from './ShareNudgeBanner'

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
        topPick="Steel Vengeance"
        onDismiss={onDismiss}
        {...props}
      />
    </MemoryRouter>,
  )
  return { onDismiss }
}

describe('ShareNudgeBanner', () => {
  it('previews the flat share card with copy and preview when live', () => {
    renderBanner()
    expect(screen.getByText('@coaster_fan · 9 ranked · #1 Steel Vengeance')).toBeInTheDocument()
    expect(screen.getByText(`${window.location.origin}/riders/coaster_fan`)).toBeInTheDocument()
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
