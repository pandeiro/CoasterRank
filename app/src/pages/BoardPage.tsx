import { useCallback, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import CoasterTable from '../components/CoasterTable'
import FilterBar from '../components/FilterBar'
import ScrollSentinel from '../components/ScrollSentinel'
import {
  filtersFromSearchParams,
  filtersToSearchParams,
  useRankings,
  type RankingFilters,
} from '../lib/coasters'

export default function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])
  const { data, isPending, isError, hasNextPage, fetchNextPage, isFetchingNextPage } =
    useRankings(filters)

  const rows = useMemo(() => data?.pages.flat() ?? [], [data])

  const onFiltersChange = useCallback(
    (next: RankingFilters) => {
      setSearchParams(filtersToSearchParams(next), { replace: true })
    },
    [setSearchParams],
  )

  const onLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <>
      <h1 className="text-3xl font-semibold text-slate-900">CoasterRank</h1>
      <p className="mt-2 text-slate-600">
        The live community ranking of the world&apos;s roller coasters.
      </p>
      <FilterBar filters={filters} onChange={onFiltersChange} />
      <div className="mt-6">
        {isError ? (
          <p className="py-16 text-center text-red-600">Couldn&apos;t load the board.</p>
        ) : isPending ? (
          <p className="py-16 text-center text-slate-500">Loading…</p>
        ) : (
          <>
            <CoasterTable rows={rows} />
            <ScrollSentinel
              onLoadMore={onLoadMore}
              enabled={Boolean(hasNextPage) && !isFetchingNextPage}
            />
            {isFetchingNextPage && (
              <p className="py-8 text-center text-sm text-slate-500">Loading more…</p>
            )}
            {!hasNextPage && rows.length > 0 && (
              <p className="py-8 text-center text-xs text-slate-400">End of list</p>
            )}
          </>
        )}
      </div>
    </>
  )
}
