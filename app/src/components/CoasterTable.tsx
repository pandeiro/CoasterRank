import { useLayoutEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  capitalize,
  firstPlaceLabel,
  isFewVotes,
  type CoasterStatus,
  type RankingRow,
} from '../lib/coasters'
import { MANUFACTURER_ABBREVIATIONS } from '../lib/abbreviations'
import { asFiniteNumber, prefersReducedMotion, type RankTurnover } from '../lib/rankMovement'
import MovementChip from './MovementChip'
import ScorePill from './ScorePill'
import WeeklyDeltaBadge from './WeeklyDeltaBadge'
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
// Rendering (and the turnover tick) lives in ScorePill; the weekly delta badge
// rides the pill's corner, so both layouts compose them through scoreCell.
function scoreCell(row: RankingRow) {
  if (row.score === null) return null
  return (
    // shrink-0/self-center keep the mobile row layout (§7.2); relative
    // anchors the weekly delta badge to the pill's corner.
    <span className="relative inline-block shrink-0 self-center">
      <ScorePill row={row} />
      <WeeklyDeltaBadge row={row} />
    </span>
  )
}

type Props = {
  rows: RankingRow[]
  showPark?: boolean
  /** Ids whose row shows the first-place pill (see firstPlaceVisibleIds). */
  firstPlaceIds?: Set<string>
  /** 'board' swaps Material for Manufacturer (home page table). */
  variant?: 'default' | 'board'
  /** Live rank movement from the latest board turnover (board variant only).
      Null/absent on first load — movement must be earned by a live turnover. */
  turnover?: RankTurnover
}

export default function CoasterTable({
  rows,
  showPark = true,
  firstPlaceIds = new Set(),
  variant = 'default',
  turnover,
}: Props) {
  const navigate = useNavigate()

  // FLIP machinery (desktop): rowRefs tracks rendered <tr>s; topsRef always
  // holds each row's offsetTop as of the PREVIOUS commit — the "before"
  // snapshot a turnover animates from. offsetTop (not rect.top) so an
  // in-flight transform or a scroll between commits can't poison the baseline.
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const topsRef = useRef(new Map<string, number>())
  const flippedTurnoverRef = useRef<string | null>(null)
  // Latches the last turnover that actually moved something, for the mobile
  // list key (see the return block): it must NOT revert when the linger timer
  // empties the movement map (~12s in — that would silently remount the whole
  // list a second time: DOM churn plus focus loss), and must not move for
  // movement-less recomputes (most recomputes move nobody — remounting every
  // 15 min would be pure churn).
  const animatedTurnoverRef = useRef<string | null>(null)
  if (turnover?.turnoverId && turnover.movement.size > 0 && !prefersReducedMotion()) {
    animatedTurnoverRef.current = turnover.turnoverId
  }
  const animatedTurnoverId = animatedTurnoverRef.current

  // Runs after every commit, before paint: capture this commit's positions,
  // then — when a fresh turnover landed in it — snap viewport rows back to
  // their old offsets and let the transform ease to identity (FLIP). Rows
  // outside the viewport (±80px) just update silently.
  useLayoutEffect(() => {
    const before = topsRef.current
    const after = new Map<string, number>()
    for (const [id, el] of rowRefs.current) {
      if (el.isConnected) after.set(id, el.offsetTop)
    }
    topsRef.current = after

    const turnoverId = turnover?.turnoverId ?? null
    if (!turnoverId || flippedTurnoverRef.current === turnoverId) return
    flippedTurnoverRef.current = turnoverId
    if (!turnover || turnover.movement.size === 0) return
    if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') return
    const viewportHeight = window.innerHeight
    for (const [id, delta] of turnover.movement) {
      const el = rowRefs.current.get(id)
      const from = before.get(id)
      if (!el || from === undefined || delta === 0) continue
      const to = after.get(id)
      if (to === undefined || to === from) continue
      const rect = el.getBoundingClientRect()
      if (rect.top < -80 || rect.top > viewportHeight + 80) continue
      const dy = from - to
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
      requestAnimationFrame(() => {
        el.style.transition = 'transform 450ms cubic-bezier(0.22, 1, 0.36, 1)'
        el.style.transform = ''
        // The inline transition shorthand would otherwise stick forever and
        // override the row's transition-colors class (hover bg would snap).
        // Clear it when the ease lands; the timer is a fallback for a
        // transitionend that never fires (row unmounted mid-flight). Both
        // paths are idempotent string clears.
        const clearTransition = () => {
          el.style.transition = ''
        }
        el.addEventListener('transitionend', clearTransition, { once: true })
        setTimeout(clearTransition, 480)
      })
    }
  })

  if (rows.length === 0) {
    return <MessageState>No coasters match those filters.</MessageState>
  }

  // Whole rows navigate to the coaster detail page; the inline coaster and
  // park links keep their own targets by stopping propagation.
  const keepLinkTarget = (e: React.MouseEvent) => e.stopPropagation()

  // Global rank directly from the view (row.rank); unrated rows show a dash.
  // Filtering preserves BT score order, so visible gaps are intentional — the
  // board always reflects true global position, not a re-numbered filtered slice.
  // asFiniteNumber: a payload from before the view change has no rank at all
  // (undefined) — render the dash, never an empty/broken badge.
  const positions: Array<number | null> = rows.map((row) => asFiniteNumber(row.rank))

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
          {/* §7.2: score centers vertically, matching the rank circle.
              The weekly delta badge rides the pill's corner (both layouts). */}
          {row.score !== null && scoreCell(row)}
        </li>
      )
    })
  }

  function desktopTable() {
    // The reserved movement gutter (board variant only): a fixed-width column
    // left of the rank badge, normally empty, so turnover chips never shift
    // the layout. BoardPage passes movement only after a live turnover.
    const gutterActive = variant === 'board'
    return (
      <table className="w-full table-fixed text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">
            {gutterActive && <th className="w-10 px-2" aria-hidden="true" />}
            <th className="w-[4.5rem] px-3 py-2.5 text-right">
              <span className="sr-only">Rank</span>
            </th>
            <th className="py-2.5 pl-3 pr-4">Coaster</th>
            {showPark && <th className="w-[30%] px-4 py-2.5">Park</th>}
            {variant === 'board' ? (
              <>
                <th className="hidden w-56 px-4 py-2.5 lg:table-cell">Manufacturer</th>
                <th className="w-24 px-4 py-2.5 text-left">
                  <span
                    title="Bradley–Terry strength index from head-to-head rider comparisons; 100 is the community average"
                    className="cursor-help whitespace-nowrap"
                  >
                    Score <span className="ml-0.5 text-muted/60">ⓘ</span>
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
            const liveDelta = gutterActive ? turnover?.movement.get(row.id) : undefined

            return (
              <tr
                key={row.id}
                ref={(el) => {
                  // FLIP position tracking (desktop turnover animation).
                  if (el) rowRefs.current.set(row.id, el)
                  else rowRefs.current.delete(row.id)
                }}
                onClick={row.slug ? () => navigate(`/coasters/${row.slug}`) : undefined}
                className={`group cursor-pointer transition-colors ${rowTint(position)}`}
              >
                {gutterActive && (
                  <td className="w-10 px-2 py-2.5 text-right">
                    {liveDelta !== undefined && turnover?.turnoverId && (
                      <MovementChip key={turnover.turnoverId} delta={liveDelta} index={index} />
                    )}
                  </td>
                )}
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
                        rounded background (tabular numerals, no bold). */}
                    <td className="px-4 py-2.5 text-left">
                      {row.score === null ? (
                        <span className="text-sm text-muted">—</span>
                      ) : (
                        scoreCell(row)
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
  // Mobile turnover (§"living competition"): no FLIP mid-scroll — the list
  // remounts under the latched key (see the FLIP machinery above) so the new
  // rankings fade in (~320ms blink). The fade class itself still requires
  // live movement; the key just holds steady until the next
  // movement-bearing turnover.
  const crossfade =
    Boolean(animatedTurnoverId) && (turnover?.movement.size ?? 0) > 0 && !prefersReducedMotion()
  return (
    <Panel className="overflow-hidden">
      <ul
        key={animatedTurnoverId ?? 'board-list'}
        className={`divide-y divide-line/70 sm:hidden ${
          crossfade ? 'animate-[turnover-fade_320ms_ease-out]' : ''
        }`}
      >
        {mobileItems()}
      </ul>
      <div className="hidden overflow-x-auto sm:block">{desktopTable()}</div>
    </Panel>
  )
}
