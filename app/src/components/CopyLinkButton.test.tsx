import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { CopyLinkButton } from './CopyLinkButton'

describe('CopyLinkButton', () => {
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

  it('copies the url and confirms', async () => {
    // fireEvent, not user-event: user-event installs its own clipboard stub,
    // which would intercept the write and hide it from our spy.
    render(<CopyLinkButton url="https://example.com/riders/ana" />)
    fireEvent.click(screen.getByRole('button', { name: /copy link/i }))
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://example.com/riders/ana')
    })
    expect(await screen.findByText('Copied!')).toBeInTheDocument()
  })

  it('supports a custom label', () => {
    render(<CopyLinkButton url="https://example.com/riders/ana" label="Copy" />)
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })
})
