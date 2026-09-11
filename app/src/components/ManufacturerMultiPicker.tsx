import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { fieldClassName } from './ui'
import type { Manufacturer, ManufacturerPick } from '../lib/coasters'

type ManufacturerMultiPickerProps = {
  id?: string
  /** Full catalog (useManufacturers). */
  manufacturers: Manufacturer[]
  /** Current lineage, canonical order (index 0 = primary). */
  selected: ManufacturerPick[]
  onChange: (next: ManufacturerPick[]) => void
  placeholder?: string
}

/**
 * Multi-select manufacturer picker (typeahead + chips + reorder), shared by
 * the admin coaster modal, /submit and /suggest-edit.
 *
 * Entries are either existing catalog manufacturers or PROPOSED ones (typed
 * free-text, id null) — proposed chips are marked "new — pending approval"
 * and only become real manufacturer rows when a submission is approved.
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
  const trimmed = query.trim()
  const lowered = trimmed.toLowerCase()

  const selectedIds = new Set(selected.filter((p) => p.id !== null).map((p) => p.id))
  const selectedNames = new Set(selected.map((p) => p.name.toLowerCase()))
  const suggestions = manufacturers
    .filter((m) => !selectedIds.has(m.id) && m.name.toLowerCase().includes(lowered))
    .slice(0, 5)

  // Free text becomes a PROPOSED manufacturer unless it case-insensitively
  // matches the catalog (pick that instead) or a chip already in the list.
  const canPropose =
    lowered.length > 0 &&
    !selectedNames.has(lowered) &&
    !manufacturers.some((m) => m.name.toLowerCase() === lowered)

  // Emit normalized picks ({id, name} only) so callers never receive catalog
  // extras (slug, …) that would drift into the payload.
  function emit(next: ManufacturerPick[]) {
    onChange(
      next.map((p) => (p.id === null ? { id: null, name: p.name } : { id: p.id, name: p.name })),
    )
  }

  function pick(manufacturer: Manufacturer) {
    emit([{ id: manufacturer.id, name: manufacturer.name }, ...selected])
    setQuery('')
  }

  function propose() {
    if (!canPropose) return
    emit([{ id: null, name: trimmed }, ...selected])
    setQuery('')
  }

  function remove(index: number) {
    emit(selected.filter((_, i) => i !== index))
  }

  function move(index: number, delta: number) {
    const target = index + delta
    if (target < 0 || target >= selected.length) return
    const next = selected.slice()
    ;[next[index], next[target]] = [next[target], next[index]]
    emit(next)
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
      {trimmed && (suggestions.length > 0 || canPropose) && (
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
          {canPropose && (
            <li
              data-testid="propose-option"
              className="flex cursor-pointer items-center gap-1.5 p-2 text-sm hover:bg-canvas"
              onClick={propose}
            >
              <Plus size={14} className="shrink-0 text-accent-strong" />
              <span>
                Propose <span className="font-medium">“{trimmed}”</span>
                <span className="ml-1 text-xs text-muted">(new — pending approval)</span>
              </span>
            </li>
          )}
        </ul>
      )}
      {selected.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {selected.map((m, index) => (
            <li
              key={m.id ?? m.name.toLowerCase()}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                m.id === null
                  ? 'bg-accent/10 text-accent-strong ring-1 ring-accent/30'
                  : index === 0
                    ? 'bg-accent/10 text-accent-strong'
                    : 'bg-surface text-ink'
              }`}
            >
              <span className="min-w-0 truncate font-medium">
                {m.name}
                {m.id === null && (
                  <span className="ml-1.5 font-normal opacity-70">· new — pending approval</span>
                )}
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
                  onClick={() => remove(index)}
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
        First listed is the primary (&quot;X et al&quot; on the board). New picks lead until you
        reorder. Not listed? Type the name and propose it.
      </p>
    </div>
  )
}
