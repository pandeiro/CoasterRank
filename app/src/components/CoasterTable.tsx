import { Link } from 'react-router-dom'
import { capitalize, firstPlaceLabel, isFewVotes, type RankingRow } from '../lib/coasters'
import FewVotesBadge from './FewVotesBadge'
import { Badge, MessageState, Panel } from './ui'

type Props = {
  rows: RankingRow[]
  showPark?: boolean
  /** Ids whose row shows the first-place pill (see firstPlaceVisibleIds). */
  firstPlaceIds?: Set<string>
}

export default function CoasterTable({ rows, showPark = true, firstPlaceIds = new Set() }: Props) {
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

  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-[640px] w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              <th className="w-14 px-4 py-3">Rank</th>
              <th className="px-4 py-3">Coaster</th>
              {showPark && <th className="px-4 py-3">Park</th>}
              <th className="px-4 py-3">Material</th>
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
                    <Link
                      to={`/coasters/${row.slug}`}
                      className="font-semibold text-ink decoration-accent-strong decoration-2 underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
                    {firstPlace && (
                      <span className="ml-2">
                        <Badge
                          tone="coral"
                          title="First-place votes, with the share of riders who ranked it #1. Shown for the top 10 coasters once 30+ rankings are in."
                        >
                          {`${firstPlace.votes} (${firstPlace.pct}%)`}
                        </Badge>
                      </span>
                    )}
                    {isFewVotes(row.comparisons) && (
                      <span className="ml-2">
                        <FewVotesBadge comparisons={row.comparisons} />
                      </span>
                    )}
                  </td>
                  {showPark && (
                    <td className="px-4 py-3 text-muted">
                      {row.park_name && row.park_slug ? (
                        <Link to={`/parks/${row.park_slug}`} className="hover:underline">
                          {row.park_name}
                        </Link>
                      ) : (
                        '—'
                      )}
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
