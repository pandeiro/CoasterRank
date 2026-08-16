import { useEffect, useRef } from 'react'

type Props = {
  onLoadMore: () => void
  enabled: boolean
}

// Sentinel div at the bottom of an infinite-scroll list. When it scrolls into
// view, onLoadMore fires. Renders nothing while disabled.
export default function ScrollSentinel({ onLoadMore, enabled }: Props) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!enabled) return
    const node = ref.current
    if (!node) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onLoadMore()
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [enabled, onLoadMore])

  if (!enabled) return null
  return <div ref={ref} aria-hidden="true" />
}
