import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { parse as parseCsv } from 'csv-parse/sync'
import { Pool } from 'pg'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(SCRIPT_DIR, '..', '.env') })

const DB_URL = process.env.SUPABASE_DB_URL
const APPLY = process.argv.includes('--apply')
const CSV_PATH = resolve(SCRIPT_DIR, '..', firstPositionalArg() ?? 'data/coaster_db.csv')

type CoastStatus = 'operating' | 'defunct' | 'sbno' | 'under_construction' | 'relocated' | 'unknown'

type CoastMaterial = 'steel' | 'wood' | 'hybrid' | 'other'

type RawRow = Record<string, string>

interface Manufacturer {
  slug: string
  name: string
}

interface Park {
  slug: string
  name: string
  lat: number | null
  lng: number | null
}

interface Coaster {
  parkSlug: string
  name: string
  slug: string
  manufacturerSlug: string | null
  model: string | null
  openingDate: string | null
  status: CoastStatus
  material: CoastMaterial
  type: string | null
  heightM: number | null
  speedKmh: number | null
  lengthM: number | null
  inversions: number | null
  externalId: string
}

function firstPositionalArg(): string | undefined {
  for (const a of process.argv.slice(2)) {
    if (!a.startsWith('-')) return a
  }
  return undefined
}

function col(row: RawRow, name: string): string {
  const v = row[name]
  if (v == null) return ''
  return String(v).trim()
}

function slugify(input: string, fallback = 'unnamed'): string {
  const ascii = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii || fallback
}

function toNum(s: string): number | null {
  if (!s) return null
  const n = Number(s.replace(',', ''))
  return Number.isFinite(n) ? n : null
}

function toInt(s: string): number | null {
  if (!s) return null
  const n = Math.round(Number(s))
  return Number.isFinite(n) ? n : null
}

function normalizeSpace(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function mapMaterial(typeMain: string): CoastMaterial {
  const v = typeMain.toLowerCase()
  if (v === 'steel') return 'steel'
  if (v === 'wood') return 'wood'
  if (v === 'hybrid') return 'hybrid'
  return 'other'
}

function mapStatus(raw: string): CoastStatus {
  const v = normalizeSpace(raw).toLowerCase()
  if (!v) return 'unknown'
  if (v === 'operating') return 'operating'
  if (v === 'under construction' || v === 'in production') return 'under_construction'
  if (v === 'removed' || v === 'discontinued' || v.includes('bankruptcy')) return 'defunct'
  if (v.startsWith('sbno') || v.includes('not currently operating')) return 'sbno'
  if (v.includes('closed') || v.includes('temporarily') || v.includes('maintenance')) return 'sbno'
  return 'unknown'
}

function parseLength(raw: string): number | null {
  const s = normalizeSpace(raw)
  if (!s) return null
  const m = s.match(/\(([\d.,]+)\s*m\)/)
  if (m) {
    const n = Number(m[1]!.replace(/,/g, ''))
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
  }
  const f = s.match(/([\d.,]+)\s*ft/)
  if (f) {
    const n = Number(f[1]!.replace(/,/g, ''))
    return Number.isFinite(n) ? Math.round(n * 0.3048 * 100) / 100 : null
  }
  return null
}

function parseHeight(value: string, unit: string): number | null {
  const v = toNum(value)
  if (v == null) return null
  const u = normalizeSpace(unit).toLowerCase()
  if (u === 'ft') return Math.round(v * 0.3048 * 100) / 100
  if (u === 'm') return Math.round(v * 100) / 100
  return null
}

function parseSpeed(speed1Value: string, speed1Unit: string, speedMphRaw: string): number | null {
  const v = toNum(speed1Value)
  const u = normalizeSpace(speed1Unit).toLowerCase()
  if (v != null) {
    if (u === 'km/h') return Math.round(v * 100) / 100
    if (u === 'mph') return Math.round(v * 1.60934 * 100) / 100
  }
  const mph = toNum(speedMphRaw)
  if (mph != null) return Math.round(mph * 1.60934 * 100) / 100
  return null
}

function parseOpeningDate(clean: string, year: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean
  const y = toInt(year)
  if (y != null && y >= 1800 && y <= 2100) return `${y}-01-01`
  return null
}

function readRows(): RawRow[] {
  const content = readFileSync(CSV_PATH, 'utf-8')
  const records = parseCsv(content, {
    columns: true,
    trim: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as RawRow[]
  return records.filter((r) => col(r, 'coaster_name') || col(r, 'Location'))
}

function buildModel(rows: RawRow[]): {
  manufacturers: Map<string, Manufacturer>
  parks: Map<string, Park>
  coasters: Coaster[]
  otherParkCount: number
  skipped: number
} {
  const manufacturers = new Map<string, Manufacturer>()
  const parks = new Map<string, Park>()
  const coasters: Coaster[] = []
  let otherParkCount = 0
  let skipped = 0

  const slugGroups = new Map<string, Set<string>>()
  const pickCoasterSlug = (parkSlug: string, base: string, year: string): string => {
    let slug = base
    const key = `${parkSlug}__${base}`
    let used = slugGroups.get(key)
    if (!used) {
      used = new Set<string>()
      slugGroups.set(key, used)
    }
    if (used.has(slug)) {
      slug = `${base}-${year || 'x'}`
      if (used.has(slug)) {
        slug = `${base}-${year || 'x'}-${used.size}`
      }
    }
    used.add(slug)
    return slug
  }

  for (const r of rows) {
    const name = col(r, 'coaster_name')
    const locationName = col(r, 'Location')
    if (!name && !locationName) {
      skipped++
      continue
    }
    const parkSlug = slugify(locationName, 'other') || 'other'
    const baseSlag = slugify(name) || 'unnamed'
    const year = col(r, 'year_introduced')
    const coasterSlug = pickCoasterSlug(parkSlug, baseSlag, year)
    const manufRaw = col(r, 'Manufacturer')
    const manufSlug = manufRaw ? slugify(manufRaw) : null

    if (manufSlug && !manufacturers.has(manufSlug)) {
      manufacturers.set(manufSlug, { slug: manufSlug, name: normalizeSpace(manufRaw) })
    }
    if (!parks.has(parkSlug)) {
      const isBucket = parkSlug === 'other'
      const lat = isBucket ? null : toNum(col(r, 'latitude'))
      const lng = isBucket ? null : toNum(col(r, 'longitude'))
      parks.set(parkSlug, {
        slug: parkSlug,
        name: isBucket ? 'Other (unknown location)' : normalizeSpace(locationName) || 'Other',
        lat: lat != null && lat >= -90 && lat <= 90 ? lat : null,
        lng: lng != null && lng >= -180 && lng <= 180 ? lng : null,
      })
    }
    if (parkSlug === 'other') otherParkCount++

    const lengthM = parseLength(col(r, 'Length'))
    const heightM = parseHeight(col(r, 'height_value'), col(r, 'height_unit'))
    const speedKmh = parseSpeed(col(r, 'speed1_value'), col(r, 'speed1_unit'), col(r, 'speed_mph'))
    const typeRaw = normalizeSpace(col(r, 'Type'))

    coasters.push({
      parkSlug,
      name: normalizeSpace(name) || baseSlag,
      slug: coasterSlug,
      manufacturerSlug: manufSlug,
      model: col(r, 'Model') || null,
      openingDate: parseOpeningDate(col(r, 'opening_date_clean'), year),
      status: mapStatus(col(r, 'Status')),
      material: mapMaterial(col(r, 'Type_Main')),
      type: typeRaw || null,
      heightM,
      speedKmh,
      lengthM,
      inversions: toInt(col(r, 'Inversions_clean')),
      externalId: `${coasterSlug}@${parkSlug}`,
    })
  }

  const seenKeys = new Set<string>()
  for (const c of coasters) {
    const key = `${c.parkSlug}__${c.slug}`
    if (seenKeys.has(key)) {
      throw new Error(
        `Slug collision within park: ${key} (name=${c.name}). ` +
          'Disambiguation logic needs adjustment for this dataset.',
      )
    }
    seenKeys.add(key)
  }

  return { manufacturers, parks, coasters, otherParkCount, skipped }
}

function summarize(m: ReturnType<typeof buildModel>, rows: RawRow[]): void {
  const statusDist = new Map<string, number>()
  const materialDist = new Map<string, number>()
  for (const c of m.coasters) {
    statusDist.set(c.status, (statusDist.get(c.status) ?? 0) + 1)
    materialDist.set(c.material, (materialDist.get(c.material) ?? 0) + 1)
  }
  const withGeo = Array.from(m.parks.values()).filter((p) => p.lat != null).length
  console.log('CSV rows parsed:', rows.length)
  console.log('  skipped (empty):', m.skipped)
  console.log('manufacturers:', m.manufacturers.size)
  console.log('parks:', m.parks.size, '(with lat/lng:', withGeo + ')')
  console.log('coasters:', m.coasters.length)
  console.log('  in "other" park (location unknown):', m.otherParkCount)
  console.log('  by status:', Object.fromEntries(statusDist))
  console.log('  by material:', Object.fromEntries(materialDist))
}

async function apply(m: ReturnType<typeof buildModel>): Promise<void> {
  if (!DB_URL) {
    console.error('\nERROR: SUPABASE_DB_URL is not set in .env')
    process.exit(1)
  }
  const pool = new Pool({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
  const client = await pool.connect()
  try {
    await client.query('select 1')
    console.log('\nConnected to', DB_URL.replace(/:[^:@/]+@/, ':***@'))
    await client.query('begin')

    const manufSlugs = Array.from(m.manufacturers.keys())
    const manufRows = Array.from(m.manufacturers.values())
    if (manufRows.length) {
      const manufParams = manufRows.map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2})`).join(', ')
      await client.query(
        `insert into public.manufacturers (slug, name)
         values ${manufParams}
         on conflict (slug) do update set name = excluded.name`,
        manufRows.flatMap((x) => [x.slug, x.name]),
      )
    }
    const manufIdRes = await client.query(
      'select id, slug from public.manufacturers where slug = any($1::text[])',
      [manufSlugs],
    )
    const manufIdBySlug = new Map<string, string>()
    for (const row of manufIdRes.rows) manufIdBySlug.set(row.slug, row.id)

    const parkRows = Array.from(m.parks.values())
    const parkSlugs = parkRows.map((p) => p.slug)
    if (parkRows.length) {
      const parkParams = parkRows
        .map(
          (_, i) =>
            `($${i * 6 + 1}, $${i * 6 + 2}, $${i * 6 + 3}, $${i * 6 + 4}, $${i * 6 + 5}, $${i * 6 + 6})`,
        )
        .join(', ')
      await client.query(
        `insert into public.parks (slug, name, lat, lng, source, external_id)
         values ${parkParams}
         on conflict (slug) do update set
           name = excluded.name,
           lat = excluded.lat,
           lng = excluded.lng,
           external_id = excluded.external_id
         where public.parks.source = 'open-csv'`,
        parkRows.flatMap((p) => [p.slug, p.name, p.lat, p.lng, 'open-csv', p.slug]),
      )
    }
    const parkIdRes = await client.query(
      'select id, slug from public.parks where slug = any($1::text[])',
      [parkSlugs],
    )
    const parkIdBySlug = new Map<string, string>()
    for (const row of parkIdRes.rows) parkIdBySlug.set(row.slug, row.id)

    const cols = 15
    const batchSize = 200
    let inserted = 0
    let updated = 0
    for (let i = 0; i < m.coasters.length; i += batchSize) {
      const batch = m.coasters.slice(i, i + batchSize)
      const valuesSql = batch
        .map(
          (_, r) =>
            `($${r * cols + 1}, $${r * cols + 2}, $${r * cols + 3}, $${r * cols + 4}, $${r * cols + 5}, $${r * cols + 6}, $${r * cols + 7}, $${r * cols + 8}, $${r * cols + 9}, $${r * cols + 10}, $${r * cols + 11}, $${r * cols + 12}, $${r * cols + 13}, $${r * cols + 14}, $${r * cols + 15})`,
        )
        .join(', ')
      const params: (string | number | null)[] = []
      for (const c of batch) {
        const park = parkIdBySlug.get(c.parkSlug)
        if (!park) throw new Error(`Missing park id for slug ${c.parkSlug}`)
        const manuf = c.manufacturerSlug ? (manufIdBySlug.get(c.manufacturerSlug) ?? null) : null
        params.push(
          park,
          c.name,
          c.slug,
          manuf,
          c.model,
          c.openingDate,
          c.status,
          c.material,
          c.heightM,
          c.speedKmh,
          c.lengthM,
          c.inversions,
          c.type,
          'open-csv',
          c.externalId,
        )
      }
      const res = await client.query<{ inserted: boolean }>(
        `insert into public.coasters (
           park_id, name, slug, manufacturer_id, model, opening_date, status, material,
           height_m, speed_kmh, length_m, inversions, type, source, external_id
         ) values ${valuesSql}
         on conflict (park_id, slug) do update set
           name = excluded.name,
           manufacturer_id = excluded.manufacturer_id,
           model = excluded.model,
           opening_date = excluded.opening_date,
           status = excluded.status,
           material = excluded.material,
           height_m = excluded.height_m,
           speed_kmh = excluded.speed_kmh,
           length_m = excluded.length_m,
           inversions = excluded.inversions,
           type = excluded.type,
           external_id = excluded.external_id
         where public.coasters.source = 'open-csv'
         returning (xmax = 0) as inserted`,
        params,
      )
      for (const row of res.rows) {
        if (row.inserted) inserted++
        else updated++
      }
    }

    await client.query('commit')

    const verifyMfg = await client.query('select count(*)::int as n from public.manufacturers')
    const verifyPark = await client.query(
      "select count(*)::int as n from public.parks where source = 'open-csv'",
    )
    const verifyCoaster = await client.query(
      "select count(*)::int as n from public.coasters where source = 'open-csv'",
    )

    console.log('\nWritten this run:')
    console.log('  coasters inserted:', inserted)
    console.log(
      '  coasters updated:',
      updated,
      '(skipped non-csv:',
      m.coasters.length - inserted - updated + ')',
    )
    console.log('\nVerified totals (open-csv):')
    console.log('  manufacturers:', verifyMfg.rows[0].n)
    console.log('  parks:        ', verifyPark.rows[0].n)
    console.log('  coasters:     ', verifyCoaster.rows[0].n)
  } catch (err) {
    try {
      await client.query('rollback')
    } catch {
      /* ignore */
    }
    throw err
  } finally {
    client.release()
    await pool.end()
  }
}

async function main(): Promise<void> {
  console.log('CoasterRank CSV import')
  console.log('  csv:  ', CSV_PATH)
  console.log('  mode: ', APPLY ? 'APPLY (write to DB)' : 'DRY-RUN (no DB connection)')

  const rows = readRows()
  const model = buildModel(rows)
  summarize(model, rows)

  if (!APPLY) {
    console.log('\nDry-run complete. Re-run with --apply to write to the database.')
    return
  }
  await apply(model)
}

main().catch((err) => {
  console.error('\nImport failed:', err instanceof Error ? err.message : err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
