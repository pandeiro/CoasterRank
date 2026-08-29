import { Link } from 'react-router-dom'
import { capitalize, firstPlaceLabel, isFewVotes, type RankingRow } from '../lib/coasters'
import FewVotesBadge from './FewVotesBadge'
import { MessageState, Panel } from './ui'

type Props = {
  rows: RankingRow[]
  showPark?: boolean
  /** Ids whose "#1 votes" cell shows data (see firstPlaceVisibleIds). */
  firstPlaceIds?: Set<string>
}

export default function CoasterTable({ rows, showPark = true, firstPlaceIds = new Set() }: Props) {
  if (rows.length === 0) {
    return <MessageState>No coasters match those filters.</MessageState>
  }

  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-[640px] w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              <th className="w-20 px-4 py-3">Rank</th>
              <th className="px-4 py-3">Coaster</th>
              {showPark && <th className="px-4 py-3">Park</th>}
              <th className="px-4 py-3">Material</th>
              <th
                className="px-4 py-3 text-right"
                title="First-place votes, with the share of riders who ranked it #1. Shown for the top 10 coasters once 30+ rankings are in."
              >
                #1 votes
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {rows.map((row) => {
              const isTopRank = row.rank !== null && row.rank <= 3
              const rankLabel = row.rank === null ? '—' : row.rank
              const firstPlace = firstPlaceIds.has(row.id)
                ? firstPlaceLabel(row.first_place_votes, row.participants)
                : null

              return (
                <tr key={row.id} className="group transition-colors hover:bg-canvas">
                  <td
                    className={`display-heading px-4 py-3 text-2xl ${
                      isTopRank ? 'text-coral' : 'text-muted'
                    }`}
                  >
                    {rankLabel}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      to={`/coasters/${row.slug}`}
                      className="font-semibold text-ink decoration-accent-strong decoration-2 underline-offset-4 hover:underline"
                    >
                      {row.name}
                    </Link>
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
                  <td className="px-4 py-3 text-right font-mono text-ink">
                    {firstPlace ? `${firstPlace.votes} (${firstPlace.pct}%)` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
