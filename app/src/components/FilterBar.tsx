import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import {
  capitalize,
  COASTER_MATERIALS,
  COASTER_STATUSES,
  useCountries,
  useManufacturers,
  useParks,
  type RankingFilters,
} from '../lib/coasters'

type Props = {
  filters: RankingFilters
  onChange: (filters: RankingFilters) => void
}

const STATUS_OPTIONS = [
  { value: 'operating', label: 'Operating' },
  { value: 'all', label: 'All statuses' },
  ...COASTER_STATUSES.filter((s) => s !== 'operating').map((s) => ({
    value: s,
    label: capitalize(s),
  })),
]

const MATERIAL_OPTIONS = COASTER_MATERIALS.map((m) => ({ value: m, label: capitalize(m) }))

export default function FilterBar({ filters, onChange }: Props) {
  const parks = useParks()
  const countries = useCountries()
  const manufacturers = useManufacturers()
  const [search, setSearch] = useState(filters.q ?? '')

  useEffect(() => {
    setSearch(filters.q ?? '')
  }, [filters.q])

  useEffect(() => {
    const id = setTimeout(() => {
      if (search !== (filters.q ?? '')) onChange({ ...filters, q: search.trim() || undefined })
    }, 300)
    return () => clearTimeout(id)
  }, [search, filters, onChange])

  function update(patch: Partial<RankingFilters>) {
    onChange({ ...filters, ...patch })
  }

  return (
    <div className="mt-6 space-y-3 rounded border border-slate-200 bg-white p-4">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          aria-label="Search coasters"
          placeholder="Search coasters…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded border border-slate-300 py-2 pl-9 pr-3"
        />
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Status
          <select
            aria-label="Status"
            value={filters.status}
            onChange={(e) => update({ status: e.target.value as RankingFilters['status'] })}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Material
          <select
            aria-label="Material"
            value={filters.material ?? ''}
            onChange={(e) =>
              update({ material: (e.target.value || undefined) as RankingFilters['material'] })
            }
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            {MATERIAL_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Country
          <select
            aria-label="Country"
            value={filters.country ?? ''}
            onChange={(e) => update({ country: e.target.value || undefined })}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            {countries.data?.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Park
          <select
            aria-label="Park"
            value={filters.park ?? ''}
            onChange={(e) => update({ park: e.target.value || undefined })}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            {parks.data?.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-slate-700">
          Manufacturer
          <select
            aria-label="Manufacturer"
            value={filters.manufacturer ?? ''}
            onChange={(e) => update({ manufacturer: e.target.value || undefined })}
            className="rounded border border-slate-300 px-2 py-1.5 text-sm"
          >
            <option value="">Any</option>
            {manufacturers.data?.map((m) => (
              <option key={m.slug} value={m.slug}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}
