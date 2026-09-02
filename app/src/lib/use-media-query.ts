import { useEffect, useState } from 'react'

// Non-reactive coarse-pointer check. Defaults to FALSE when matchMedia is
// unavailable (jsdom) so callers keep their desktop flow in tests — the
// opposite default of useMediaQuery, which exists for desktop layouts.
export function isCoarsePointer(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  )
}

// Reactive CSS-media-query hook. Falls back to `true` when matchMedia is
// unavailable (e.g. jsdom) so callers render their desktop layout in tests.
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : true,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mql = window.matchMedia(query)
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
