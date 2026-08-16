import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import ScrollSentinel from './ScrollSentinel'

type ObserverEntry = { isIntersecting: boolean }
type ObserverCallback = (entries: ObserverEntry[]) => void

let observeCallback: ObserverCallback | null = null

class MockIntersectionObserver {
  constructor(callback: ObserverCallback) {
    observeCallback = callback
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)

describe('ScrollSentinel', () => {
  beforeEach(() => {
    observeCallback = null
  })

  it('calls onLoadMore when it scrolls into view', () => {
    const onLoadMore = vi.fn()
    render(<ScrollSentinel onLoadMore={onLoadMore} enabled />)
    observeCallback?.([{ isIntersecting: true }])
    expect(onLoadMore).toHaveBeenCalledTimes(1)
  })

  it('does not fire for non-intersecting entries', () => {
    const onLoadMore = vi.fn()
    render(<ScrollSentinel onLoadMore={onLoadMore} enabled />)
    observeCallback?.([{ isIntersecting: false }])
    expect(onLoadMore).not.toHaveBeenCalled()
  })

  it('renders nothing and does not observe while disabled', () => {
    const onLoadMore = vi.fn()
    const { container } = render(<ScrollSentinel onLoadMore={onLoadMore} enabled={false} />)
    expect(container.firstChild).toBeNull()
    expect(observeCallback).toBeNull()
  })
})
