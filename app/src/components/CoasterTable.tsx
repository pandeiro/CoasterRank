import { Link } from 'react-router-dom'
import {
  capitalize,
  firstPlaceLabel,
  isFewVotes,
  type CoasterStatus,
  type RankingRow,
} from '../lib/coasters'
import { useMediaQuery } from '../lib/use-media-query'
import FewVotesBadge from './FewVotesBadge'
import { Badge, MessageState, Panel } from './ui'

// Non-operating rows carry a status pill: SBNO verbatim (accent), every other
// non-operating status collapsed to "Historic" (neutral).
function statusPill(status: CoasterStatus): { label: string; tone: 'accent' | 'neutral' } | null {
  if (status === 'operating') return null
  return status === 'sbno'
    ? { label: 'SBNO', tone: 'accent' }
    : { label: 'Historic', tone: 'neutral' }
}

type Props = {
  rows: RankingRow[]
  showPark?: boolean
  /** Ids whose row shows the first-place pill (see firstPlaceVisibleIds). */
  firstPlaceIds?: Set<string>
}

export default function CoasterTable({ rows, showPark = true, firstPlaceIds = new Set() }: Props) {
  const isDesktop = useMediaQuery('(min-width: 640px)')

  if (rows.length === 0) {
    return <MessageState>No coasters match those filters.</MessageState>
  }

  // Gapless display numbering over the rows as given (already ordered by the
  // caller): rated rows count up 1, 2, 3…; unrated rows show a dash. Unlike
  // the view's global rank, this stays sequential no matter which filters
  // hide rows in between.
  const positions: Array<number | null> = []
  let rated = 0
  for (const row of rows) positions.push(row.rank === null ? null : ++rated)

  function parkCell(row: RankingRow) {
    if (!showPark) return null
    return row.park_name && row.park_slug ? (
      <Link to={`/parks/${row.park_slug}`} className="hover:underline">
        {row.park_name}
      </Link>
    ) : (
      '—'
    )
  }

  function badges(row: RankingRow, firstPlace: { votes: number; pct: number } | null) {
    const pill = statusPill(row.status)
    return (
      <>
        {pill && (
          <span className="shrink-0">
            <Badge tone={pill.tone}>{pill.label}</Badge>
          </span>
        )}
        {firstPlace && (
          <span className="shrink-0">
            <Badge
              tone="coral"
              title="First-place votes, with the share of riders who ranked it #1. Shown for the top 10 coasters once 30+ rankings are in."
            >
              {`${firstPlace.votes} (${firstPlace.pct}%)`}
            </Badge>
          </span>
        )}
        {isFewVotes(row.comparisons) && (
          <span className="shrink-0">
            <FewVotesBadge comparisons={row.comparisons} />
          </span>
        )}
      </>
    )
  }

  if (!isDesktop) {
    return (
      <Panel className="overflow-hidden">
        <ul className="divide-y divide-line/70">
          {rows.map((row, index) => {
            const position = positions[index]
            const rankLabel = position === null ? '—' : position
            const firstPlace = firstPlaceIds.has(row.id)
              ? firstPlaceLabel(row.first_place_votes, row.participants)
              : null

            return (
              <li key={row.id} className="flex gap-3 px-4 py-3">
                <span className="w-8 shrink-0 self-center text-right text-base text-muted tabular-nums">
                  {rankLabel}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      to={`/coasters/${row.slug}`}
                      className="min-w-0 truncate font-semibold text-ink transition-colors ease-in hover:text-accent-dark"
                    >
                      {row.name}
                    </Link>
                    {badges(row, firstPlace)}
                  </div>
                  {showPark && row.park_name && row.park_slug && (
                    <div className="mt-0.5 min-w-0 truncate text-sm text-muted">
                      {parkCell(row)}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      </Panel>
    )
  }

  // Desktop table: fixed layout — column widths come from the header cells,
  // so filtering can never resize columns and shift the layout. Long names
  // truncate instead.
  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              <th className="w-14 px-4 py-3">
                <span className="sr-only">Rank</span>
              </th>
              <th className="px-4 py-3">Coaster</th>
              {showPark && <th className="w-[38%] px-4 py-3">Park</th>}
              <th className="w-28 px-4 py-3">Material</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {rows.map((row, index) => {
              const position = positions[index]
              const rankLabel = position === null ? '—' : position
              const firstPlace = firstPlaceIds.has(row.id)
                ? firstPlaceLabel(row.first_place_votes, row.participants)
                : null

              return (
                <tr key={row.id} className="group transition-colors hover:bg-canvas">
                  <td className="px-4 py-3 text-muted tabular-nums">{rankLabel}</td>
                  <td className="px-4 py-3">
                    <div className="flex min-h-6 items-center gap-2">
                      <Link
                        to={`/coasters/${row.slug}`}
                        className="min-w-0 truncate font-semibold text-ink transition-colors ease-in hover:text-accent-dark"
                      >
                        {row.name}
                      </Link>
                      {badges(row, firstPlace)}
                    </div>
                  </td>
                  {showPark && (
                    <td className="px-4 py-3 text-muted">
                      <div className="truncate">{parkCell(row)}</div>
                    </td>
                  )}
                  <td className="px-4 py-3 capitalize text-muted">{capitalize(row.material)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
