import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useAllCoasters, useParks, buildParkMap, parkLabel, type RankingRow } from '../lib/coasters'
import { fieldClassName } from './ui'

type Props = {
  existingCoasterIds: Set<string>
  onAdd: (coasterId: string, coasterName: string) => void
}

const MAX_RESULTS = 8
const MIN_QUERY_LENGTH = 2
const LISTBOX_ID = 'coaster-search-listbox'

export default function CoasterSearchBar({ existingCoasterIds, onAdd }: Props) {
  const coasters = useAllCoasters()
  const parks = useParks()
  const parkMap = useMemo(() => buildParkMap(parks.data ?? []), [parks.data])

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 200)
    return () => clearTimeout(id)
  }, [query])

  // Matches are capped for render but `total` is kept so the dropdown can say
  // "Showing 8 of N" instead of silently hiding the rest (issue #91).
  const results = useMemo(() => {
    if (!debouncedQuery || debouncedQuery.length < MIN_QUERY_LENGTH) return { rows: [], total: 0 }
    const term = debouncedQuery.toLowerCase()
    const matches = (coasters.data ?? [])
      .filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          parkMap.get(c.park_id)?.name.toLowerCase().includes(term),
      )
      .filter((c) => !existingCoasterIds.has(c.id))
    return { rows: matches.slice(0, MAX_RESULTS), total: matches.length }
  }, [debouncedQuery, coasters.data, parkMap, existingCoasterIds])

  useEffect(() => {
    setHighlightIndex(-1)
  }, [debouncedQuery])

  function select(row: RankingRow) {
    onAdd(row.id, row.name)
    setQuery('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || results.rows.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((i) => (i + 1) % results.rows.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => (i - 1 + results.rows.length) % results.rows.length)
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault()
      select(results.rows[highlightIndex])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const isSearching = debouncedQuery.length >= MIN_QUERY_LENGTH && coasters.isLoading
  const showList = isOpen && debouncedQuery.length >= 1
  const activeOptionId =
    highlightIndex >= 0 && results.rows[highlightIndex]
      ? `coaster-option-${results.rows[highlightIndex].id}`
      : undefined

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label="Add coasters to your list"
          aria-expanded={showList}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={activeOptionId}
          placeholder="Search coasters to add…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          onKeyDown={onKeyDown}
          className={`${fieldClassName} py-3 pl-9 pr-3`}
        />
      </div>
      {showList && (
        <ul
          id={LISTBOX_ID}
          role="listbox"
          className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-line bg-surface-bright shadow-lift"
        >
          {isSearching ? (
            <li className="px-4 py-3 text-sm text-muted" role="presentation">
              Searching…
            </li>
          ) : debouncedQuery.length < MIN_QUERY_LENGTH ? (
            <li className="px-4 py-3 text-sm text-muted" role="presentation">
              Type at least {MIN_QUERY_LENGTH} characters to search.
            </li>
          ) : results.rows.length === 0 ? (
            <li className="px-4 py-3 text-sm text-muted" role="presentation">
              No coasters found.
            </li>
          ) : (
            <>
              {results.rows.map((row, i) => {
                const park = parkMap.get(row.park_id)
                return (
                  <li
                    key={row.id}
                    id={`coaster-option-${row.id}`}
                    role="option"
                    aria-selected={i === highlightIndex}
                    className={`flex cursor-pointer items-center justify-between px-4 py-2 text-sm ${
                      i === highlightIndex ? 'bg-surface' : 'hover:bg-canvas'
                    }`}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => select(row)}
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{row.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {parkLabel(park, 'Unknown park')}
                      </span>
                    </span>
                    <Plus className="ml-2 h-4 w-4 shrink-0 text-accent-strong" />
                  </li>
                )
              })}
              {results.total > results.rows.length && (
                <li
                  className="border-t border-line px-4 py-2 text-xs text-muted"
                  role="presentation"
                >
                  Showing {results.rows.length} of {results.total} — refine your search
                </li>
              )}
            </>
          )}
        </ul>
      )}
    </div>
  )
}
