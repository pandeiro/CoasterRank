import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import Toast from './Toast'

describe('Toast', () => {
  it('renders an action button and fires it once, then dismisses', () => {
    vi.useFakeTimers()
    try {
      const onAction = vi.fn()
      const onDismiss = vi.fn()
      render(
        <Toast
          message="Removed Alpha"
          onDismiss={onDismiss}
          durationMs={5000}
          action={{ label: 'Undo', onClick: onAction }}
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
      expect(onAction).toHaveBeenCalledTimes(1)
      // The toast fades out before calling onDismiss.
      vi.advanceTimersByTime(300)
      expect(onDismiss).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('auto-dismisses without an action', () => {
    vi.useFakeTimers()
    try {
      const onDismiss = vi.fn()
      render(<Toast message="Added X at #1" onDismiss={onDismiss} durationMs={3000} />)
      expect(screen.queryByRole('button')).not.toBeInTheDocument()
      vi.advanceTimersByTime(3400)
      expect(onDismiss).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
