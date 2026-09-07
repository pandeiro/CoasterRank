import { describe, expect, it } from 'vitest'
import { MAX_IMPORT_ROWS, ParseError, mapSheetGrid, parseDelimited, readFileAsText } from './parse'

describe('parseDelimited', () => {
  it('parses plain newline-separated names (Reddit-comment paste)', () => {
    const parsed = parseDelimited('Fury 325\nKingda Ka\nEl Toro', 'paste')
    expect(parsed.rows.map((r) => r.name)).toEqual(['Fury 325', 'Kingda Ka', 'El Toro'])
    expect(parsed.rows.every((r) => r.park === null)).toBe(true)
  })

  it('parses tab-separated paste (Excel/Sheets copy) as name+park', () => {
    const parsed = parseDelimited(
      'Fury 325\tCarowinds\nEl Toro\tSix Flags Great Adventure',
      'paste',
    )
    expect(parsed.rows).toEqual([
      { name: 'Fury 325', park: 'Carowinds' },
      { name: 'El Toro', park: 'Six Flags Great Adventure' },
    ])
  })

  it('keeps tab detection when tabbed rows mix with plain-name rows', () => {
    // Papaparse's guesser needs uniform delimiter counts; the tab-dominance
    // pre-pass exists precisely for this mixed shape.
    const parsed = parseDelimited(
      'Fury 325\tCarowinds\nBatman: The Ride\nMadeup Coaster XYZ',
      'paste',
    )
    expect(parsed.rows[0]).toEqual({ name: 'Fury 325', park: 'Carowinds' })
    expect(parsed.rows[1]).toEqual({ name: 'Batman: The Ride', park: null })
  })

  it('parses quoted CSV with commas inside names', () => {
    const parsed = parseDelimited('"Batman: The Ride, The Dark Knight Legend",Six Flags', 'file')
    expect(parsed.rows[0]).toEqual({
      name: 'Batman: The Ride, The Dark Knight Legend',
      park: 'Six Flags',
    })
  })

  it('auto-detects semicolon delimiters (Excel EU locale)', () => {
    const parsed = parseDelimited('Fury 325;Carowinds\nEl Toro;SFGAdv', 'file')
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toEqual({ name: 'Fury 325', park: 'Carowinds' })
    expect(parsed.delimiter).toBe(';')
  })

  it('skips a detected header row', () => {
    const parsed = parseDelimited('Coaster,Park\nFury 325,Carowinds\nEl Toro,SFGAdv', 'file')
    expect(parsed.hadHeader).toBe(true)
    expect(parsed.rows.map((r) => r.name)).toEqual(['Fury 325', 'El Toro'])
  })

  it('uses header labels to pick park and rank columns', () => {
    const parsed = parseDelimited(
      'Rank,Coaster,Park\n1,El Toro,SFGAdv\n2,Fury 325,Carowinds\n3,Kingda Ka,SFGAdv',
      'file',
    )
    expect(parsed.hadHeader).toBe(true)
    expect(parsed.rows).toEqual([
      { name: 'El Toro', park: 'SFGAdv' },
      { name: 'Fury 325', park: 'Carowinds' },
      { name: 'Kingda Ka', park: 'SFGAdv' },
    ])
  })

  it('ignores a leading index column in headerless pastes', () => {
    const parsed = parseDelimited('1\tFury 325\tCarowinds\n2\tEl Toro\tSFGAdv', 'paste')
    expect(parsed.rows).toEqual([
      { name: 'Fury 325', park: 'Carowinds' },
      { name: 'El Toro', park: 'SFGAdv' },
    ])
  })

  it('does not treat the numeric-index column as the name column', () => {
    // Header-less CSV with index first: col 0 numeric, col 1 names.
    const grid = [
      ['1', 'Fury 325'],
      ['2', 'El Toro'],
    ]
    const mapped = mapSheetGrid(grid, false)
    expect(mapped.nameCol).toBe(1)
  })

  it('drops duplicate rows and reports the count', () => {
    const parsed = parseDelimited(
      'Fury 325\tCarowinds\nFury 325\tCarowinds\nfury 325\tcarowinds',
      'paste',
    )
    expect(parsed.rows).toEqual([{ name: 'Fury 325', park: 'Carowinds' }])
    expect(parsed.warnings.some((w) => w.includes('2 duplicate'))).toBe(true)
  })

  it('skips empty rows', () => {
    const parsed = parseDelimited('Fury 325\n\n   \nKingda Ka', 'paste')
    expect(parsed.rows.map((r) => r.name)).toEqual(['Fury 325', 'Kingda Ka'])
  })

  it('strips a BOM before parsing', () => {
    const parsed = parseDelimited('\uFEFFFury 325\nKingda Ka', 'file')
    expect(parsed.rows[0]?.name).toBe('Fury 325')
  })

  it('caps rows at MAX_IMPORT_ROWS with a warning', () => {
    const text = Array.from({ length: MAX_IMPORT_ROWS + 10 }, (_, i) => `Coaster ${i + 1}`).join(
      '\n',
    )
    const parsed = parseDelimited(text, 'file')
    expect(parsed.rows).toHaveLength(MAX_IMPORT_ROWS)
    expect(parsed.warnings.some((w) => w.includes('first 2000 rows'))).toBe(true)
  })

  it('throws ParseError with guidance on UTF-16 exports', () => {
    expect(() => parseDelimited('F\u0000u\u0000r\u0000y\u0000', 'file')).toThrow(ParseError)
  })

  it('throws ParseError for quote-broken CSV', () => {
    expect(() => parseDelimited('"Fury 325,Carowinds\nEl Toro,Unbalanced', 'file')).toThrow(
      ParseError,
    )
  })

  it('throws ParseError when no rows parse at all', () => {
    expect(() => parseDelimited('', 'paste')).toThrow(ParseError)
    expect(() => parseDelimited('\n\n\n', 'paste')).toThrow(ParseError)
    // Header-only: header labels establish the columns, the empty body yields
    // zero rows → the generic "no coaster names" error.
    expect(() => parseDelimited('Coaster,Park\n', 'file')).toThrow(/coaster names/)
  })

  it('throws ParseError when there is no usable name column', () => {
    expect(() => parseDelimited('1\n2\n3', 'paste')).toThrow(/coaster-name column/)
  })
})

describe('readFileAsText', () => {
  it('rejects oversized files before reading', async () => {
    const file = new File(['x'], 'big.csv')
    Object.defineProperty(file, 'size', { value: 6 * 1024 * 1024 })
    await expect(readFileAsText(file)).rejects.toThrow(/too large/)
  })

  it('rejects unsupported types with export guidance', async () => {
    const file = new File(['x'], 'list.xlsx')
    await expect(readFileAsText(file)).rejects.toThrow(/CSV/)
  })

  it('reads CSV/TSV/TXT files', async () => {
    for (const name of ['list.csv', 'list.tsv', 'list.txt']) {
      const file = new File(['Fury 325'], name)
      await expect(readFileAsText(file)).resolves.toBe('Fury 325')
    }
  })
})
