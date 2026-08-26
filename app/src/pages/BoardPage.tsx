import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import CoasterTable from '../components/CoasterTable'
import FilterBar from '../components/FilterBar'
import ScrollSentinel from '../components/ScrollSentinel'
import { Badge, MessageState, PageHeader } from '../components/ui'
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
      <PageHeader
        eyebrow="The community board"
        title="CoasterRank"
        description="A live ranking of the world's roller coasters"
        action={<Badge tone="accent">Live board</Badge>}
      />
      <FilterBar filters={filters} onChange={onFiltersChange} />
      <div className="mt-6">
        {isError ? (
          <MessageState tone="danger">Couldn&apos;t load the board.</MessageState>
        ) : isPending ? (
          <MessageState>Loading…</MessageState>
        ) : (
          <>
            <CoasterTable rows={visibleRows} parks={parkMap} />
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
