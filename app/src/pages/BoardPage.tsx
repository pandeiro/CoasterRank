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
      <h1 className="sr-only">The community board</h1>
      <header
        data-board-hero
        className="flex flex-wrap items-end gap-x-3 gap-y-1.5 pb-2 sm:gap-x-5 sm:pb-3"
      >
        <img src="/logo.svg" alt="" className="h-14 w-auto sm:h-20" />
        <span className="display-heading text-[2.55rem] leading-none tracking-wide sm:text-[3.85rem]">
          Coaster<span className="text-coral">Rank</span>
        </span>
        <span className="pb-1 text-xs italic text-muted/60 sm:pb-[0.4rem] sm:text-sm">
          A live ranking of the world&apos;s roller coasters
        </span>
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
