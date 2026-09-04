import { Link, useNavigate } from 'react-router-dom'
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

// Enthusiast-standard abbreviations, applied only when the full name would
// otherwise truncate; the full name stays available via the title attribute.
const MANUFACTURER_ABBREVIATIONS: Record<string, string> = {
  'Bolliger & Mabillard': 'B&M',
  'Rocky Mountain Construction': 'RMC',
}

// Quiet hierarchy for the podium: a slightly stronger tint for #1, a fainter
// one for #2–3. Neutral surface color only — accents are never assigned to
// rank positions.
function rankTint(position: number | null): string {
  if (position === 1) return 'bg-surface/70'
  if (position === 2 || position === 3) return 'bg-surface/35'
  return ''
}

// Raw BT strengths hover in a ±3% band around the 1.0 anchor (field average),
// so they are displayed on an index scale — 100 = community average. One
// decimal is enough to separate adjacent ranks without implying precision.
function formatScore(score: number): string {
  return (score * 100).toFixed(1)
}

type Props = {
  rows: RankingRow[]
  showPark?: boolean
  /** Ids whose row shows the first-place pill (see firstPlaceVisibleIds). */
  firstPlaceIds?: Set<string>
  /** 'board' swaps Material for Manufacturer + Country (home page table). */
  variant?: 'default' | 'board'
}

export default function CoasterTable({
  rows,
  showPark = true,
  firstPlaceIds = new Set(),
  variant = 'default',
}: Props) {
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const navigate = useNavigate()

  if (rows.length === 0) {
    return <MessageState>No coasters match those filters.</MessageState>
  }

  // Whole rows navigate to the coaster detail page; the inline coaster and
  // park links keep their own targets by stopping propagation.
  const keepLinkTarget = (e: React.MouseEvent) => e.stopPropagation()

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
      <Link to={`/parks/${row.park_slug}`} onClick={keepLinkTarget} className="hover:underline">
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
            const firstPlace = firstPlaceIds.has(row.id)
              ? firstPlaceLabel(row.first_place_votes, row.participants)
              : null

            return (
              <li
                key={row.id}
                onClick={row.slug ? () => navigate(`/coasters/${row.slug}`) : undefined}
                className={`flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-canvas ${rankTint(position)}`}
              >
                <span className="w-9 shrink-0 self-center text-right">
                  {position === null ? (
                    <span className="text-base text-muted">—</span>
                  ) : (
                    <span className="display-heading text-lg text-muted/75">{position}</span>
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-h-6 flex-wrap items-center gap-x-2 gap-y-1">
                    <Link
                      to={`/coasters/${row.slug}`}
                      onClick={keepLinkTarget}
                      className="min-w-0 truncate font-semibold text-ink transition-colors ease-in hover:text-accent-dark"
                    >
                      {row.name}
                    </Link>
                    {badges(row, firstPlace)}
                    {row.score !== null && (
                      <span className="ml-auto shrink-0 pl-2 text-sm text-muted tabular-nums">
                        {formatScore(row.score)}
                      </span>
                    )}
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
              <th className="w-[4.5rem] px-4 py-3">
                <span className="sr-only">Rank</span>
              </th>
              <th className="px-4 py-3">Coaster</th>
              {showPark && <th className="w-[30%] px-4 py-3">Park</th>}
              {variant === 'board' ? (
                <>
                  <th className="hidden w-56 px-4 py-3 lg:table-cell">Manufacturer</th>
                  <th className="w-36 px-4 py-3">Country</th>
                  <th className="w-20 px-4 py-3 text-right">
                    <span
                      title="Bradley–Terry strength index from head-to-head rider comparisons; 100 is the community average"
                      className="cursor-help"
                    >
                      Score
                    </span>
                  </th>
                </>
              ) : (
                <th className="w-28 px-4 py-3">Material</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line/70">
            {rows.map((row, index) => {
              const position = positions[index]
              const firstPlace = firstPlaceIds.has(row.id)
                ? firstPlaceLabel(row.first_place_votes, row.participants)
                : null

              return (
                <tr
                  key={row.id}
                  onClick={row.slug ? () => navigate(`/coasters/${row.slug}`) : undefined}
                  className={`group cursor-pointer transition-colors hover:bg-canvas ${rankTint(position)}`}
                >
                  <td className="px-4 py-3">
                    {position === null ? (
                      <span className="text-sm text-muted">—</span>
                    ) : (
                      <span className="display-heading text-xl leading-none text-muted/75">
                        {position}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex min-h-6 items-center gap-2">
                      <Link
                        to={`/coasters/${row.slug}`}
                        onClick={keepLinkTarget}
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
                  {variant === 'board' ? (
                    <>
                      <td className="hidden px-4 py-3 text-muted lg:table-cell">
                        {row.manufacturer_name ? (
                          <div className="truncate" title={row.manufacturer_name}>
                            {MANUFACTURER_ABBREVIATIONS[row.manufacturer_name] ??
                              row.manufacturer_name}
                          </div>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        <div className="truncate">{row.park_country ?? '—'}</div>
                      </td>
                      <td className="px-4 py-3 text-right text-muted tabular-nums">
                        {row.score === null ? '—' : formatScore(row.score)}
                      </td>
                    </>
                  ) : (
                    <td className="px-4 py-3 capitalize text-muted">{capitalize(row.material)}</td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
