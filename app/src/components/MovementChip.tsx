import { prefersReducedMotion } from '../lib/rankMovement'

// The ephemeral live-movement chip (board turnover): `↑2` / `↓1` in the
// reserved gutter left of the row. Appears only after a live turnover that
// actually moved the row, then evaporates (CSS: ~10s hold + ~2s fade; the
// parent unmounts chips once lib/rankMovement.ts's linger timer fires).
// index drives a tiny stagger so a cascade of movers reads as one wave
// (capped so the tail rows can't outlive the linger window).
export default function MovementChip({ delta, index }: { delta: number; index: number }) {
  if (delta === 0) return null
  const up = delta > 0
  const reduced = prefersReducedMotion()
  return (
    <span
      aria-hidden="true"
      className={`inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold leading-none shadow-[0_1px_2px_rgb(26_26_46_/_0.18)] ${
        up
          ? 'bg-success/15 tabular-nums text-success-text'
          : 'bg-danger/10 tabular-nums text-danger-text'
      } ${reduced ? '' : 'animate-[movement-chip_12s_ease-out_both]'}`}
      style={reduced ? undefined : { animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      {up ? '↑' : '↓'}
      {Math.abs(delta)}
    </span>
  )
}
