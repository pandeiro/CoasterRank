import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import LiveStatusPopunder from './LiveStatusPopunder'
import * as rankingScheduleModule from '../lib/rankingSchedule'

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

// userEvent.click() synthesizes the full hover sequence (mouseenter → … →
// click), which is exactly the desktop interaction the popunder has to
// reconcile: hover shows it, click pins it, a further click unpins.
describe('LiveStatusPopunder', () => {
  it('shows the last-changed age on click and closes on Escape', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <LiveStatusPopunder lastRankedAt={new Date(Date.now() - 8 * 60_000).toISOString()} />,
    )
    const trigger = screen.getByRole('button', { name: 'Live' })
    await user.click(trigger)
    expect(screen.getByText(/Last changed 8 minutes ago/)).toBeInTheDocument()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    await user.keyboard('{Escape}')
    expect(screen.queryByText(/Last changed/)).not.toBeInTheDocument()
  })

  it('stays open when hover ends after a click (click pins)', () => {
    renderWithClient(
      <LiveStatusPopunder lastRankedAt={new Date(Date.now() - 60_000).toISOString()} />,
    )
    const trigger = screen.getByRole('button', { name: 'Live' })
    fireEvent.mouseOver(trigger)
    fireEvent.click(trigger)
    fireEvent.mouseOut(trigger)
    expect(screen.getByText(/Last changed/)).toBeInTheDocument()
  })

  it('toggles closed on a second tap without hover (mobile pin flow)', () => {
    renderWithClient(
      <LiveStatusPopunder lastRankedAt={new Date(Date.now() - 3_600_000).toISOString()} />,
    )
    const trigger = screen.getByRole('button', { name: 'Live' })
    fireEvent.click(trigger)
    expect(screen.getByText(/Last changed/)).toBeInTheDocument()
    fireEvent.click(trigger)
    expect(screen.queryByText(/Last changed/)).not.toBeInTheDocument()
  })

  it('dismisses on outside pointer down', async () => {
    const user = userEvent.setup()
    renderWithClient(
      <LiveStatusPopunder lastRankedAt={new Date(Date.now() - 60_000).toISOString()} />,
    )
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText(/Last changed/)).toBeInTheDocument()
    await user.pointer({ coords: { x: 0, y: 0 }, keys: '[MouseLeft>]', target: document.body })
    expect(screen.queryByText(/Last changed/)).not.toBeInTheDocument()
  })

  it('shows a muted fallback when the timestamp is missing or invalid', async () => {
    const user = userEvent.setup()
    const { unmount } = renderWithClient(<LiveStatusPopunder lastRankedAt={null} />)
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText('Last changed time unavailable')).toBeInTheDocument()
    unmount()

    renderWithClient(<LiveStatusPopunder lastRankedAt="not-a-date" />)
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText('Last changed time unavailable')).toBeInTheDocument()
  })

  it('keeps ticking the label without refetching', async () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    vi.setSystemTime(new Date('2026-09-05T12:00:00Z'))
    try {
      // 50s old → "just now"; after 31s tick → 81s → crosses the minute.
      renderWithClient(<LiveStatusPopunder lastRankedAt="2026-09-05T11:59:10Z" />)
      const trigger = screen.getByRole('button', { name: 'Live' })
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

  it('estimates the next refit from the clock fallback when schedule data is absent', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    try {
      vi.setSystemTime(new Date('2026-09-05T12:02:00Z'))
      renderWithClient(<LiveStatusPopunder lastRankedAt="2026-09-05T11:58:00Z" />)
      const trigger = screen.getByRole('button', { name: 'Live' })
      fireEvent.mouseOver(trigger)
      expect(screen.getByText(/Next refit in ~3 min/)).toBeInTheDocument()
      expect(screen.getByText(/every 5 min/)).toBeInTheDocument()

      act(() => {
        vi.advanceTimersByTime(121_000)
      })
      expect(screen.getByText(/Next refit within a minute/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('switches the next-refit line to change-triggered wording once the anchor goes stale', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    try {
      vi.setSystemTime(new Date('2026-09-05T12:20:00Z'))
      renderWithClient(<LiveStatusPopunder lastRankedAt="2026-09-05T12:00:00Z" />)
      fireEvent.mouseOver(screen.getByRole('button', { name: 'Live' }))
      expect(screen.getByText(/Next refit when rankings change/)).toBeInTheDocument()
      expect(screen.queryByText(/in ~\d+ min/)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the countdown while the last-changed anchor is fresh', () => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    })
    try {
      vi.setSystemTime(new Date('2026-09-05T12:02:00Z'))
      renderWithClient(<LiveStatusPopunder lastRankedAt="2026-09-05T12:00:00Z" />)
      fireEvent.mouseOver(screen.getByRole('button', { name: 'Live' }))
      expect(screen.getByText(/Next refit in ~3 min \(every 5 min\)/)).toBeInTheDocument()
      act(() => {
        vi.advanceTimersByTime(121_000)
      })
      expect(screen.getByText(/Next refit within a minute/)).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the next-refit estimate even without a last-changed timestamp', async () => {
    const user = userEvent.setup()
    renderWithClient(<LiveStatusPopunder lastRankedAt={null} />)
    await user.click(screen.getByRole('button', { name: 'Live' }))
    expect(screen.getByText('Last changed time unavailable')).toBeInTheDocument()
    expect(screen.getByText(/Next refit/)).toBeInTheDocument()
  })

  describe('schedule countdown integration', () => {
    it('shows tiny relative time countdown and shows "now" when countdown is exhausted', () => {
      vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
      })
      try {
        const startTime = new Date('2026-09-19T01:58:00Z')
        vi.setSystemTime(startTime)

        vi.spyOn(rankingScheduleModule, 'useRankingSchedule').mockReturnValue({
          data: {
            schedule: '*/5 * * * *',
            active: true,
            cadence_ms: 300000,
            next_run: '2026-09-19T02:00:00Z',
            next_runs: ['2026-09-19T02:00:00Z', '2026-09-19T02:05:00Z'],
          },
          isLoading: false,
          isError: false,
        } as never)

        renderWithClient(<LiveStatusPopunder lastRankedAt="2026-09-19T01:55:00Z" />)
        const trigger = screen.getByRole('button', { name: 'Live' })
        fireEvent.mouseOver(trigger)

        // At 01:58:00, 2 minutes remaining
        expect(screen.getByText('Next refit in 2m 0s')).toBeInTheDocument()

        // Advance 45 seconds -> 1m 15s remaining
        act(() => {
          vi.advanceTimersByTime(45_000)
        })
        expect(screen.getByText('Next refit in 1m 15s')).toBeInTheDocument()

        // Advance into last minute -> 30s remaining
        act(() => {
          vi.advanceTimersByTime(45_000)
        })
        expect(screen.getByText('Next refit in 30s')).toBeInTheDocument()

        // Advance until scheduled run occurs -> countdown exhausted -> shows "now"
        act(() => {
          vi.advanceTimersByTime(30_000)
        })
        expect(screen.getByText('Next refit now')).toBeInTheDocument()
      } finally {
        vi.restoreAllMocks()
        vi.useRealTimers()
      }
    })
  })
})
