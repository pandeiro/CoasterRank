import { useEffect, useRef, useState } from 'react'
import type { RankingRow } from '../lib/board-types'
import { asFiniteNumber, prefersReducedMotion } from '../lib/rankMovement'

// Raw BT strengths hover in a ±3% band around the 1.0 anchor (field average),
// so they are displayed on an index scale — 100 = community average. One
// decimal is enough to separate adjacent ranks without implying precision.
function formatScore(score: number): string {
  return (score * 100).toFixed(1)
}

const TICK_DURATION_MS = 600

// The board's score pill. Ticks between displayed values when a recompute
// actually moves the 1-dp index score (rare by construction — most recomputes
// don't shift a compressed score past its rounding — so the tick reads as a
// detail, not a strobe). Reduced motion / no rAF → snaps straight to the value.
// asFiniteNumber: a stale payload with a missing score must render nothing,
// never "NaN" (deploy-skew defense, like the weekly badge).
export default function ScorePill({ row }: { row: RankingRow }) {
  const score = asFiniteNumber(row.score)
  const target = score === null ? null : formatScore(score)
  const [display, setDisplay] = useState<string | null>(target)
  const fromRef = useRef<number | null>(null)

  useEffect(() => {
    if (target === null) {
      setDisplay(null)
      return
    }
    const to = Number(target)
    const from = fromRef.current
    if (
      from === null ||
      from === to ||
      prefersReducedMotion() ||
      typeof requestAnimationFrame !== 'function'
    ) {
      setDisplay(target)
      return
    }
    let raf = 0
    const start = performance.now()
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / TICK_DURATION_MS)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay((from + (to - from) * eased).toFixed(1))
      if (t < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target])

  // The next tick starts from whatever is on screen now.
  useEffect(() => {
    if (display !== null) fromRef.current = Number(display)
  }, [display])

  if (target === null) return null
  return (
    <span className="inline-block rounded-md bg-accent/5 px-2 py-1 text-xs tabular-nums text-ink">
      {display ?? target}
    </span>
  )
}
