import type { RankingRow } from '../lib/board-types'
import { weekDelta } from '../lib/rankMovement'

// The persistent weekly rank-delta badge (PLAN §11): `↑2` / `↓1` pinned to the
// score pill's corner. Shows on every page load — it is the stable counterpart
// to the ephemeral live-movement chips. Hidden when there is no baseline
// (first week of the feature, coaster newly ranked this week) or no change,
// which is most rows — BT scores move glacially, so silence is correct.
export default function WeeklyDeltaBadge({ row }: { row: RankingRow }) {
  const delta = weekDelta(row)
  if (delta === null || delta === 0) return null

  const up = delta > 0
  const places = Math.abs(delta)
  const label = up
    ? `Up ${places} place${places === 1 ? '' : 's'} this week`
    : `Down ${places} place${places === 1 ? '' : 's'} this week`

  return (
    <span
      title={label}
      className={`absolute -right-1.5 -top-1.5 z-10 inline-flex items-center rounded-full px-1.5 py-px text-[10px] font-semibold leading-none shadow-[0_1px_2px_rgb(26_26_46_/_0.18)] ${
        up
          ? 'bg-success/15 tabular-nums text-success-text'
          : 'bg-danger/10 tabular-nums text-danger-text'
      }`}
    >
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">
        {up ? '↑' : '↓'}
        {places}
      </span>
    </span>
  )
}
