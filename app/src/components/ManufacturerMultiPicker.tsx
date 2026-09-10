import { useState } from 'react'
import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { fieldClassName } from './ui'
import type { Manufacturer } from '../lib/coasters'

type ManufacturerMultiPickerProps = {
  id?: string
  /** Full catalog (useManufacturers). */
  manufacturers: Manufacturer[]
  /** Current lineage, canonical order (index 0 = primary). */
  selected: Manufacturer[]
  onChange: (next: Manufacturer[]) => void
  placeholder?: string
}

/**
 * Multi-select manufacturer picker (typeahead + chips + reorder), shared by
 * the admin coaster modal, /submit and /suggest-edit.
 *
 * Ordering semantics (decided 2026-09): the FIRST chip is the primary — the
 * name compact surfaces show ("X et al"). A newly picked manufacturer leads
 * the list ("most recent wins" default) until ↑/↓ reordering says otherwise;
 * saves resequence positions, so explicit order always sticks.
 */
export default function ManufacturerMultiPicker({
  id,
  manufacturers,
  selected,
  onChange,
  placeholder = 'Search for a manufacturer…',
}: ManufacturerMultiPickerProps) {
  const [query, setQuery] = useState('')

  const selectedIds = new Set(selected.map((m) => m.id))
  const suggestions = manufacturers
    .filter(
      (m) => !selectedIds.has(m.id) && m.name.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .slice(0, 5)

  function pick(manufacturer: Manufacturer) {
    onChange([manufacturer, ...selected])
    setQuery('')
  }

  function remove(id: string) {
    onChange(selected.filter((m) => m.id !== id))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= selected.length) return
    const next = selected.slice()
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  return (
    <div className="relative">
      <input
        id={id}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className={fieldClassName}
        placeholder={placeholder}
        autoComplete="off"
      />
      {query.trim() && suggestions.length > 0 && (
        <ul className="absolute top-full z-20 mt-1 w-full overflow-hidden rounded-xl border border-line bg-surface-bright shadow-lift">
          {suggestions.map((m) => (
            <li
              key={m.id}
              className="cursor-pointer p-2 text-sm hover:bg-canvas"
              onClick={() => pick(m)}
            >
              {m.name}
            </li>
          ))}
        </ul>
      )}
      {selected.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {selected.map((m, index) => (
            <li
              key={m.id}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                index === 0 ? 'bg-accent/10 text-accent-strong' : 'bg-surface text-ink'
              }`}
            >
              <span className="min-w-0 truncate font-medium">
                {m.name}
                {index === 0 && <span className="ml-1.5 font-normal opacity-70">· primary</span>}
              </span>
              <span className="ml-auto flex shrink-0 items-center">
                <button
                  type="button"
                  aria-label={`Move ${m.name} up`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                  className="rounded-full p-0.5 text-muted transition-colors hover:text-ink disabled:opacity-30"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Move ${m.name} down`}
                  disabled={index === selected.length - 1}
                  onClick={() => move(index, 1)}
                  className="rounded-full p-0.5 text-muted transition-colors hover:text-ink disabled:opacity-30"
                >
                  <ArrowDown size={12} />
                </button>
                <button
                  type="button"
                  aria-label={`Remove ${m.name}`}
                  onClick={() => remove(m.id)}
                  className="rounded-full p-0.5 text-muted transition-colors hover:text-danger-text"
                >
                  <X size={12} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs text-muted">
        First listed is the primary ("X et al" on the board). New picks lead until you reorder.
      </p>
    </div>
  )
}
