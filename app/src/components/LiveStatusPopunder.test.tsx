import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import LiveStatusPopunder from './LiveStatusPopunder'

// userEvent.click() synthesizes the full hover sequence (mouseenter → … →
// click), which is exactly the desktop interaction the popunder has to
// reconcile: hover shows it, click pins it, a further click unpins.
describe('LiveStatusPopunder', () => {
  it('shows the last-ranked age on click and closes on Escape', async () => {
    const user = userEvent.setup()
    render(<LiveStatusPopunder lastRankedAt={new Date(Date.now() - 8 * 60_000).toISOString()} />)
    const trigger = screen.getByRole('button', { name: 'Live' })
    await user.click(trigger)
    expect(screen.getByText(/Last ranked 8 minutes ago/)).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    expect(screen.queryByText(/Last ranked/)).not.toBeInTheDocument()
  })

  it('stays open when hover ends after a click (click pins)', () => {
    render(<LiveStatusPopunder lastRankedAt={new Date(Date.now() - 60_000).toISOString()} />)
    const trigger = screen.getByRole('button', { name: 'Live' })
    fireEvent.mouseOver(trigger)
    fireEvent.click(trigger)
    fireEvent.mouseOut(trigger)
    expect(screen.getByText(/Last ranked/)).toBeInTheDocument()
  })

  it('toggles closed on a second tap without hover (mobile pin flow)', () => {
    // jsdom has no pointer-type distinction: hover and click fire identically
    // for userEvent, so the touch flow is exercised with plain clicks (no
    // synthetic hover) — pin open, then pin closed.
    render(<LiveStatusPopunder lastRankedAt={new Date(Date.now() - 3_600_000).toISOString()} />)
    const trigger = screen.getByRole('button', { name: 'Live' })
    fireEvent.click(trigger)
    expect(screen.getByText(/Last ranked/)).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByText(/Last ranked/)).not.toBeInTheDocument()
  })

  it('dismisses on outside pointer down', async () => {
    const user = userEvent.setup()
    render(<LiveStatusPopunder lastRankedAt={new Date(Date.now() - 60_000).toISOString()} />)
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText(/Last ranked/)).toBeInTheDocument()
    await user.pointer({ coords: { x: 0, y: 0 }, keys: '[MouseLeft>]', target: document.body })
    expect(screen.queryByText(/Last ranked/)).not.toBeInTheDocument()
  })

  it('shows a muted fallback when the timestamp is missing or invalid', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<LiveStatusPopunder lastRankedAt={null} />)
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText('Last ranked time unavailable')).toBeInTheDocument()
    unmount()

    render(<LiveStatusPopunder lastRankedAt="not-a-date" />)
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText('Last ranked time unavailable')).toBeInTheDocument()
  })

  it('keeps ticking the label without refetching', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))
    try {
      // 50s old → "just now"; after the 30s tick → 81s → crosses the minute.
      render(<LiveStatusPopunder lastRankedAt="2026-09-05T11:59:10Z" />)
      const trigger = screen.getByRole('button', { name: 'Live' })
      // React derives onMouseEnter from delegated mouseover events.
      fireEvent.mouseOver(trigger)
      expect(screen.getByText(/just now/)).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(31_000)
      })
      expect(screen.getByText(/1 minute ago/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
