import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ShareListCard from './ShareListCard'

function renderCard(props: Partial<Parameters<typeof ShareListCard>[0]> = {}) {
  const onDismiss = vi.fn()
  render(
    <MemoryRouter>
      <ShareListCard
        username="coaster_fan"
        publicList={true}
        rankedCount={5}
        milestone={1}
        onDismiss={onDismiss}
        {...props}
      />
    </MemoryRouter>,
  )
  return { onDismiss }
}

describe('ShareListCard', () => {
  const originalClipboard = navigator.clipboard
  const writeText = vi.fn<(text: string) => Promise<void>>()

  beforeEach(() => {
    writeText.mockClear().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    })
  })

  it('prompts to claim a username when none is set', () => {
    renderCard({ username: null })
    expect(screen.getByText(/claim a username/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /claim your username/i })).toHaveAttribute(
      'href',
      '/me/profile',
    )
  })

  it('prompts to turn on sharing when the list is not public', () => {
    renderCard({ username: 'coaster_fan', publicList: false })
    expect(screen.getByText(/turn on public sharing/i)).toBeInTheDocument()
    expect(screen.getByText('/riders/coaster_fan')).toBeInTheDocument()
  })

  it('offers copy, share-sheet, and preview when live', async () => {
    // fireEvent, not user-event: user-event installs its own clipboard stub,
    // which would intercept the write and hide it from our spy.
    renderCard({ username: 'coaster_fan', publicList: true })

    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/riders/coaster_fan`)
    })
    expect(await screen.findByText('Copied!')).toBeInTheDocument()

    const preview = screen.getByRole('link', { name: /preview/i })
    expect(preview).toHaveAttribute('href', '/riders/coaster_fan')
  })

  it('hides the native share button when unsupported', () => {
    const share = navigator.share
    // @ts-expect-error deleting a readonly-ish navigator property for the test
    delete navigator.share
    renderCard({ username: 'coaster_fan', publicList: true })
    expect(screen.queryByRole('button', { name: /share/i })).not.toBeInTheDocument()
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
  })

  it('fires onDismiss from the dismiss button', async () => {
    const user = userEvent.setup()
    const { onDismiss } = renderCard()
    await user.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
