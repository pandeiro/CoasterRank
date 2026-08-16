import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import { useAllCoasters, useParks, buildParkMap, type RankingRow } from '../lib/coasters'

type Props = {
  existingCoasterIds: Set<string>
  onAdd: (coasterId: string, coasterName: string) => void
}

const MAX_RESULTS = 8

export default function CoasterSearchBar({ existingCoasterIds, onAdd }: Props) {
  const coasters = useAllCoasters()
  const parks = useParks()
  const parkMap = useMemo(() => buildParkMap(parks.data ?? []), [parks.data])

  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query.trim()), 200)
    return () => clearTimeout(id)
  }, [query])

  const results = useMemo(() => {
    if (!debouncedQuery || debouncedQuery.length < 2) return []
    const term = debouncedQuery.toLowerCase()
    const matches = (coasters.data ?? [])
      .filter(
        (c) =>
          c.name.toLowerCase().includes(term) ||
          parkMap.get(c.park_id)?.name.toLowerCase().includes(term),
      )
      .filter((c) => !existingCoasterIds.has(c.id))
      .slice(0, MAX_RESULTS)
    return matches
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
    if (!isOpen || results.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightIndex((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter' && highlightIndex >= 0) {
      e.preventDefault()
      select(results[highlightIndex])
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const isSearching = debouncedQuery.length >= 2 && coasters.isLoading

  return (
    <div className="relative">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={inputRef}
          type="search"
          aria-label="Add coasters to your list"
          placeholder="Search coasters to add…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIsOpen(true)
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => setTimeout(() => setIsOpen(false), 150)}
          onKeyDown={onKeyDown}
          className="w-full rounded border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm focus:border-slate-400 focus:outline-none"
        />
      </div>
      {isOpen && (debouncedQuery.length >= 2 || isSearching) && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-1 w-full overflow-hidden rounded border border-slate-200 bg-white shadow-lg"
        >
          {isSearching ? (
            <li className="px-4 py-3 text-sm text-slate-500">Searching…</li>
          ) : results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-slate-500">No coasters found.</li>
          ) : (
            results.map((row, i) => {
              const park = parkMap.get(row.park_id)
              return (
                <li
                  key={row.id}
                  role="option"
                  aria-selected={i === highlightIndex}
                  className={`flex cursor-pointer items-center justify-between px-4 py-2 text-sm ${
                    i === highlightIndex ? 'bg-slate-100' : 'hover:bg-slate-50'
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(row)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-slate-900">{row.name}</span>
                    <span className="block truncate text-xs text-slate-500">
                      {park?.name ?? 'Unknown park'}
                    </span>
                  </span>
                  <Plus className="ml-2 h-4 w-4 shrink-0 text-slate-400" />
                </li>
              )
            })
          )}
        </ul>
      )}
    </div>
  )
}
