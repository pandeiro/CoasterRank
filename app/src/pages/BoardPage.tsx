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

// Decorative coaster-track gesture (hill, dip, loop) behind the hero — the
// page's one restrained visual layer. Pure vector; no imagery data exists.
function TrackLine() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 520 150"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      className="pointer-events-none absolute top-0 right-0 hidden h-28 w-auto text-ink/10 lg:block"
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
        <TrackLine />
        <div className="relative flex items-center gap-2.5 sm:gap-3">
          <img src="/logo.svg" alt="" className="h-9 w-auto sm:h-12" />
          <span className="display-heading text-[1.65rem] leading-none tracking-wide sm:text-4xl">
            Coaster<span className="text-coral">Rank</span>
          </span>
          <span className="ml-1 hidden text-sm italic text-muted/70 lg:inline">
            A live ranking of the world&apos;s roller coasters
          </span>
        </div>
        <div className="relative mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 sm:mt-5">
          <h1 className="display-heading text-[1.9rem] leading-none tracking-wide sm:text-[2.6rem]">
            World&apos;s Best Roller Coasters
          </h1>
          {rows && (
            <p className="flex items-center gap-2 pb-0.5 text-sm text-muted sm:pb-1">
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
