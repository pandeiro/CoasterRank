import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileUp, Search, Upload } from 'lucide-react'
import { matchRows, type MatchResult } from 'coaster-match'
import {
  buildParkMap,
  filterAndRankCoasters,
  useAllCoasters,
  useParks,
  type RankingRow,
} from '../../lib/coasters'
import { useAuth } from '../../lib/auth-context'
import type { UserRide } from '../../lib/rides'
import {
  applyImport,
  catalogFromBoard,
  computePromotedIds,
  logImportEvent,
  type ImportSource,
  type ImportStats,
} from '../../lib/import/apply'
import {
  MAX_PASTE_CHARS,
  ParseError,
  parseDelimited,
  readFileAsText,
  type ParsedSheet,
} from '../../lib/import/parse'
import { Badge, Button, Modal, fieldClassName } from '../ui'

type Props = {
  isOpen: boolean
  onClose: () => void
  rides: UserRide[]
  /** Fired after a committed import; the page shows the (undoable) toast. */
  onApplied: (result: AppliedImport) => void
  onError: (message: string) => void
}

export type AppliedImport = {
  appliedCount: number
  mode: 'append' | 'replace'
  source: ImportSource
  /** Ranked list before the import — the undo payload. */
  priorRankedIds: string[]
  /** Ids the import ranked (the applied payload). */
  appliedIds: string[]
  /** Holding-pen rows the import promoted — undo must re-unrank these. */
  unrankIds: string[]
}

/**
 * auto     — matcher auto-accepted; include = true
 * already  — auto-matched to a coaster already ranked; informational, skipped
 * picked   — user resolved a candidate/missing row and ticked include
 * resolved — user picked a coaster but hasn't ticked include (or unticked)
 * needs-pick — candidate tier, no pick yet
 * missing  — no candidates, no pick yet
 */
type RowStatus = 'auto' | 'already' | 'picked' | 'resolved' | 'needs-pick' | 'missing'

type RowState = {
  raw: { name: string; park: string | null }
  result: MatchResult | null
  selectedId: string | null
  include: boolean
  status: RowStatus
}

/** Review rows render per page — 2k rows of DOM would jank the modal. */
const REVIEW_PAGE_SIZE = 100
/** How long the page-level undo toast stays up after an import. */
export const IMPORT_UNDO_MS = 10_000

function statusFor(result: MatchResult | null, rankedIds: Set<string>): RowStatus {
  if (!result) return 'missing'
  if (result.status === 'auto') {
    // Only RANKED prior rows are informational duplicates; a match to an
    // unranked holding-pen row is a normal add (the RPC upsert promotes the
    // pen row — same (user_id, coaster_id) row, no duplicate possible).
    return rankedIds.has(result.match!.entry.id) ? 'already' : 'auto'
  }
  if (result.status === 'candidate') return 'needs-pick'
  return 'missing'
}

// Rows the review never resolved and that aren't already ranked — the raw
// strings that feed new coaster_aliases rows. Rows with a manual pick (even
// skipped ones) matched fine and are excluded; so are 'already' rows.
function collectUnmatchedNames(rows: RowState[]): string[] {
  return rows
    .filter((r) => r.status !== 'auto' && r.status !== 'already' && !r.selectedId)
    .map((r) => r.raw.name)
}

export default function ImportListModal({ isOpen, onClose, rides, onApplied, onError }: Props) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const board = useAllCoasters()
  const parks = useParks()
  const parkMap = useMemo(() => buildParkMap(parks.data ?? []), [parks.data])

  const [step, setStep] = useState<'choose' | 'review'>('choose')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [sheet, setSheet] = useState<ParsedSheet | null>(null)
  const [source, setSource] = useState<ImportSource | null>(null)
  const [fileBytes, setFileBytes] = useState<number | null>(null)
  const [pasteText, setPasteText] = useState('')
  const [rows, setRows] = useState<RowState[]>([])
  const [rowLimit, setRowLimit] = useState(REVIEW_PAGE_SIZE)
  const [firstIsTop, setFirstIsTop] = useState(true)
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [confirmReplace, setConfirmReplace] = useState(false)
  const [applying, setApplying] = useState(false)
  const openedAt = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const priorRankedIds = useMemo(
    () => rides.filter((r) => r.rank !== null).map((r) => r.coaster_id),
    [rides],
  )
  // Only RANKED rows block import rows (see statusFor); unranked pen rows are
  // promotable adds, and in replace mode even ranked rows are re-includable.
  const rankedIds = useMemo(() => new Set(priorRankedIds), [priorRankedIds])

  // Fresh state per open — a re-open after close (or error) starts clean.
  useEffect(() => {
    if (!isOpen) {
      setStep('choose')
      setParseError(null)
      setSheet(null)
      setSource(null)
      setFileBytes(null)
      setPasteText('')
      setRows([])
      setRowLimit(REVIEW_PAGE_SIZE)
      setFirstIsTop(true)
      setMode('append')
      setConfirmReplace(false)
      setApplying(false)
    } else {
      openedAt.current = Date.now()
    }
  }, [isOpen])

  const counts = useMemo(() => {
    let auto = 0
    let already = 0
    let needsPick = 0
    let missing = 0
    let resolvedPicks = 0
    for (const row of rows) {
      if (row.status === 'auto') auto++
      else if (row.status === 'already') already++
      else if (row.status === 'needs-pick') {
        if (row.selectedId && row.include) resolvedPicks++
        else needsPick++
      } else if (row.status === 'missing') {
        if (row.selectedId && row.include) resolvedPicks++
        else missing++
      } else if (row.status === 'resolved') {
        if (row.include) resolvedPicks++
      } else if (row.status === 'picked') {
        resolvedPicks++
      }
    }
    return { auto, already, needsPick, missing, resolvedPicks }
  }, [rows])

  const acceptedRows = useMemo(
    () =>
      rows.filter(
        (r) => r.selectedId != null && r.include && (mode === 'replace' || r.status !== 'already'),
      ),
    [rows, mode],
  )
  const acceptedCount = acceptedRows.length

  const startReview = useCallback(
    (parsed: ParsedSheet, importSource: ImportSource, bytes: number | null) => {
      const boardRows = board.data ?? []
      if (boardRows.length === 0) {
        // useAllCoasters can fail outright (worker outage + Supabase down);
        // a silent early-return here would end the spinner with no feedback.
        setParseError(
          'The coaster catalog couldn\u2019t be loaded — check your connection and try again.',
        )
        return
      }
      const results = matchRows(catalogFromBoard(boardRows), parsed.rows)
      const nextRows: RowState[] = parsed.rows.map((raw, i) => {
        const result = results[i] ?? null
        const status = statusFor(result, rankedIds)
        return {
          raw,
          result,
          selectedId: result?.status === 'auto' ? result.match!.entry.id : null,
          include: status === 'auto',
          status,
        }
      })
      setRows(nextRows)
      setSheet(parsed)
      setSource(importSource)
      setFileBytes(bytes)
      setStep('review')
      void logImportEvent('parsed', importSource, {
        rowsTotal: parsed.rows.length,
        stats: {
          ...summarize(nextRows),
          unmatched_names: collectUnmatchedNames(nextRows),
          file_bytes: bytes ?? undefined,
        },
      })
    },
    [board.data, rankedIds],
  )

  const handleFile = useCallback(
    async (file: File) => {
      setParsing(true)
      setParseError(null)
      try {
        const text = await readFileAsText(file)
        const parsed = parseDelimited(text, `“${file.name}”`)
        startReview(parsed, 'csv', file.size)
      } catch (e) {
        const message = e instanceof ParseError ? e.message : 'Couldn\u2019t read that file.'
        setParseError(message)
        void logImportEvent('failed', 'csv', { stats: { file_bytes: file.size } })
      } finally {
        setParsing(false)
      }
    },
    [startReview],
  )

  const handlePaste = useCallback(() => {
    if (!pasteText.trim()) return
    setParsing(true)
    setParseError(null)
    try {
      if (pasteText.length > MAX_PASTE_CHARS) {
        throw new ParseError(
          `That\u2019s too much text (${(pasteText.length / 1024 / 1024).toFixed(1)} MB — max 1 MB). Import the first part as a file instead.`,
        )
      }
      const parsed = parseDelimited(pasteText, 'The pasted text')
      startReview(parsed, 'paste', null)
    } catch (e) {
      const message = e instanceof ParseError ? e.message : 'Couldn\u2019t parse the pasted text.'
      setParseError(message)
      void logImportEvent('failed', 'paste', {})
    } finally {
      setParsing(false)
    }
  }, [pasteText, startReview])

  const setRow = useCallback((index: number, patch: Partial<RowState>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }, [])

  const apply = useCallback(async () => {
    if (!source || applying) return
    const accepted = acceptedRows
    if (accepted.length === 0) return
    const priorSet = new Set(priorRankedIds)
    // Append-mode safety: a picked coaster that is somehow already ranked
    // stays where it is instead of appearing twice.
    const orderedAccepted = accepted
      .map((r) => r.selectedId!)
      .filter((id, i, arr) => arr.indexOf(id) === i && !(mode === 'append' && priorSet.has(id)))
    if (!firstIsTop) orderedAccepted.reverse()
    const orderedIds =
      mode === 'replace' ? orderedAccepted : [...priorRankedIds, ...orderedAccepted]
    setApplying(true)
    try {
      const stats: ImportStats = {
        ...summarize(rows),
        not_found: counts.needsPick + counts.missing,
        unmatched_names: collectUnmatchedNames(rows),
        duration_ms: openedAt.current ? Date.now() - openedAt.current : undefined,
        file_bytes: fileBytes ?? undefined,
      }
      const count = await applyImport({ orderedIds, replace: mode === 'replace', source, stats })
      await qc.invalidateQueries({ queryKey: ['myRides', user?.id] })
      onApplied({
        appliedCount: count,
        mode,
        source,
        priorRankedIds,
        appliedIds: orderedAccepted,
        // Holding-pen rows the import promoted — undo pushes these back to
        // the pen, otherwise a replace-mode undo would delete them outright.
        unrankIds: computePromotedIds(rides, orderedAccepted),
      })
      onClose()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Import failed. Please try again.'
      onError(`Import failed: ${message}`)
      void logImportEvent('failed', source, { rowsTotal: rows.length })
    } finally {
      setApplying(false)
    }
  }, [
    acceptedRows,
    applying,
    rides,
    counts.missing,
    counts.needsPick,
    fileBytes,
    firstIsTop,
    mode,
    onClose,
    onError,
    onApplied,
    priorRankedIds,
    rows,
    source,
    qc,
    user?.id,
  ])

  const visibleRows = rows.slice(0, rowLimit)

  if (!isOpen) return null

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={step === 'choose' ? 'Import your list' : 'Review import'}
      panelClassName="max-w-3xl"
    >
      {step === 'choose' ? (
        <ChooseStep
          parsing={parsing}
          parseError={parseError}
          boardPending={board.isPending}
          boardError={board.isError}
          onRetryBoard={() => void board.refetch()}
          pasteText={pasteText}
          onPasteText={setPasteText}
          onPaste={handlePaste}
          onFile={(file) => void handleFile(file)}
          fileInputRef={fileInputRef}
        />
      ) : (
        <div>
          {sheet && (
            <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium text-ink">{rows.length} rows</span>
              {counts.auto > 0 && <Badge tone="success">{counts.auto} matched</Badge>}
              {counts.needsPick > 0 && <Badge tone="warning">{counts.needsPick} need a pick</Badge>}
              {counts.missing > 0 && <Badge tone="danger">{counts.missing} not found</Badge>}
              {counts.already > 0 && <Badge tone="neutral">{counts.already} already ranked</Badge>}
            </div>
          )}
          {sheet && sheet.warnings.length > 0 && (
            <ul className="mb-3 space-y-0.5 text-xs text-muted">
              {sheet.warnings.map((warning) => (
                <li key={warning}>· {warning}</li>
              ))}
            </ul>
          )}

          <ul className="mb-4 max-h-[45vh] space-y-1.5 overflow-y-auto pr-1">
            {visibleRows.map((row, i) => (
              <ReviewRow
                key={`${row.raw.name}-${i}`}
                row={row}
                index={i}
                boardRows={board.data ?? []}
                parkMap={parkMap}
                rankedIds={rankedIds}
                replaceMode={mode === 'replace'}
                onChange={(patch) => setRow(i, patch)}
              />
            ))}
          </ul>
          {rows.length > rowLimit && (
            <button
              type="button"
              onClick={() => setRowLimit((n) => n + REVIEW_PAGE_SIZE)}
              className="mb-4 text-sm font-medium text-accent-text underline underline-offset-4"
            >
              Show more rows ({rows.length - rowLimit} hidden)
            </button>
          )}

          <div className="space-y-3 rounded-xl bg-surface px-4 py-3 text-sm">
            <fieldset>
              <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                Order
              </legend>
              <div className="flex gap-4">
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="import-direction"
                    checked={firstIsTop}
                    onChange={() => setFirstIsTop(true)}
                  />
                  First row is #1
                </label>
                <label className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name="import-direction"
                    checked={!firstIsTop}
                    onChange={() => setFirstIsTop(false)}
                  />
                  First row is last
                </label>
              </div>
            </fieldset>

            {priorRankedIds.length > 0 && (
              <fieldset>
                <legend className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  Merge
                </legend>
                <div className="flex flex-wrap gap-4">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="import-mode"
                      checked={mode === 'append'}
                      onChange={() => {
                        setMode('append')
                        setConfirmReplace(false)
                        // 'already' rows only participate via the replace
                        // toggle; back to excluded defaults in append.
                        setRows((prev) =>
                          prev.map((row) =>
                            row.status === 'already' ? { ...row, include: false } : row,
                          ),
                        )
                      }}
                    />
                    Add after my list ({priorRankedIds.length} ranked)
                  </label>
                  <label className="flex items-center gap-1.5">
                    <input
                      type="radio"
                      name="import-mode"
                      checked={mode === 'replace'}
                      onChange={() => {
                        setMode('replace')
                        // Replace is destructive: rows the file shares with
                        // the current ranked list default to KEPT at their
                        // imported position (per-row toggle below), so an
                        // import can never silently drop them.
                        setRows((prev) =>
                          prev.map((row) =>
                            row.status === 'already' ? { ...row, include: true } : row,
                          ),
                        )
                      }}
                    />
                    Replace my list
                  </label>
                </div>
              </fieldset>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {mode === 'replace' && !confirmReplace ? (
              <Button variant="outline" onClick={() => setConfirmReplace(true)}>
                Review replace…
              </Button>
            ) : (
              <Button
                variant={mode === 'replace' ? 'danger' : 'primary'}
                disabled={acceptedCount === 0 || applying}
                onClick={() => void apply()}
              >
                {applying
                  ? 'Importing…'
                  : mode === 'replace'
                    ? `Replace list with ${acceptedCount} coasters`
                    : `Import ${acceptedCount} coasters`}
              </Button>
            )}
          </div>
          {mode === 'replace' && confirmReplace && (
            <p className="mt-2 text-xs text-danger-text">
              Replaces your {priorRankedIds.length} ranked coasters. Your current list is kept for
              undo right after the import lands.
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function summarize(rows: RowState[]): ImportStats {
  let autoMatched = 0
  let candidatePicked = 0
  let notFound = 0
  for (const row of rows) {
    if (row.status === 'auto') {
      if (row.include) autoMatched++
    } else if (row.status === 'already') {
      // informational only
    } else if (row.selectedId && row.include) {
      candidatePicked++
    } else {
      notFound++
    }
  }
  return { auto_matched: autoMatched, candidate_picked: candidatePicked, not_found: notFound }
}

function ChooseStep({
  parsing,
  parseError,
  boardPending,
  boardError,
  onRetryBoard,
  pasteText,
  onPasteText,
  onPaste,
  onFile,
  fileInputRef,
}: {
  parsing: boolean
  parseError: string | null
  boardPending: boolean
  boardError: boolean
  onRetryBoard: () => void
  pasteText: string
  onPasteText: (value: string) => void
  onPaste: () => void
  onFile: (file: File) => void
  fileInputRef: React.RefObject<HTMLInputElement | null>
}) {
  const [dragOver, setDragOver] = useState(false)
  const disabled = parsing || boardPending

  return (
    <div>
      {boardPending && <p className="mb-3 text-sm text-muted">Loading the coaster catalog…</p>}
      {boardError && !boardPending && (
        <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger-text">
          <span>Couldn&apos;t load the coaster catalog — imports need it for matching.</span>
          <button
            type="button"
            onClick={onRetryBoard}
            className="shrink-0 font-medium underline underline-offset-4"
          >
            Retry
          </button>
        </div>
      )}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files?.[0]
          if (file) onFile(file)
        }}
        className={`flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors ${
          dragOver ? 'border-accent-text bg-accent/10' : 'border-line bg-surface'
        }`}
      >
        <FileUp className="h-6 w-6 text-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-ink">Drop a CSV file here</p>
        <p className="text-xs text-muted">or</p>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => fileInputRef.current?.click()}
        >
          Choose file…
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt,.dat"
          className="hidden"
          aria-label="Upload a CSV file"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) onFile(file)
            e.target.value = ''
          }}
        />
        <p className="mt-1 max-w-md text-xs leading-5 text-muted">
          From Google Sheets: File → Download → Comma-separated values (.csv). Excel: File → Save As
          → CSV UTF-8.
        </p>
      </div>

      <div className="mt-4">
        <label htmlFor="import-paste" className="text-sm font-medium text-ink">
          …or paste rows (copy straight from Excel / Sheets — tabs are fine)
        </label>
        <textarea
          id="import-paste"
          value={pasteText}
          onChange={(e) => onPasteText(e.target.value)}
          rows={5}
          placeholder={
            'Fury 325\tCarowinds\nKingda Ka\tSix Flags Great Adventure\nEl Toro\tSix Flags Great Adventure'
          }
          className={`${fieldClassName} mt-1.5 font-mono text-xs`}
        />
        <div className="mt-2 flex justify-end">
          <Button size="sm" disabled={disabled || !pasteText.trim()} onClick={onPaste}>
            <Upload className="h-3.5 w-3.5" />
            Parse pasted rows
          </Button>
        </div>
      </div>

      {parseError && (
        <p className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm text-danger-text">
          {parseError}
        </p>
      )}
    </div>
  )
}

function ReviewRow({
  row,
  index,
  boardRows,
  parkMap,
  rankedIds,
  replaceMode,
  onChange,
}: {
  row: RowState
  index: number
  boardRows: RankingRow[]
  parkMap: ReturnType<typeof buildParkMap>
  /** Ranked coasters — excluded from pickers in append mode (they'd be
   *  silently dropped there); re-includable in replace mode. */
  rankedIds: Set<string>
  replaceMode: boolean
  onChange: (patch: Partial<RowState>) => void
}) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')

  const matched = row.result?.status === 'auto' ? row.result.match!.entry : null
  const resolvedEntry =
    row.selectedId && row.status !== 'auto'
      ? (boardRows.find((c) => c.id === row.selectedId) ?? null)
      : null

  const searchResults = useMemo(() => {
    if (!searchOpen || query.trim().length < 2) return []
    const exclude = replaceMode ? new Set<string>() : rankedIds
    return filterAndRankCoasters(boardRows, query, parkMap, exclude).slice(0, 5)
  }, [searchOpen, query, boardRows, parkMap, rankedIds, replaceMode])

  const badge =
    row.status === 'auto' ? (
      <Badge tone="success">matched</Badge>
    ) : row.status === 'already' ? (
      <Badge tone="neutral">{replaceMode ? 'already in list' : 'already ranked'}</Badge>
    ) : row.status === 'needs-pick' ? (
      <Badge tone="warning">pick one</Badge>
    ) : row.status === 'missing' ? (
      <Badge tone="danger">not found</Badge>
    ) : (
      <Badge tone="success">picked</Badge>
    )

  const pick = useCallback(
    (id: string) => {
      onChange({ selectedId: id, include: true, status: 'picked' })
      setSearchOpen(false)
      setQuery('')
    },
    [onChange],
  )

  const chipCandidates = useMemo(() => {
    const candidates = row.result?.candidates.slice(0, 4) ?? []
    return candidates.filter((candidate) => replaceMode || !rankedIds.has(candidate.entry.id))
  }, [row.result, replaceMode, rankedIds])

  return (
    <li className="rounded-lg border border-line bg-surface-bright px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="w-6 shrink-0 text-right text-xs text-muted">{index + 1}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{row.raw.name}</p>
          {row.raw.park && <p className="truncate text-xs text-muted">{row.raw.park}</p>}
        </div>
        {badge}
        {(row.status === 'needs-pick' ||
          row.status === 'missing' ||
          ((row.status === 'picked' || row.status === 'resolved') && searchOpen)) && (
          <button
            type="button"
            onClick={() => setSearchOpen((v) => !v)}
            className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-accent-text hover:bg-accent/10"
          >
            {row.selectedId ? 'Change' : 'Find'}
          </button>
        )}
      </div>

      {matched && (
        <p className="ml-8 mt-0.5 truncate text-xs text-muted">
          → {matched.name}
          {matched.park ? ` — ${matched.park}` : ''}
        </p>
      )}
      {row.status === 'picked' && resolvedEntry && (
        <p className="ml-8 mt-0.5 truncate text-xs text-muted">
          → {resolvedEntry.name}
          {resolvedEntry.park_name ? ` — ${resolvedEntry.park_name}` : ''}
        </p>
      )}

      {/* Candidate chips are the primary resolution path — visible without
          opening the picker (search is for misses and overrides). Chips for
          coasters that are already ranked are hidden in append mode (the
          pick would be silently dropped there) but offered in replace mode. */}
      {!searchOpen &&
        (row.status === 'needs-pick' || row.status === 'picked' || row.status === 'resolved') &&
        chipCandidates.length > 0 && (
          <div className="ml-8 mt-1.5 flex flex-wrap gap-1.5">
            {chipCandidates.map((candidate) => (
              <button
                key={candidate.entry.id}
                type="button"
                onClick={() => pick(candidate.entry.id)}
                className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:border-accent-text hover:bg-accent/10"
              >
                {candidate.entry.name}
                {candidate.entry.park ? ` — ${candidate.entry.park}` : ''}
              </button>
            ))}
          </div>
        )}

      {searchOpen && (
        <div className="ml-8 mt-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the catalog…"
              className={`${fieldClassName} pl-8`}
              autoFocus
            />
          </div>
          {(row.result?.candidates.length ?? 0) > 0 && !query && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {chipCandidates.map((candidate) => (
                <button
                  key={candidate.entry.id}
                  type="button"
                  onClick={() => pick(candidate.entry.id)}
                  className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs text-ink hover:border-accent-text hover:bg-accent/10"
                >
                  {candidate.entry.name}
                  {candidate.entry.park ? ` — ${candidate.entry.park}` : ''}
                </button>
              ))}
            </div>
          )}
          {searchResults.length > 0 && (
            <ul className="mt-1.5 space-y-1">
              {searchResults.map((result) => (
                <li key={result.id}>
                  <button
                    type="button"
                    onClick={() => pick(result.id)}
                    className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 text-left text-xs text-ink hover:border-accent-text hover:bg-accent/10"
                  >
                    {result.name}
                    {result.park_name ? ` — ${result.park_name}` : ''}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {row.selectedId != null &&
        row.status !== 'auto' &&
        (row.status !== 'already' || replaceMode) && (
          <div className="ml-8 mt-1">
            <label className="flex items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={row.include}
                onChange={(e) =>
                  onChange(
                    row.status === 'already'
                      ? // 'already' rows keep their status — the toggle only
                        // matters in replace mode ("keep in my list").
                        { include: e.target.checked }
                      : {
                          include: e.target.checked,
                          status: e.target.checked ? 'picked' : 'resolved',
                        },
                  )
                }
              />
              {row.status === 'already' ? 'keep in my list' : 'include in import'}
            </label>
          </div>
        )}
    </li>
  )
}
