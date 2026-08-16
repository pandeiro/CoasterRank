import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CoasterTable from '../components/CoasterTable'
import FilterBar from '../components/FilterBar'
import ScrollSentinel from '../components/ScrollSentinel'
import {
  buildParkMap,
  filterCoasters,
  filtersFromSearchParams,
  filtersToSearchParams,
  PAGE_SIZE,
  useAllCoasters,
  useManufacturers,
  useParks,
  type RankingFilters,
} from '../lib/coasters'

export default function BoardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])

  const coasters = useAllCoasters()
  const parks = useParks()
  const manufacturers = useManufacturers()

  // Incremental rendering: start with one page, grow as the user scrolls.
  const [page, setPage] = useState(1)

  // A filter change means a fresh view of the list, so restart at page 1.
  useEffect(() => {
    setPage(1)
  }, [filters])

  const refs = useMemo(
    () => ({ parks: parks.data ?? [], manufacturers: manufacturers.data ?? [] }),
    [parks.data, manufacturers.data],
  )

  const filteredRows = useMemo(
    () => (coasters.data ? filterCoasters(coasters.data, filters, refs) : []),
    [coasters.data, filters, refs],
  )

  const parkMap = useMemo(() => buildParkMap(refs.parks), [refs.parks])

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

  const isError = coasters.isError || parks.isError || manufacturers.isError
  const isPending = coasters.isPending || parks.isPending || manufacturers.isPending

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
            <CoasterTable rows={visibleRows} parks={parkMap} />
            <ScrollSentinel onLoadMore={onLoadMore} enabled={hasNextPage} />
            {!hasNextPage && visibleRows.length > 0 && (
              <p className="py-8 text-center text-xs text-slate-400">End of list</p>
            )}
          </>
        )}
      </div>
    </>
  )
}
