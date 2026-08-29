import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { CountryOption, MaterialView, RankingFilters } from '../lib/coasters'
import { fieldClassName, Panel, selectClassName } from './ui'

type Props = {
  filters: RankingFilters
  onChange: (filters: RankingFilters) => void
  countries: CountryOption[]
  manufacturers: string[]
}

const MATERIAL_VIEWS: { value: MaterialView; label: string }[] = [
  { value: 'everything', label: 'Everything' },
  { value: 'wood', label: 'Wooden only' },
  { value: 'steel', label: 'Steel only' },
]

const groupLabel = 'flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted'

export default function FilterBar({ filters, onChange, countries, manufacturers }: Props) {
  const [search, setSearch] = useState(filters.q ?? '')
  // Latest filters, read inside the debounce callback so the timer can be
  // keyed on `search` alone: unrelated filter changes must neither restart
  // the debounce nor be lost to a stale closure when it fires.
  const filtersRef = useRef(filters)
  filtersRef.current = filters

  useEffect(() => {
    setSearch(filters.q ?? '')
  }, [filters.q])

  useEffect(() => {
    const id = setTimeout(() => {
      const current = filtersRef.current
      if (search !== (current.q ?? '')) onChange({ ...current, q: search.trim() || undefined })
    }, 300)
    return () => clearTimeout(id)
  }, [search, onChange])

  function update(patch: Partial<RankingFilters>) {
    onChange({ ...filters, ...patch })
  }

  const pinned = countries.filter((c) => c.pinned)
  const rest = countries.filter((c) => !c.pinned)

  const countrySelect = (options: CountryOption[]) =>
    options.map((o) => (
      <option key={o.country} value={o.country}>
        {o.country} ({o.count})
      </option>
    ))

  return (
    <Panel className="mt-8 space-y-4 p-3 sm:p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          aria-label="Filter coasters"
          placeholder="Filter by coaster or park name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${fieldClassName} py-3 pl-9 pr-3`}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className={groupLabel}>
          Material
          <div
            role="radiogroup"
            aria-label="Material"
            className="flex overflow-hidden rounded-lg border border-line"
          >
            {MATERIAL_VIEWS.map((o) => {
              const active = filters.materialView === o.value
              return (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => update({ materialView: o.value })}
                  className={`flex-1 px-2 py-2 text-sm font-medium transition-colors ${
                    active ? 'bg-ink text-canvas' : 'bg-surface-bright text-muted hover:text-ink'
                  }`}
                >
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
        <label className={groupLabel}>
          Country
          <select
            aria-label="Country"
            value={filters.country ?? ''}
            onChange={(e) => update({ country: e.target.value || undefined })}
            className={selectClassName}
          >
            <option value="">Any</option>
            {pinned.length > 0 ? (
              <>
                <optgroup label="Most coasters">{countrySelect(pinned)}</optgroup>
                <optgroup label="All countries">{countrySelect(rest)}</optgroup>
              </>
            ) : (
              countrySelect(rest)
            )}
          </select>
        </label>
        <label className={groupLabel}>
          Manufacturer
          <select
            aria-label="Manufacturer"
            value={filters.manufacturer ?? ''}
            onChange={(e) => update({ manufacturer: e.target.value || undefined })}
            className={selectClassName}
          >
            <option value="">Any</option>
            {manufacturers.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className={groupLabel}>
          Status
          <label className="flex items-center gap-2 py-2.5 text-sm font-medium normal-case tracking-normal text-ink">
            <input
              type="checkbox"
              checked={filters.allStatuses}
              onChange={(e) => update({ allStatuses: e.target.checked })}
              className="h-4 w-4 accent-coral"
            />
            Include non-operational
          </label>
        </div>
      </div>
    </Panel>
  )
}
