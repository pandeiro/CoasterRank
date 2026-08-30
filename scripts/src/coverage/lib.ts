import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { parse as parseCsv, type Options } from 'csv-parse/sync'
import { Pool } from 'pg'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = join(SCRIPT_DIR, '..', '..', '..')
export const COVERAGE_DIR = join(REPO_ROOT, 'data', 'coverage')
export const EXT_DIR = join(REPO_ROOT, 'data', 'ext')

dotenv.config({ path: join(REPO_ROOT, '.env') })

// ---------- text utils (mirrors import-coasters.ts slug semantics) ----------

export function slugify(input: string, fallback = 'unnamed'): string {
  const ascii = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || fallback
}

/** Normalized comparison key: ascii-fold, lowercase, & → and, drop "the", collapse non-alnum. */
export function normkey(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bthe\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Dice coefficient over character trigrams (0..1). */
export function trigramSim(a: string, b: string): number {
  const gram = (s: string): Map<string, number> => {
    const t = ` ${s.toLowerCase().replace(/\s+/g, ' ').trim()} `
    const m = new Map<string, number>()
    for (let i = 0; i < t.length - 2; i++) {
      const g = t.slice(i, i + 3)
      m.set(g, (m.get(g) ?? 0) + 1)
    }
    return m
  }
  if (a === b) return 1
  const ga = gram(a)
  const gb = gram(b)
  if (ga.size === 0 || gb.size === 0) return 0
  let inter = 0
  let totalA = 0
  let totalB = 0
  for (const n of ga.values()) totalA += n
  for (const n of gb.values()) totalB += n
  for (const [g, n] of ga) {
    const nb = gb.get(g)
    if (nb) inter += Math.min(n, nb)
  }
  return (2 * inter) / (totalA + totalB)
}

/** Strip importer disambiguation suffixes: "-1994", "-1994-2", "-x", "-x-3". */
export function baseCoasterSlug(slug: string): string {
  return slug.replace(/-(?:x|\d{4})(?:-\d+)?$/, '')
}

// ---------- data types ----------

export interface ParkRow {
  id: string
  name: string
  slug: string
  country: string | null
  region: string | null
  city: string | null
  lat: number | null
  lng: number | null
  source: string
}

export interface CoasterRow {
  id: string
  park_id: string
  name: string
  slug: string
  model: string | null
  opening_date: string | null
  status: string
  material: string
  manufacturer_id: string | null
  manufacturer_name: string | null
  source: string
  external_id: string | null
  height_m: number | null
  speed_kmh: number | null
  length_m: number | null
  inversions: number | null
}

export type CsvRow = Record<string, string>

export interface ListEntry {
  coaster: string
  park: string
  source: 'votecoasters-2024' | 'golden-ticket-steel-2025' | 'golden-ticket-wooden-2025'
  rank: number
}

// ---------- loaders ----------

export async function loadDb(): Promise<{
  parks: ParkRow[]
  coasters: CoasterRow[]
}> {
  const url = process.env.SUPABASE_DB_URL
  if (!url) throw new Error('SUPABASE_DB_URL is not set')
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } })
  try {
    const parksRes = await pool.query(`
      select p.id, p.name, p.slug, p.country, p.region, p.city, p.lat, p.lng, p.source,
             count(c.id)::int as coaster_count
      from parks p left join coasters c on c.park_id = p.id
      group by p.id order by p.name`)
    const coastersRes = await pool.query(`
      select c.id, c.park_id, c.name, c.slug, c.model, c.opening_date::text as opening_date,
             c.status::text as status, c.material::text as material, c.manufacturer_id,
             m.name as manufacturer_name, c.source, c.external_id,
             c.height_m, c.speed_kmh, c.length_m, c.inversions
      from coasters c left join manufacturers m on m.id = c.manufacturer_id
      order by c.name, c.opening_date nulls last`)
    return { parks: parksRes.rows, coasters: coastersRes.rows }
  } finally {
    await pool.end()
  }
}

const CSV_OPTS: Options = {
  columns: true,
  trim: true,
  skip_empty_lines: true,
  relax_column_count: true,
}

export function loadCsv(): CsvRow[] {
  const content = readFileSync(join(EXT_DIR, 'coaster_db.csv'), 'utf-8')
  return parseCsv(content, CSV_OPTS) as CsvRow[]
}

function htmlText(html: string): string[] {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map((l) => l.replace(/&amp;/g, '&').trim())
    .filter((l) => l.length > 0)
}

/** VoteCoasters 2024 top-500: repeating 8-field groups (No., Coaster, Park, Country, Maker, Material, Region, Year). */
export function loadVoteCoasters(): ListEntry[] {
  const lines = htmlText(readFileSync(join(EXT_DIR, 'votecoasters.2024.html'), 'utf-8'))
  const start = firstNumeric(lines, lines.findIndex((l) => l === 'No.') + 1)
  if (start === -1) throw new Error('votecoasters.2024.html: first data row not found')
  const out: ListEntry[] = []
  for (let i = start; i + 7 < lines.length; i += 8) {
    const rank = Number.parseInt(lines[i]!, 10)
    if (!Number.isFinite(rank)) break
    out.push({
      coaster: lines[i + 1]!,
      park: lines[i + 2]!,
      source: 'votecoasters-2024',
      rank,
    })
  }
  return out
}

/** Golden Tickets 2025: repeating 6-field groups (Rank, Name, Park, Location, Supplier, Year). */
export function loadGoldenTicket(kind: 'steel' | 'wooden'): ListEntry[] {
  const lines = htmlText(readFileSync(join(EXT_DIR, `golden.ticket.${kind}.2025.html`), 'utf-8'))
  const start = firstNumeric(lines, lines.findIndex((l) => l === 'Rank') + 1)
  if (start === -1) throw new Error(`golden.ticket.${kind}.2025.html: first data row not found`)
  const out: ListEntry[] = []
  for (let i = start; i + 5 < lines.length; i += 6) {
    const rank = Number.parseInt(lines[i]!, 10)
    if (!Number.isFinite(rank)) break
    out.push({
      coaster: lines[i + 1]!,
      park: lines[i + 2]!,
      source: kind === 'steel' ? 'golden-ticket-steel-2025' : 'golden-ticket-wooden-2025',
      rank,
    })
  }
  return out
}

function firstNumeric(lines: string[], from: number): number {
  for (let i = Math.max(0, from); i < lines.length; i++) {
    if (/^\d+$/.test(lines[i]!)) return i
  }
  return -1
}

export function loadJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(join(COVERAGE_DIR, file), 'utf-8')) as T
  } catch {
    return fallback
  }
}
