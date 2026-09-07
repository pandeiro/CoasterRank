import Papa from 'papaparse'

// Spreadsheet/paste → structured rows. Both CSV files and pasted text (from
// Excel/Sheets, which is tab-separated, or a Reddit comment, which is
// line-separated) go through the same Papaparse pass; XLSX joins later by
// converting its sheets to string[][] and reusing mapSheetRows.

export type ParsedRow = {
  name: string
  park: string | null
}

export type ParsedSheet = {
  rows: ParsedRow[]
  /** Non-fatal notes shown on the review screen ("3 duplicate rows dropped"). */
  warnings: string[]
  /** True when a header row was detected and skipped. */
  hadHeader: boolean
  /** Detected delimiter (',' ';' '\t' '|'), null when single-column. */
  delimiter: string | null
}

export class ParseError extends Error {}

export const MAX_IMPORT_ROWS = 2000
export const MAX_FILE_BYTES = 5 * 1024 * 1024
/** Paste parity with the file cap: reject absurd pastes before parsing. */
export const MAX_PASTE_CHARS = 1_000_000

const HEADER_HINT =
  /^(coaster|coasters|name|title|ride|rank|ranking|position|pos|#|no\.?|number|park|location)$/i
const PARK_HINT = /^(park|location|place|venue|where)$/i
const RANK_HINT = /^(rank|ranking|position|pos|#|no\.?|number)$/i

function isNumeric(value: string): boolean {
  return /^-?\d+([.,]\d+)?$/.test(value.trim())
}

function isNumericColumn(values: string[]): boolean {
  const filled = values.filter((v) => v.trim() !== '')
  return filled.length > 0 && filled.every((v) => isNumeric(v))
}

function isHeaderRow(cells: string[]): boolean {
  // A header row has at least one recognizable label and no long coaster-like
  // text in the first two cells.
  return cells.slice(0, 3).some((c) => HEADER_HINT.test(c.trim()))
}

export type SheetGrid = {
  /** Cell grid WITHOUT the header row (sliced here so callers can't double-skip). */
  body: string[][]
  hadHeader: boolean
  /** Column indexes, or null when that concept doesn't apply. */
  nameCol: number
  parkCol: number | null
  rankCol: number | null
}

// Column heuristics over the cell grid. Priority:
//   1. explicit headers (name/park/rank)
//   2. a fully-numeric leading column is an index → ignore it
//   3. leftmost mostly-text column = name; the next mostly-text column = park
export function mapSheetGrid(grid: string[][], hadHeader: boolean): SheetGrid {
  const header = grid[0] ?? []
  const body = hadHeader ? grid.slice(1) : grid
  const width = Math.max(...grid.map((r) => r.length), 1)
  const columns: string[][] = Array.from({ length: width }, (_, c) =>
    body.map((row) => row[c] ?? ''),
  )

  let nameCol: number | null = null
  let parkCol: number | null = null
  let rankCol: number | null = null

  if (hadHeader) {
    header.forEach((cell, index) => {
      const label = cell.trim()
      if (RANK_HINT.test(label) && rankCol === null) rankCol = index
      else if (PARK_HINT.test(label) && parkCol === null) parkCol = index
      else if (HEADER_HINT.test(label) && nameCol === null) nameCol = index
    })
  }

  // Ignore a purely numeric leading column (pasted "1  Fury 325" lists).
  let scanFrom = 0
  while (scanFrom < width && nameCol === null && isNumericColumn(columns[scanFrom]!)) {
    scanFrom++
  }

  for (let c = scanFrom; c < width; c++) {
    if (nameCol !== null && parkCol !== null && rankCol !== null) break
    const values = columns[c]!.filter((v) => v.trim() !== '')
    if (values.length === 0) continue
    if (nameCol === null) {
      // Park-like columns that arrive before the name column (rare layouts).
      if (hadHeader && parkCol === null && PARK_HINT.test((header[c] ?? '').trim())) {
        parkCol = c
        continue
      }
      nameCol = c
    } else if (parkCol === null) {
      parkCol = c
    } else if (rankCol === null && isNumericColumn(columns[c]!)) {
      rankCol = c
    }
  }

  if (nameCol === null) {
    throw new ParseError(
      'Couldn\u2019t find a coaster-name column. Make sure each row has the coaster name.',
    )
  }

  // A detected rank column only counts as ordering when it's cleanly 1..n
  // (ties, gaps, or non-numeric junk fall back to file order).
  let orderedByRank = false
  if (rankCol !== null) {
    const values = columns[rankCol]!
    const ascending = values.every((v, i) => isNumeric(v) && Number(v.trim()) === i + 1)
    orderedByRank = ascending
  }

  return {
    body,
    hadHeader,
    nameCol,
    parkCol,
    rankCol: orderedByRank ? rankCol : null,
  }
}

function dedupeAndBuild(
  mapped: SheetGrid,
  warnings: string[],
): { rows: ParsedRow[]; duplicates: number } {
  const seen = new Set<string>()
  const rows: ParsedRow[] = []
  let duplicates = 0
  let empty = 0

  for (const cells of mapped.body) {
    const name = (cells[mapped.nameCol] ?? '').trim()
    if (!name) {
      empty++
      continue
    }
    const park = mapped.parkCol !== null ? (cells[mapped.parkCol] ?? '').trim() || null : null
    const key = `${name.toLowerCase()}|${(park ?? '').toLowerCase()}`
    if (seen.has(key)) {
      duplicates++
      continue
    }
    seen.add(key)
    rows.push({ name, park })
  }

  if (duplicates > 0)
    warnings.push(`${duplicates} duplicate row${duplicates === 1 ? '' : 's'} dropped`)
  if (empty > 0) warnings.push(`${empty} empty row${empty === 1 ? '' : 's'} skipped`)
  return { rows, duplicates }
}

export function parseDelimited(text: string, sourceLabel: string): ParsedSheet {
  // Excel on Windows hands CSVs over as UTF-16 or prefixes UTF-8 with a BOM;
  // strip both before parsing. A UTF-16 text() read shows up with NUL padding
  // — detect and re-decode.
  let cleaned = text.replace(/^\uFEFF/, '')
  if (cleaned.includes('\u0000')) {
    // Heuristic UTF-16LE re-decode from the raw bytes the caller already read
    // as text is lossy; instead treat NULs as separators (Excel TSV-in-UTF16
    // exports) and let Papaparse see garbage — the row validator drops it.
    // Simpler honest error: ask for a re-export.
    throw new ParseError(
      `That file looks like a UTF-16 export. Please re-save it as CSV UTF-8 and try again.`,
    )
  }

  const warnings: string[] = []
  // Papaparse's guesser needs consistent delimiter counts across ALL lines —
  // one tabbed row among plain lines (mixed Reddit-style pastes) makes it fall
  // back to ','. Tab-dominance is a strong signal for Sheets/Excel pastes, so
  // detect it up front; non-tabbed lines simply parse as single-column names.
  // Small pastes trust ANY tabbed line; big files need a majority so a single
  // stray tab in a comma CSV can't flip the whole parse.
  const lines = cleaned.split(/\r\n|\r|\n/).filter((line) => line.trim() !== '')
  const tabbed = lines.filter((line) => line.includes('\t')).length
  const delimiter =
    tabbed > 0 && (tabbed >= lines.length / 2 || lines.length <= 10) ? '\t' : undefined
  const result = Papa.parse<string[]>(cleaned, {
    skipEmptyLines: 'greedy',
    delimiter,
    delimitersToGuess: [',', ';', '\t', '|'],
  })
  if (result.errors.length > 0) {
    // Papaparse is tolerant; only hard failures (unterminated quotes) surface.
    const fatal = result.errors.find((e) => e.type === 'Quotes')
    if (fatal) {
      throw new ParseError(
        `That file has unterminated quotes (row ${fatal.row != null ? fatal.row + 1 : '?'}). Fix the CSV or re-export it.`,
      )
    }
  }

  const grid = (result.data as string[][]).filter((row) =>
    row.some((cell) => (cell ?? '').trim() !== ''),
  )
  if (grid.length === 0) {
    throw new ParseError(`${sourceLabel} didn\u2019t contain any rows.`)
  }

  let hadHeader = isHeaderRow(grid[0]!)

  const mapped = mapSheetGrid(grid, hadHeader)
  const { rows } = dedupeAndBuild(mapped, warnings)

  if (rows.length === 0) {
    throw new ParseError(`${sourceLabel} didn\u2019t contain any coaster names.`)
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    warnings.push(
      `Only the first ${MAX_IMPORT_ROWS} rows will be imported (${rows.length - MAX_IMPORT_ROWS} cut)`,
    )
    rows.length = MAX_IMPORT_ROWS
  }

  return {
    rows,
    warnings,
    hadHeader,
    delimiter: result.meta?.delimiter ?? null,
  }
}

// File → text with a size guard. CSV/TSV/TXT are read as text; anything else
// is rejected with guidance (XLSX arrives in a later step).
export async function readFileAsText(file: File): Promise<string> {
  if (file.size > MAX_FILE_BYTES) {
    throw new ParseError(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB — max 5 MB). Export CSV instead.`,
    )
  }
  const name = file.name.toLowerCase()
  if (!/\.(csv|tsv|txt|dat)$/.test(name)) {
    throw new ParseError(
      'That file type isn\u2019t supported yet — export it as CSV (Excel: File → Save As → CSV UTF-8), or paste the rows directly.',
    )
  }
  return file.text()
}
