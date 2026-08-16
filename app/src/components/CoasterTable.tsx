import { Link } from 'react-router-dom'
import { capitalize, formatNumber, formatScore, isFewVotes, type RankingRow } from '../lib/coasters'
import FewVotesBadge from './FewVotesBadge'

type Props = {
  rows: RankingRow[]
  showPark?: boolean
}

export default function CoasterTable({ rows, showPark = true }: Props) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-slate-500">No coasters match those filters.</p>
  }

  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
            <th className="px-4 py-3">#</th>
            <th className="px-4 py-3">Coaster</th>
            {showPark && <th className="px-4 py-3">Park</th>}
            <th className="px-4 py-3">Material</th>
            <th className="px-4 py-3 text-right">Score</th>
            <th className="px-4 py-3 text-right">Comparisons</th>
            <th className="hidden px-4 py-3 text-right sm:table-cell">Participants</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-slate-500">{row.rank}</td>
              <td className="px-4 py-3">
                <Link
                  to={`/coasters/${row.slug}`}
                  className="font-medium text-slate-900 hover:underline"
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
                <td className="px-4 py-3 text-slate-600">
                  <Link to={`/parks/${row.park_slug}`} className="hover:underline">
                    {row.park_name}
                  </Link>
                </td>
              )}
              <td className="px-4 py-3 capitalize text-slate-600">{capitalize(row.material)}</td>
              <td className="px-4 py-3 text-right font-mono text-slate-900">
                {row.score === null ? '—' : formatScore(row.score)}
              </td>
              <td className="px-4 py-3 text-right text-slate-600">
                {row.comparisons === null ? '—' : formatNumber(row.comparisons)}
              </td>
              <td className="hidden px-4 py-3 text-right text-slate-600 sm:table-cell">
                {row.participants === null ? '—' : formatNumber(row.participants)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
