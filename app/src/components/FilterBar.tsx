import { useEffect, useRef, useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import type { CountryOption, MaterialView, RankingFilters } from '../lib/coasters'
import { useMediaQuery } from '../lib/use-media-query'
import { fieldClassName, Panel, selectClassName } from './ui'

type Props = {
  filters: RankingFilters
  onChange: (filters: RankingFilters) => void
  countries: CountryOption[]
  manufacturers: string[]
}

const MATERIAL_VIEWS: { value: MaterialView; label: string }[] = [
  { value: 'everything', label: 'All' },
  { value: 'wood', label: 'Wood' },
  { value: 'steel', label: 'Steel' },
]

const STATUS_VIEWS: { value: 'any' | 'running'; label: string }[] = [
  { value: 'any', label: 'All' },
  { value: 'running', label: 'Running' },
]

const groupLabel = 'flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted'

function Segmented<T extends string>({
  groupLabel: label,
  value,
  options,
  onChange,
  className = '',
}: {
  groupLabel: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  className?: string
}) {
  return (
    // One control system across the toolbar: quiet outlined buttons whose
    // selected state is the teal accent (interactive emphasis), so toggles
    // stop competing with the navy wordmark for visual weight.
    <div role="radiogroup" aria-label={label} className={`flex items-center gap-2 ${className}`}>
      <span className="shrink-0 text-xs font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </span>
      <div className="flex">
        {options.map((o, i) => {
          const active = value === o.value
          // Each button owns its border + radius and joins the row via -ml-px
          // (later siblings paint above), so resting and hover outlines render
          // identically crisp at the corners — no parent clipping involved.
          const shape =
            i === 0 ? 'rounded-l-lg' : i === options.length - 1 ? '-ml-px rounded-r-lg' : '-ml-px'
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(o.value)}
              className={`relative border px-3 py-2 text-sm font-medium transition-[background-color,border-color,color] hover:z-10 ${shape} ${
                active
                  ? 'border-accent-strong bg-accent/10 text-accent-strong'
                  : 'border-line bg-surface-bright text-muted hover:border-ink/40 hover:bg-surface hover:text-ink'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export default function FilterBar({ filters, onChange, countries, manufacturers }: Props) {
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const [search, setSearch] = useState(filters.q ?? '')
  const [moreOpen, setMoreOpen] = useState(false)
  const moreRef = useRef<HTMLDivElement>(null)
  const moreButtonRef = useRef<HTMLButtonElement>(null)

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

  // Popover dismissal, mirroring UserMenu: outside click + Escape (with
  // focus restored to the trigger).
  useEffect(() => {
    if (!moreOpen) return

    function handleClickOutside(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false)
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setMoreOpen(false)
        moreButtonRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [moreOpen])

  function update(patch: Partial<RankingFilters>) {
    onChange({ ...filters, ...patch })
  }

  const pinned = countries.filter((c) => c.pinned)
  const rest = countries.filter((c) => !c.pinned)

  // The badge counts whatever lives inside the popover: country/manufacturer
  // on desktop, plus the material/status segmenteds that fold in on mobile.
  const selectFilterCount = (filters.country ? 1 : 0) + (filters.manufacturer ? 1 : 0)
  const activeMore = isDesktop
    ? selectFilterCount
    : selectFilterCount +
      (filters.materialView !== 'everything' ? 1 : 0) +
      (!filters.allStatuses ? 1 : 0)

  // Toolbar segmenteds are CSS-gated (`hidden sm:flex`, §8.2) so the desktop
  // layout never flashes the mobile fold-in — the JS flag only decides the
  // active-count badge and what the popover contains.
  const materialGroup = (
    <Segmented
      groupLabel="Track"
      value={filters.materialView}
      options={MATERIAL_VIEWS}
      onChange={(materialView) => update({ materialView })}
      className="hidden sm:flex"
    />
  )
  const statusGroup = (
    <Segmented
      groupLabel="Status"
      value={filters.allStatuses ? 'any' : 'running'}
      options={STATUS_VIEWS}
      onChange={(status) => update({ allStatuses: status === 'any' })}
      className="hidden sm:flex"
    />
  )
  // Popover copies (mobile only): always visible inside the sheet.
  const popoverMaterial = (
    <Segmented
      groupLabel="Track"
      value={filters.materialView}
      options={MATERIAL_VIEWS}
      onChange={(materialView) => update({ materialView })}
    />
  )
  const popoverStatus = (
    <Segmented
      groupLabel="Status"
      value={filters.allStatuses ? 'any' : 'running'}
      options={STATUS_VIEWS}
      onChange={(status) => update({ allStatuses: status === 'any' })}
    />
  )

  const countrySelect = (options: CountryOption[]) =>
    options.map((o) => (
      <option key={o.country} value={o.country}>
        {o.country} ({o.count})
      </option>
    ))

  return (
    // min-h floor keeps the toolbar a fixed slot (§8.2); content height is
    // defined by the (always-rendered) controls themselves.
    <Panel className="min-h-[3.25rem] p-2.5 sm:p-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:min-w-[15rem]">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            aria-label="Filter coasters"
            placeholder="Filter by coaster or park name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={fieldClassName + ' pl-9'}
          />
        </div>
        {materialGroup}
        {statusGroup}
        <div className="relative shrink-0" ref={moreRef}>
          {' '}
          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            aria-haspopup="true"
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-surface-bright px-3 py-2 text-sm font-medium text-ink transition-colors hover:border-ink/40 hover:bg-surface"
          >
            <SlidersHorizontal className="h-4 w-4 text-muted" />
            Filters
            {activeMore > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-ink/60 px-1.5 text-[11px] font-semibold leading-5 text-canvas tabular-nums">
                {activeMore}
              </span>
            )}
          </button>
          {moreOpen && (
            <>
              {/* Mobile backdrop */}
              <div
                className="fixed inset-0 z-40 bg-black/30 sm:hidden"
                onClick={() => setMoreOpen(false)}
                aria-hidden="true"
              />
              <div
                data-testid="filter-popover"
                className="fixed inset-x-0 top-16 z-50 space-y-4 border-b border-line bg-surface-bright px-4 py-4 shadow-lg sm:absolute sm:left-auto sm:right-0 sm:top-full sm:z-20 sm:mt-2 sm:w-72 sm:rounded-xl sm:border sm:border-line sm:p-4 sm:shadow-lift"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                    {isDesktop ? 'More filters' : 'Filters'}
                  </span>
                  {activeMore > 0 && (
                    <button
                      type="button"
                      onClick={() =>
                        update({
                          materialView: 'everything',
                          allStatuses: true,
                          country: undefined,
                          manufacturer: undefined,
                        })
                      }
                      className="text-xs font-medium text-accent-strong hover:underline"
                    >
                      Reset
                    </button>
                  )}
                </div>
                {!isDesktop && (
                  <>
                    {popoverMaterial}
                    {popoverStatus}
                  </>
                )}
                <label className={groupLabel}>
                  Country
                  <select
                    aria-label="Country"
                    value={filters.country ?? ''}
                    onChange={(e) => update({ country: e.target.value || undefined })}
                    className={`${selectClassName} w-full min-w-[12rem]`}
                  >
                    <option value="">All countries</option>
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
                    className={`${selectClassName} w-full min-w-[12rem]`}
                  >
                    <option value="">All manufacturers</option>
                    {manufacturers.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </>
          )}
        </div>
      </div>
    </Panel>
  )
}
