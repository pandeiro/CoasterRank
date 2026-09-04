import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CoasterTable from '../components/CoasterTable'
import FilterBar from '../components/FilterBar'
import ScrollSentinel from '../components/ScrollSentinel'
import { MessageState } from '../components/ui'
import {
  countryOptions,
  filterCoasters,
  filtersFromSearchParams,
  filtersToSearchParams,
  firstPlaceVisibleIds,
  manufacturerOptions,
  PAGE_SIZE,
  useAllCoasters,
  useRankedUserCount,
  type RankingFilters,
} from '../lib/coasters'

// Decorative coaster-track gesture (hill, dip, loop) floating above the
// status line at the masthead's right edge — the page's one restrained visual
// layer. Pure vector; no imagery data exists. ViewBox is cropped to the
// path's own baseline so the ink sits where the box says it does.
function TrackLine() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 520 122"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      className="pointer-events-none hidden h-24 w-auto shrink-0 text-ink/10 lg:block"
    >
      <path d="M6 118 C 84 118, 122 40, 198 40 C 252 40, 272 96, 330 96 C 366 96, 386 88, 418 88 a 22 22 0 1 1 0 -44 a 22 22 0 1 1 0 44 C 446 88, 468 106, 514 106" />
    </svg>
  )
}

export default function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])

  const coasters = useAllCoasters()
  // Auxiliary stat: a failure here degrades to a fully-dashed first-place
  // column (gate closed), never an error screen.
  const rankedUsers = useRankedUserCount()

  // Incremental rendering: start with one page, grow as the user scrolls.
  const [page, setPage] = useState(1)

  // A filter change means a fresh view of the list, so restart at page 1.
  useEffect(() => {
    setPage(1)
  }, [filters])

  const rows = coasters.data
  const countries = useMemo(() => countryOptions(rows ?? []), [rows])
  const manufacturers = useMemo(() => manufacturerOptions(rows ?? []), [rows])
  const firstPlaceIds = useMemo(
    () => firstPlaceVisibleIds(rows ?? [], rankedUsers.data ?? 0),
    [rows, rankedUsers.data],
  )

  const filteredRows = useMemo(() => (rows ? filterCoasters(rows, filters) : []), [rows, filters])

  // Board status line: the whole catalog (not the filtered view), so the
  // headline always describes the full live ranking.
  const coasterCount = rows?.length ?? 0
  const countryCount = useMemo(
    () => new Set((rows ?? []).map((r) => r.park_country).filter(Boolean)).size,
    [rows],
  )

  const visibleRows = filteredRows.slice(0, page * PAGE_SIZE)
  const hasNextPage = visibleRows.length < filteredRows.length

  const onFiltersChange = useCallback(
    (next: RankingFilters) => {
      setSearchParams(filtersToSearchParams(next), { replace: true })
    },
    [setSearchParams],
  )

  const onLoadMore = useCallback(() => {
    if (hasNextPage) setPage((p) => p + 1)
  }, [hasNextPage])

  return (
    <>
      <header data-board-hero className="relative pb-3 sm:pb-4">
        {/* Masthead heading: mark + wordmark only. The descriptor copy is gone;
            the status line carries the live claim, right-aligned at the margin
            with the track gesture floating above it (desktop only). The
            wordmark takes a small optical rise (-0.06em) off the baseline so
            it nestles into the mark's right slope. */}
        <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="flex flex-wrap items-baseline gap-x-2 sm:gap-x-2.5">
            <img src="/logo.svg" alt="" className="h-11 w-auto sm:h-[3.3rem]" />
            <span className="display-heading -translate-y-[0.06em] text-[2.1rem] leading-none tracking-wide sm:text-[2.6rem]">
              Coaster<span className="text-coral">Rank</span>
            </span>
          </h1>
          {rows && (
            <div className="flex flex-col items-end gap-1.5">
              <TrackLine />
              <p className="flex items-center gap-2 text-sm text-muted">
                <span className="tabular-nums">
                  {coasterCount.toLocaleString()} coaster{coasterCount === 1 ? '' : 's'}
                </span>
                {countryCount > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="tabular-nums">
                      {countryCount} countr{countryCount === 1 ? 'y' : 'ies'}
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <span className="inline-flex items-center gap-1.5 font-medium text-accent-strong">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
                  </span>
                  Live
                </span>
              </p>
            </div>
          )}
        </div>
      </header>
      <FilterBar
        filters={filters}
        onChange={onFiltersChange}
        countries={countries}
        manufacturers={manufacturers}
      />
      <div className="mt-4 sm:mt-6">
        {coasters.isError ? (
          <MessageState tone="danger">Couldn&apos;t load the board.</MessageState>
        ) : coasters.isPending ? (
          <MessageState>Loading…</MessageState>
        ) : (
          <>
            <CoasterTable rows={visibleRows} firstPlaceIds={firstPlaceIds} variant="board" />
            <ScrollSentinel onLoadMore={onLoadMore} enabled={hasNextPage} />
            {!hasNextPage && visibleRows.length > 0 && (
              <p className="py-8 text-center text-xs uppercase tracking-[0.12em] text-muted">
                End of list
              </p>
            )}
          </>
        )}
      </div>
    </>
  )
}
