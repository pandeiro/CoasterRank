import { Link, useNavigate } from 'react-router-dom'
import {
  capitalize,
  firstPlaceLabel,
  isFewVotes,
  type CoasterStatus,
  type RankingRow,
} from '../lib/coasters'
import { MANUFACTURER_ABBREVIATIONS } from '../lib/abbreviations'
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

// Podium hierarchy (§6.1, decided): muted coral — three DISTINCT shades so
// #1 > #2 > #3 reads as an intentional ramp (a merged 2/3 shade reads as a
// bug); #4+ white. Alternative palettes live on the design board.
function rowTint(position: number | null): string {
  if (position === 1) return 'bg-coral/[0.05] hover:bg-coral/[0.05]'
  if (position === 2) return 'bg-coral/[0.03] hover:bg-coral/[0.03]'
  if (position === 3) return 'bg-coral/[0.015] hover:bg-coral/[0.015]'
  return 'hover:bg-canvas'
}

// §5.2: one font tier down at ≥100, another at ≥1000, so 3–4 digit ranks
// stay inside the fixed column (and the 40px circle) without clipping.
// Exported for unit testing (the display numbering is gapless over the given
// rows, so ≥100 positions only occur deep in a real board).
export function rankFontClass(position: number): string {
  if (position >= 1000) return 'text-xs'
  if (position >= 100) return 'text-sm'
  return 'text-base'
}

// §5.1–5.3, decided: EVERY rank gets a white circle (slight dark ink drop
// shadow) around an accent-blue number in the display font, centered —
// across desktop and mobile. The fixed column right-aligns so circles share
// an edge (§5.1); the podium ramp comes from the row tint, not the badge.
function RankBadge({ position }: { position: number }) {
  return (
    <span
      className={`display-heading inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-center leading-none tabular-nums text-accent-strong shadow-[0_1px_2px_rgb(26_26_46_/_0.18)] ${rankFontClass(position)}`}
    >
      {position}
    </span>
  )
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
  /** 'board' swaps Material for Manufacturer (home page table). */
  variant?: 'default' | 'board'
}

export default function CoasterTable({
  rows,
  showPark = true,
  firstPlaceIds = new Set(),
  variant = 'default',
}: Props) {
  const navigate = useNavigate()

  if (rows.length === 0) {
    return <MessageState>No coasters match those filters.</MessageState>
  }

  // Whole rows navigate to the coaster detail page; the inline coaster and
  // park links keep their own targets by stopping propagation.
  const keepLinkTarget = (e: React.MouseEvent) => e.stopPropagation()

  // Global rank directly from the view (row.rank); unrated rows show a dash.
  // Filtering preserves BT score order, so visible gaps are intentional — the
  // board always reflects true global position, not a re-numbered filtered slice.
  const positions: Array<number | null> = rows.map((row) => row.rank)

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

  function mobileItems() {
    return rows.map((row, index) => {
      const position = positions[index]
      const firstPlace = firstPlaceIds.has(row.id)
        ? firstPlaceLabel(row.first_place_votes, row.participants)
        : null

      return (
        <li
          key={row.id}
          onClick={row.slug ? () => navigate(`/coasters/${row.slug}`) : undefined}
          className={`flex min-h-[52px] cursor-pointer items-center gap-2.5 px-4 py-2.5 transition-colors ${rowTint(position)}`}
        >
          <span className="w-10 shrink-0 self-center text-center">
            {position === null ? (
              <span className="text-base text-muted">—</span>
            ) : (
              <RankBadge position={position} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex min-h-6 items-center gap-x-2">
              <Link
                to={`/coasters/${row.slug}`}
                onClick={keepLinkTarget}
                className="min-w-0 truncate font-semibold text-ink transition-colors ease-in hover:text-accent-dark"
              >
                {row.name}
              </Link>
              {badges(row, firstPlace)}
            </div>
            {showPark && row.park_name && row.park_slug && (
              <div className="mt-0.5 min-w-0 truncate text-sm text-muted">{parkCell(row)}</div>
            )}
          </div>
          {/* §7.2: score centers vertically, matching the rank circle. */}
          {row.score !== null && (
            <span className="shrink-0 self-center rounded-md bg-accent/5 px-1.5 py-0.5 text-sm font-semibold tabular-nums text-ink">
              {formatScore(row.score)}
            </span>
          )}
        </li>
      )
    })
  }

  function desktopTable() {
    return (
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            <th className="w-[4.5rem] px-3 py-2.5 text-right">
              <span className="sr-only">Rank</span>
            </th>
            <th className="py-2.5 pl-3 pr-4">Coaster</th>
            {showPark && <th className="w-[30%] px-4 py-2.5">Park</th>}
            {variant === 'board' ? (
              <>
                <th className="hidden w-56 px-4 py-2.5 lg:table-cell">Manufacturer</th>
                <th className="w-20 px-4 py-2.5 text-right">
                  <span
                    title="Bradley–Terry strength index from head-to-head rider comparisons; 100 is the community average"
                    className="cursor-help"
                  >
                    Score
                  </span>
                </th>
              </>
            ) : (
              <th className="w-28 px-4 py-2.5">Material</th>
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
                className={`group cursor-pointer transition-colors ${rowTint(position)}`}
              >
                <td className="px-3 py-2.5 text-right">
                  {position === null ? (
                    <span className="text-sm text-muted">—</span>
                  ) : (
                    <RankBadge position={position} />
                  )}
                </td>
                {/* §4.3: fixed-width column + truncation — badges can never
                    reflow Park/Manufacturer (table-fixed + nowrap). */}
                <td className="py-2.5 pl-3 pr-4">
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
                  <td className="px-4 py-2.5 text-muted">
                    <div className="truncate">{parkCell(row)}</div>
                  </td>
                )}
                {variant === 'board' ? (
                  <>
                    <td className="hidden px-4 py-2.5 text-muted lg:table-cell">
                      {row.manufacturer_name ? (
                        <div className="truncate" title={row.manufacturer_name}>
                          {MANUFACTURER_ABBREVIATIONS[row.manufacturer_name] ??
                            row.manufacturer_name}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    {/* §7.1, decided: score emphasized by an accent-tinted
                        rounded background (still heavier tabular numerals). */}
                    <td className="px-4 py-2.5 text-right">
                      {row.score === null ? (
                        <span className="text-sm text-muted">—</span>
                      ) : (
                        <span className="inline-block rounded-md bg-accent/5 px-1.5 py-0.5 text-sm font-semibold tabular-nums text-ink">
                          {formatScore(row.score)}
                        </span>
                      )}
                    </td>
                  </>
                ) : (
                  <td className="px-4 py-2.5 capitalize text-muted">{capitalize(row.material)}</td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    )
  }

  // §8.3: both layouts always render, gated by CSS (sm: breakpoints) instead
  // of the JS media-query branch — no desktop/mobile flash, and the loading
  // skeleton mirrors this exact anatomy.
  return (
    <Panel className="overflow-hidden">
      <ul className="divide-y divide-line/70 sm:hidden">{mobileItems()}</ul>
      <div className="hidden overflow-x-auto sm:block">{desktopTable()}</div>
    </Panel>
  )
}
