import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import BoardSkeleton from '../components/BoardSkeleton'
import CoasterTable from '../components/CoasterTable'
import FilterBar from '../components/FilterBar'
import LiveStatusPopunder from '../components/LiveStatusPopunder'
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
  useBoardMeta,
  useRankedUserCount,
  type RankingFilters,
} from '../lib/coasters'

// Real-user visibility gate for the status line (§2.2): below this the count
// stays hidden so an early-stage launch doesn't advertise small numbers.
const USER_COUNT_VISIBILITY_GATE = 50

function StatusPulse({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-4 animate-pulse rounded bg-line/60 ${className}`}
    />
  )
}

export default function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])

  const coasters = useAllCoasters()
  // Auxiliary stat: a failure here degrades to a fully-dashed first-place
  // column (gate closed), never an error screen.
  const rankedUsers = useRankedUserCount()
  // Status-line extras from the same cached payload (§2.2/§2.3): real user
  // count and the honest "Last ranked" timestamp (pg_cron success, falling
  // back to the edge-cache fill time).
  const boardMeta = useBoardMeta()

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
  const userCount = boardMeta.data?.real_user_count ?? null
  const showUserCount = userCount !== null && userCount > USER_COUNT_VISIBILITY_GATE
  const lastRankedAt = boardMeta.data?.last_recomputed_at ?? boardMeta.data?.generated_at ?? null

  // §8.3: the table slot cross-fades from the skeleton instead of swapping —
  // the table fades in over one paint, the skeleton fades out and unmounts.
  // Only the initial load fades; filter changes never re-trigger it.
  const [tableVisible, setTableVisible] = useState(false)
  const [skeletonGone, setSkeletonGone] = useState(false)

  useEffect(() => {
    if (coasters.isPending) {
      setTableVisible(false)
      setSkeletonGone(false)
      return
    }
    setTableVisible(true)
    const timer = setTimeout(() => setSkeletonGone(true), 350)
    return () => clearTimeout(timer)
  }, [coasters.isPending])

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
      <header data-board-hero className="relative min-h-[5.5rem] pb-3 sm:pb-4">
        {/* Masthead: lockup + status line. Mobile (§2.4) centers the lockup
            and drops the status line onto its own right-aligned row (the
            line is w-full, so it wraps by itself); desktop keeps brand left
            / line right. The line always renders (§8.1) — while data loads
            it shows pulse bars sized to cover every segment, including the
            gated users count and the About link, so nothing shifts on fill.
            Lockup: mark + wordmark scaled ~12% over the #124 spec, wordmark
            still on the -0.12em optical rise. */}
        <div className="relative flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h1 className="mx-auto flex flex-wrap items-baseline justify-center gap-x-1 sm:mx-0 sm:justify-start">
            <img src="/logo.svg" alt="" className="h-[3.7rem] w-auto sm:h-[4.5rem]" />
            <span className="display-heading -translate-y-[0.12em] text-[2.4rem] leading-none tracking-wide sm:text-[2.9rem]">
              Coaster<span className="text-coral">Rank</span>
            </span>
          </h1>
          <p className="flex min-h-6 w-full flex-wrap items-center justify-center gap-2 text-sm text-muted sm:w-auto sm:justify-end">
            {rows ? (
              <>
                <Link
                  to="/about"
                  className="font-medium text-ink underline-offset-4 hover:text-accent-dark hover:underline"
                >
                  About
                </Link>
                <span aria-hidden="true">·</span>
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
                {/* Users count is desktop-only: on mobile the line is tight
                    and the count adds little (§2.2 gate still applies). */}
                {showUserCount && (
                  <>
                    <span aria-hidden="true" className="hidden sm:inline">
                      ·
                    </span>
                    <span className="hidden tabular-nums sm:inline">
                      {(userCount ?? 0).toLocaleString()} users
                    </span>
                  </>
                )}
                <span aria-hidden="true">·</span>
                <LiveStatusPopunder lastRankedAt={lastRankedAt} />
              </>
            ) : (
              <>
                <StatusPulse className="w-[6.5rem]" />
                <StatusPulse className="w-20" />
                <StatusPulse className="w-16" />
                {/* Users is desktop-only (see above): its pulse hides with it. */}
                <span
                  aria-hidden="true"
                  className="hidden h-4 w-14 animate-pulse rounded bg-line/60 sm:inline-block"
                />
                <StatusPulse className="w-12" />
              </>
            )}
          </p>
        </div>
      </header>
      <FilterBar
        filters={filters}
        onChange={onFiltersChange}
        countries={countries}
        manufacturers={manufacturers}
      />
      <div className="relative mt-4 min-h-[60vh] sm:mt-6 sm:min-h-[65vh]">
        {coasters.isError ? (
          <MessageState tone="danger">Couldn&apos;t load the board.</MessageState>
        ) : (
          <>
            {!skeletonGone && (
              <div
                aria-hidden="true"
                className={`absolute inset-x-0 top-0 transition-opacity duration-300 ${
                  tableVisible ? 'pointer-events-none opacity-0' : 'opacity-100'
                }`}
              >
                <BoardSkeleton />
              </div>
            )}
            {!coasters.isPending && (
              <div
                className={`transition-opacity duration-300 ${tableVisible ? 'opacity-100' : 'opacity-0'}`}
              >
                <CoasterTable rows={visibleRows} firstPlaceIds={firstPlaceIds} variant="board" />
                <ScrollSentinel onLoadMore={onLoadMore} enabled={hasNextPage} />
                {!hasNextPage && visibleRows.length > 0 && (
                  <p className="py-8 text-center text-xs uppercase tracking-[0.12em] text-muted">
                    End of list
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
