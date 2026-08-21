import { Link } from 'react-router-dom'
import {
  capitalize,
  formatNumber,
  formatScore,
  isFewVotes,
  type Park,
  type RankingRow,
} from '../lib/coasters'
import FewVotesBadge from './FewVotesBadge'
import { MessageState, Panel } from './ui'

type Props = {
  rows: RankingRow[]
  showPark?: boolean
  parks?: Map<string, Park>
}

export default function CoasterTable({ rows, showPark = true, parks = new Map() }: Props) {
  if (rows.length === 0) {
    return <MessageState>No coasters match those filters.</MessageState>
  }

  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-[700px] w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
              <th className="w-20 px-4 py-3">Rank</th>
              <th className="px-4 py-3">Coaster</th>
              {showPark && <th className="px-4 py-3">Park</th>}
              <th className="px-4 py-3">Material</th>
              <th className="px-4 py-3 text-right">Score</th>
              <th className="px-4 py-3 text-right">Comparisons</th>
              <th className="px-4 py-3 text-right">Participants</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {rows.map((row) => {
              const park = parks.get(row.park_id)
              return (
                <tr key={row.id} className="group transition-colors hover:bg-canvas">
                  <td
                    className={`display-heading px-4 py-3 text-2xl ${
                      row.rank <= 3 ? 'text-coral' : 'text-muted'
                    }`}
                  >
                    {row.rank}
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
                      {park ? (
                        <Link to={`/parks/${park.slug}`} className="hover:underline">
                          {park.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 capitalize text-muted">{capitalize(row.material)}</td>
                  <td className="px-4 py-3 text-right font-mono text-ink">
                    {row.score === null ? '—' : formatScore(row.score)}
                  </td>
                  <td className="px-4 py-3 text-right text-muted">
                    {row.comparisons === null ? '—' : formatNumber(row.comparisons)}
                  </td>
                  <td className="px-4 py-3 text-right text-muted">
                    {row.participants === null ? '—' : formatNumber(row.participants)}
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
