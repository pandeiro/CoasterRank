import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, MapPin, Search } from 'lucide-react'
import { useAllCoasters, useParks, type RankingRow } from '../lib/coasters'
import {
  defaultParkSelection,
  groupRowsByPark,
  matchParks,
  sortRowsForCommit,
} from '../lib/park-bulk'
import { statusPill } from './CoasterTable'
import { Button, Modal, fieldClassName } from './ui'

type Props = {
  isOpen: boolean
  onClose: () => void
  /** Coasters already in the user's list — excluded from selection and
   *  reported per park, since re-adding is always a no-op. */
  existingIds: Set<string>
  /** Receives the selected rows in board-rank order; the caller owns the
   *  commit (guest selection fill vs. /me merged-ladder append). */
  onCommit: (rows: RankingRow[]) => void
  committing?: boolean
}

/**
 * Park bulk-add picker ("I've been to Cedar Point, Magic Mountain, …"):
 * search parks, expand checklists, commit the selection in one action.
 * Defaults to a park's operating coasters — the honest version of "add all",
 * since having been to a park isn't the same as riding everything in it.
 */
export default function ParkBulkAddModal({
  isOpen,
  onClose,
  existingIds,
  onCommit,
  committing = false,
}: Props) {
  const board = useAllCoasters()
  const parks = useParks()

  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // Park checklist defaults apply once, on first expand — un-expanding and
  // re-expanding must not resurrect deselected rows.
  const [defaultsApplied, setDefaultsApplied] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!isOpen) {
      setQuery('')
      setExpanded(new Set())
      setSelected(new Set())
      setDefaultsApplied(new Set())
    }
  }, [isOpen])

  const rowsByPark = useMemo(() => groupRowsByPark(board.data ?? []), [board.data])
  const matches = useMemo(
    () => matchParks(parks.data ?? [], rowsByPark, query),
    [parks.data, rowsByPark, query],
  )

  function togglePark(parkId: string, rows: RankingRow[]) {
    const isExpanded = expanded.has(parkId)
    if (isExpanded) {
      setExpanded((prev) => {
        const next = new Set(prev)
        next.delete(parkId)
        return next
      })
      return
    }
    if (!defaultsApplied.has(parkId)) {
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of defaultParkSelection(rows, existingIds)) next.add(id)
        return next
      })
      setDefaultsApplied((prev) => new Set(prev).add(parkId))
    }
    setExpanded((prev) => new Set(prev).add(parkId))
  }

  // Master checkbox over a park's selectable (non-excluded) rows.
  function toggleAllPark(rows: RankingRow[]) {
    const selectable = rows.filter((r) => !existingIds.has(r.id))
    if (selectable.length === 0) return
    const allChecked = selectable.every((r) => selected.has(r.id))
    setSelected((prev) => {
      const next = new Set(prev)
      for (const row of selectable) {
        if (allChecked) next.delete(row.id)
        else next.add(row.id)
      }
      return next
    })
  }

  const commitRows = useMemo(() => {
    const byId = new Map((board.data ?? []).map((r) => [r.id, r]))
    const rows: RankingRow[] = []
    for (const id of selected) {
      const row = byId.get(id)
      if (row) rows.push(row)
    }
    return sortRowsForCommit(rows)
  }, [board.data, selected])

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add coasters from a park"
      panelClassName="max-w-2xl"
    >
      <p className="mb-3 text-sm text-muted">
        Been somewhere with a whole lineup? Pick the park, uncheck anything you missed, and add the
        rest in one go.
      </p>

      {board.isPending && <p className="mb-3 text-sm text-muted">Loading the coaster catalog…</p>}
      {board.isError && !board.isPending && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger-text">
          <span>Couldn&apos;t load the coaster catalog — the picker needs it.</span>
          <button
            type="button"
            onClick={() => void board.refetch()}
            className="shrink-0 font-medium underline underline-offset-4"
          >
            Retry
          </button>
        </div>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        <input
          type="search"
          role="searchbox"
          aria-label="Search parks"
          placeholder="Search parks by name or city…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`${fieldClassName} pl-9`}
        />
      </div>

      <ul className="mt-3 max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
        {query.trim().length >= 2 && matches.length === 0 && !board.isPending && (
          <li className="rounded-lg border border-line bg-surface-bright px-3 py-3 text-sm text-muted">
            No parks match “{query.trim()}”.
          </li>
        )}
        {matches.map(({ park, rows }) => {
          const open = expanded.has(park.id)
          const selectable = rows.filter((r) => !existingIds.has(r.id))
          const checkedCount = selectable.filter((r) => selected.has(r.id)).length
          const alreadyCount = rows.length - selectable.length
          const allChecked = selectable.length > 0 && checkedCount === selectable.length
          const someChecked = checkedCount > 0 && checkedCount < selectable.length
          const location = [park.city, park.region, park.country].filter(Boolean).join(' · ')
          return (
            <li key={park.id} className="rounded-lg border border-line bg-surface-bright">
              <button
                type="button"
                onClick={() => togglePark(park.id, rows)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                {open ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                )}
                <MapPin className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink">{park.name}</span>
                  <span className="block truncate text-xs text-muted">
                    {rows.length} coaster{rows.length === 1 ? '' : 's'} on the board
                    {location ? ` · ${location}` : ''}
                    {alreadyCount > 0 ? ` · ${alreadyCount} already in your list` : ''}
                  </span>
                </span>
                {selectable.length > 0 && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${
                      checkedCount > 0 ? 'bg-accent/15 text-accent-text' : 'bg-canvas text-muted'
                    }`}
                  >
                    {checkedCount}/{selectable.length}
                  </span>
                )}
              </button>

              {open && (
                <div className="border-t border-line px-3 py-2">
                  {selectable.length === 0 ? (
                    <p className="py-1 text-xs text-muted">
                      No coasters from this park to add
                      {rows.length > 0 ? ' — they’re all in your list already' : ' yet'}.
                    </p>
                  ) : (
                    <>
                      <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-ink">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(el) => {
                            if (el) el.indeterminate = someChecked
                          }}
                          onChange={() => toggleAllPark(rows)}
                        />
                        {allChecked
                          ? `Uncheck all (${selectable.length})`
                          : `Check all (${selectable.length})`}
                      </label>
                      <ul className="space-y-0.5">
                        {rows.map((row) => {
                          const excluded = existingIds.has(row.id)
                          const pill = statusPill(row.status)
                          return (
                            <li key={row.id}>
                              <label
                                className={`flex items-center gap-2 rounded px-1.5 py-1 text-sm ${
                                  excluded ? 'text-muted' : 'text-ink hover:bg-accent/10'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  disabled={excluded}
                                  checked={excluded || selected.has(row.id)}
                                  onChange={(e) =>
                                    setSelected((prev) => {
                                      const next = new Set(prev)
                                      if (e.target.checked) next.add(row.id)
                                      else next.delete(row.id)
                                      return next
                                    })
                                  }
                                />
                                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                                {pill && (
                                  <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted">
                                    {pill.label}
                                  </span>
                                )}
                                {row.rank !== null && (
                                  <span className="shrink-0 text-xs tabular-nums text-muted">
                                    #{row.rank}
                                  </span>
                                )}
                              </label>
                            </li>
                          )
                        })}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-4 flex items-center justify-between gap-3">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={commitRows.length === 0 || committing}
          onClick={() => onCommit(commitRows)}
        >
          {committing
            ? 'Adding…'
            : `Add ${commitRows.length} coaster${commitRows.length === 1 ? '' : 's'}`}
        </Button>
      </div>
    </Modal>
  )
}
