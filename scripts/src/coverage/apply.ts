import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import {
  COVERAGE_DIR,
  REPO_ROOT,
  loadDb,
  normkey,
  poolConfig,
  slugify,
  trigramSim,
  type CoasterRow,
  type ParkRow,
} from './lib.js'
import type { DecisionItem } from './classify.js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))

const COASTER_STATUSES = [
  'operating',
  'defunct',
  'sbno',
  'under_construction',
  'relocated',
  'unknown',
]
const COASTER_MATERIALS = ['steel', 'wood', 'hybrid', 'other']

// ---------- types ----------

export interface DecisionRecord {
  id: string
  kind: DecisionItem['kind']
  action: DecisionItem['action']
  title: string
  decided: boolean
  /** true = hand-crafted payload authored outside the sweep; preserved verbatim on re-sweeps */
  crafted?: boolean
  payload: Record<string, unknown>
}

export interface DecisionsFile {
  schemaVersion: number
  note: string
  items: DecisionRecord[]
}

export interface SqlStatement {
  text: string
  params: unknown[]
  /** Exact rowCount assertion; null = do not assert (live count unknowable at plan time). */
  expectRows: number | null
}

export interface PlanOp {
  seq: number
  kind: 'merge_parks' | 'create_park' | 'rehome_coaster' | 'merge_coasters' | 'create_coaster'
  ref: string
  describe: string
  statements: SqlStatement[]
}

export interface PlanResult {
  ops: PlanOp[]
  warnings: string[]
  skipped: { id: string; reason: string }[]
}

interface Snapshot {
  parks: ParkRow[]
  coasters: CoasterRow[]
  manufacturers: { id: string; name: string }[]
}

interface Working {
  parksById: Map<string, ParkRow>
  parksBySlug: Map<string, ParkRow>
  coastersById: Map<string, CoasterRow>
  /** park id -> set of coaster slugs currently in that park (plan-local view) */
  slugsByPark: Map<string, Set<string>>
  otherParkId: string | undefined
}

interface Overrides {
  opening_date?: string
  status?: string
  name?: string
}

// ---------- helpers ----------

function asString(payload: Record<string, unknown>, key: string): string {
  const v = payload[key]
  if (typeof v !== 'string' || v.length === 0)
    throw new Error(`payload.${key} must be a non-empty string`)
  return v
}

function getOverrides(payload: Record<string, unknown>): Overrides {
  const o = payload['overrides']
  if (o == null) return {}
  if (typeof o !== 'object') throw new Error('payload.overrides must be an object')
  const out: Overrides = {}
  const rec = o as Record<string, unknown>
  if (rec['opening_date'] != null) {
    const d = String(rec['opening_date'])
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
      throw new Error(`overrides.opening_date must be YYYY-MM-DD, got "${d}"`)
    out.opening_date = d
  }
  if (rec['status'] != null) {
    const s = String(rec['status'])
    if (!COASTER_STATUSES.includes(s))
      throw new Error(`overrides.status must be one of ${COASTER_STATUSES.join('|')}`)
    out.status = s
  }
  if (rec['name'] != null) {
    const n = String(rec['name']).trim()
    if (!n) throw new Error('overrides.name must be a non-empty string')
    out.name = n
  }
  return out
}

/** Deterministic importer-style slug disambiguation against a park's current slug set. */
function disambiguateSlug(base: string, taken: Set<string>, year?: string | null): string {
  let slug = base
  if (!taken.has(slug)) return slug
  slug = `${base}-${year || 'x'}`
  if (!taken.has(slug)) return slug
  let n = 2
  while (taken.has(`${base}-${year || 'x'}-${n}`)) n++
  return `${base}-${year || 'x'}-${n}`
}

function findManufacturer(
  manufacturers: Snapshot['manufacturers'],
  suggested: string | null | undefined,
): { id: string | null; warning?: string } {
  if (!suggested) return { id: null }
  const target = normkey(suggested)
  if (!target) return { id: null }
  const exact = manufacturers.find((m) => normkey(m.name) === target)
  if (exact) return { id: exact.id }
  let best: { id: string; sim: number } | undefined
  for (const m of manufacturers) {
    const sim = trigramSim(m.name, suggested)
    if (sim > (best?.sim ?? 0)) best = { id: m.id, sim }
  }
  if (best && best.sim >= 0.9) return { id: best.id }
  return { id: null, warning: `manufacturer "${suggested}" not matched — leaving NULL for admin` }
}

function makeWorking(snap: Snapshot): Working {
  const parksById = new Map(snap.parks.map((p) => [p.id, p]))
  const parksBySlug = new Map(snap.parks.map((p) => [p.slug, p]))
  const coastersById = new Map(snap.coasters.map((c) => [c.id, c]))
  const slugsByPark = new Map<string, Set<string>>()
  for (const c of snap.coasters) {
    let s = slugsByPark.get(c.park_id)
    if (!s) slugsByPark.set(c.park_id, (s = new Set()))
    s.add(c.slug)
  }
  return {
    parksById,
    parksBySlug,
    coastersById,
    slugsByPark,
    otherParkId: snap.parks.find((p) => p.slug === 'other')?.id,
  }
}

// ---------- plan builder (pure) ----------

export function buildPlan(decisions: DecisionsFile, snap: Snapshot): PlanResult {
  const w = makeWorking(snap)
  const ops: PlanOp[] = []
  const warnings: string[] = []
  const skipped: { id: string; reason: string }[] = []
  let seq = 0

  const decided = decisions.items.filter((i) => i.decided)
  if (decided.length === 0) {
    warnings.push('No items are marked decided:true in decisions.json — nothing to plan.')
  }

  const byKind = (kinds: DecisionItem['kind'][]): DecisionRecord[] =>
    decided.filter((i) => kinds.includes(i.kind))

  // ---- 1. park merges ----
  for (const item of byKind(['park_merge'])) {
    if (item.action !== 'merge_parks') {
      skipped.push({ id: item.id, reason: `action ${item.action} — no plan op` })
      continue
    }
    try {
      const survivorId = asString(item.payload, 'survivor_id')
      const mergeIds = item.payload['merge_ids']
      if (!Array.isArray(mergeIds) || mergeIds.length === 0)
        throw new Error('payload.merge_ids must be a non-empty array')
      const survivor = w.parksById.get(survivorId)
      if (!survivor) throw new Error(`survivor park ${survivorId} not found (stale decision?)`)
      const statements: SqlStatement[] = []
      let remapTotal = 0
      for (const rawId of mergeIds) {
        const loserId = String(rawId)
        if (loserId === survivorId) throw new Error('survivor listed among merge_ids')
        const loser = w.parksById.get(loserId)
        if (!loser) throw new Error(`merge park ${loserId} not found (stale decision?)`)
        if (loser.slug === 'other') throw new Error('refusing to merge the Other bucket park')
        // slug collisions: rename loser's coasters that clash with survivor-park slugs
        const loserSlugs = w.slugsByPark.get(loserId) ?? new Set<string>()
        const survivorSlugs = w.slugsByPark.get(survivorId) ?? new Set<string>()
        const loserCoasters = [...w.coastersById.values()].filter((c) => c.park_id === loserId)
        for (const c of loserCoasters) {
          if (survivorSlugs.has(c.slug)) {
            const year = c.opening_date?.slice(0, 4) ?? null
            const newSlug = disambiguateSlug(c.slug, survivorSlugs, year)
            statements.push({
              text: 'update public.coasters set slug = $2 where id = $1 and park_id = $3',
              params: [c.id, newSlug, loserId],
              expectRows: 1,
            })
            loserSlugs.delete(c.slug)
            loserSlugs.add(newSlug)
            survivorSlugs.add(newSlug)
            warnings.push(
              `${item.id}: slug collision — renamed \`${c.slug}\` → \`${newSlug}\` during park merge`,
            )
          }
        }
        const remapCount =
          (w.slugsByPark.get(loserId) ?? new Set()).size === 0 ? 0 : loserCoasters.length
        remapTotal += remapCount
        statements.push({
          text: 'update public.coasters set park_id = $2 where park_id = $1',
          params: [loserId, survivorId],
          expectRows: remapCount,
        })
        statements.push({
          text: 'update public.coaster_submissions set park_id = $2 where park_id = $1',
          params: [loserId, survivorId],
          expectRows: null,
        })
        statements.push({
          text: 'delete from public.parks where id = $1',
          params: [loserId],
          expectRows: 1,
        })
        // working state
        for (const c of loserCoasters) c.park_id = survivorId
        const moved = w.slugsByPark.get(loserId) ?? new Set<string>()
        const target = w.slugsByPark.get(survivorId) ?? new Set<string>()
        for (const s of moved) target.add(s)
        w.slugsByPark.delete(loserId)
        w.parksById.delete(loserId)
        w.parksBySlug.delete(loser.slug)
      }
      ops.push({
        seq: ++seq,
        kind: 'merge_parks',
        ref: item.id,
        describe: `Merge parks into \`${survivor.name}\` (\`${survivor.slug}\`) — remap ${remapTotal} coaster(s), delete ${mergeIds.length} park row(s)`,
        statements,
      })
    } catch (err) {
      skipped.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  // ---- 2. re-homes (incl. park creation) ----
  for (const item of byKind(['orphan_rehome'])) {
    if (item.action === 'review' || item.action === 'none') {
      skipped.push({ id: item.id, reason: `action ${item.action} — no plan op` })
      continue
    }
    try {
      const coasterId = asString(item.payload, 'coaster_id')
      const coasterName = asString(item.payload, 'coaster_name')
      const coaster = w.coastersById.get(coasterId)
      if (!coaster) throw new Error(`coaster ${coasterId} not found (stale decision?)`)
      if (normkey(coaster.name) !== normkey(coasterName)) {
        throw new Error(
          `coaster ${coasterId} is now named \`${coaster.name}\`, decision expects \`${coasterName}\` (stale)`,
        )
      }
      // Fingerprint: the decision records where the row was when it was made.
      const fromParkSlug =
        typeof item.payload['from_park'] === 'string' ? (item.payload['from_park'] as string) : null
      if (fromParkSlug) {
        const fromPark = w.parksBySlug.get(fromParkSlug)
        if (!fromPark || coaster.park_id !== fromPark.id) {
          throw new Error(
            `coaster ${coasterId} is no longer at \`${fromParkSlug}\` (stale decision?)`,
          )
        }
      }
      const overrides = getOverrides(item.payload)

      let toParkSlug: string
      let toParkLabel: string
      let toParkWorkingId: string
      if (item.action === 'create_park_and_rehome') {
        const parkSlug = asString(item.payload, 'to_park_slug')
        const parkName =
          typeof item.payload['to_park_name'] === 'string'
            ? (item.payload['to_park_name'] as string)
            : parkSlug
        const existing = w.parksBySlug.get(parkSlug)
        if (existing) {
          warnings.push(
            `${item.id}: park \`${parkSlug}\` already exists — re-homing into it without creating`,
          )
          toParkWorkingId = existing.id
          toParkLabel = existing.name
        } else {
          ops.push({
            seq: ++seq,
            kind: 'create_park',
            ref: item.id,
            describe: `Create park \`${parkName}\` (\`${parkSlug}\`)`,
            statements: [
              {
                text: "insert into public.parks (slug, name, source) values ($1, $2, 'admin')",
                params: [parkSlug, parkName],
                expectRows: 1,
              },
            ],
          })
          const created: ParkRow = {
            id: `plan:${parkSlug}`,
            name: parkName,
            slug: parkSlug,
            country: null,
            region: null,
            city: null,
            lat: null,
            lng: null,
            source: 'admin',
          }
          w.parksById.set(created.id, created)
          w.parksBySlug.set(created.slug, created)
          w.slugsByPark.set(created.id, new Set())
          toParkWorkingId = created.id
          toParkLabel = parkName
        }
        toParkSlug = parkSlug
      } else {
        const slug = asString(item.payload, 'to_park_slug')
        const bySlug = w.parksBySlug.get(slug)
        const byId =
          typeof item.payload['to_park_id'] === 'string'
            ? w.parksById.get(item.payload['to_park_id'] as string)
            : undefined
        const target = bySlug ?? byId
        if (!target) throw new Error(`target park \`${slug}\` not found (stale decision?)`)
        if (byId && bySlug && byId.id !== bySlug.id) {
          throw new Error(
            `target park id/slug mismatch (${byId.slug} vs ${bySlug.slug}) — fix the decision payload`,
          )
        }
        toParkWorkingId = target.id
        toParkLabel = target.name
        toParkSlug = target.slug
      }

      const taken = w.slugsByPark.get(toParkWorkingId) ?? new Set<string>()
      const newSlug = disambiguateSlug(
        coaster.slug,
        taken,
        coaster.opening_date?.slice(0, 4) ?? null,
      )
      const setParts = ['park_id = (select id from public.parks where slug = $2)']
      const params: unknown[] = [coasterId, toParkSlug]
      if (newSlug !== coaster.slug) {
        setParts.push(`slug = $${params.length + 1}`)
        params.push(newSlug)
        warnings.push(
          `${item.id}: slug collision at target — renamed \`${coaster.slug}\` → \`${newSlug}\``,
        )
      }
      if (overrides.opening_date) {
        setParts.push(`opening_date = $${params.length + 1}`)
        params.push(overrides.opening_date)
      }
      if (overrides.status) {
        setParts.push(`status = $${params.length + 1}`)
        params.push(overrides.status)
      }
      const fromGuard = fromParkSlug
        ? ` and park_id = (select id from public.parks where slug = $${params.length + 1})`
        : ''
      if (fromParkSlug) params.push(fromParkSlug)
      const renamed = overrides.name != null && normkey(overrides.name) !== normkey(coaster.name)
      if (overrides.name) {
        setParts.push(`name = $${params.length + 1}`)
        params.push(overrides.name)
      }
      const statements: SqlStatement[] = [
        {
          text: `update public.coasters set ${setParts.join(', ')} where id = $1${fromGuard}`,
          params,
          expectRows: 1,
        },
      ]
      if (renamed) {
        // keep the pre-rename name discoverable by the board's alias search
        statements.push({
          text: `insert into public.coaster_aliases (coaster_id, name)
                 select $1, $2 where not exists (
                   select 1 from public.coaster_aliases where coaster_id = $1 and lower(name) = lower($2))`,
          params: [coasterId, coaster.name],
          expectRows: null,
        })
      }
      ops.push({
        seq: ++seq,
        kind: 'rehome_coaster',
        ref: item.id,
        describe: `Re-home \`${coaster.name}\` → ${toParkLabel}${newSlug !== coaster.slug ? ` (slug → \`${newSlug}\`)` : ''}${overrides.opening_date || overrides.status || overrides.name ? ` (overrides: ${[overrides.opening_date, overrides.status, overrides.name ? `name → \`${overrides.name}\`` : null].filter(Boolean).join(', ')})` : ''}`,
        statements,
      })
      // working state
      const fromSet = fromParkSlug
        ? w.slugsByPark.get(w.parksBySlug.get(fromParkSlug)?.id ?? '')
        : undefined
      fromSet?.delete(coaster.slug)
      taken.add(newSlug)
      coaster.park_id = toParkWorkingId
      if (newSlug !== coaster.slug) coaster.slug = newSlug
    } catch (err) {
      skipped.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  // ---- 3. coaster merges ----
  for (const item of byKind(['coaster_merge'])) {
    if (item.action !== 'merge_coasters') {
      skipped.push({ id: item.id, reason: `action ${item.action} — no plan op` })
      continue
    }
    try {
      const survivorId = asString(item.payload, 'survivor_id')
      const mergeIds = item.payload['merge_ids']
      if (!Array.isArray(mergeIds) || mergeIds.length === 0)
        throw new Error('payload.merge_ids must be a non-empty array')
      const survivor = w.coastersById.get(survivorId)
      if (!survivor) throw new Error(`survivor coaster ${survivorId} not found (stale decision?)`)
      const statements: SqlStatement[] = []
      const aliases = new Set<string>()
      for (const rawId of mergeIds) {
        const loserId = String(rawId)
        if (loserId === survivorId) throw new Error('survivor listed among merge_ids')
        const loser = w.coastersById.get(loserId)
        if (!loser) throw new Error(`merge coaster ${loserId} not found (stale decision?)`)
        // Cross-park merges are allowed deliberately (e.g. merging an Other-bucket orphan into an
        // existing row at its real park — the survivor's park wins). The decided item takes responsibility.
        // remap rides: copy non-conflicting rows to survivor, then drop the rest
        statements.push({
          text: `insert into public.user_rides (user_id, coaster_id, ridden, rank)
                 select user_id, $2, ridden, rank from public.user_rides where coaster_id = $1
                 on conflict (user_id, coaster_id) do nothing`,
          params: [loserId, survivorId],
          expectRows: null,
        })
        statements.push({
          text: 'delete from public.user_rides where coaster_id = $1',
          params: [loserId],
          expectRows: null,
        })
        statements.push({
          text: 'delete from public.coaster_ratings where coaster_id = $1',
          params: [loserId],
          expectRows: null,
        })
        if (normkey(loser.name) !== normkey(survivor.name)) aliases.add(loser.name)
        statements.push({
          text: 'delete from public.coasters where id = $1',
          params: [loserId],
          expectRows: 1,
        })
        w.slugsByPark.get(loser.park_id)?.delete(loser.slug)
        w.coastersById.delete(loserId)
      }
      const payloadAliases = item.payload['aliases']
      if (Array.isArray(payloadAliases)) {
        for (const a of payloadAliases)
          if (typeof a === 'string' && normkey(a) !== normkey(survivor.name)) aliases.add(a)
      }
      for (const alias of aliases) {
        statements.push({
          text: `insert into public.coaster_aliases (coaster_id, name)
                 select $1, $2 where not exists (
                   select 1 from public.coaster_aliases where coaster_id = $1 and lower(name) = lower($2))`,
          params: [survivorId, alias],
          expectRows: null,
        })
      }
      const overrides = getOverrides(item.payload)
      if (overrides.opening_date || overrides.status || overrides.name) {
        const setParts: string[] = []
        const params: unknown[] = [survivorId]
        if (overrides.opening_date) {
          setParts.push(`opening_date = $${params.length + 1}`)
          params.push(overrides.opening_date)
        }
        if (overrides.status) {
          setParts.push(`status = $${params.length + 1}`)
          params.push(overrides.status)
        }
        if (overrides.name) {
          setParts.push(`name = $${params.length + 1}`)
          params.push(overrides.name)
        }
        statements.push({
          text: `update public.coasters set ${setParts.join(', ')} where id = $1`,
          params,
          expectRows: 1,
        })
      }
      ops.push({
        seq: ++seq,
        kind: 'merge_coasters',
        ref: item.id,
        describe: `Merge into \`${survivor.name}\` (\`${survivor.slug}\`) — delete ${mergeIds.length} row(s)${aliases.size ? `, aliases: ${[...aliases].map((a) => `\`${a}\``).join(', ')}` : ''}`,
        statements,
      })
    } catch (err) {
      skipped.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  // ---- 4. creations ----
  for (const item of byKind(['create_coaster'])) {
    if (item.action !== 'create_coaster') {
      skipped.push({ id: item.id, reason: `action ${item.action} — no plan op` })
      continue
    }
    try {
      const name = asString(item.payload, 'name')
      const status = asString(item.payload, 'status')
      if (!COASTER_STATUSES.includes(status))
        throw new Error(`payload.status must be one of ${COASTER_STATUSES.join('|')}`)
      const material =
        typeof item.payload['material'] === 'string'
          ? (item.payload['material'] as string)
          : 'other'
      if (!COASTER_MATERIALS.includes(material))
        throw new Error(`payload.material must be one of ${COASTER_MATERIALS.join('|')}`)
      const openingYear =
        typeof item.payload['opening_year'] === 'string'
          ? (item.payload['opening_year'] as string)
          : null
      if (openingYear && !/^\d{4}$/.test(openingYear))
        throw new Error(`payload.opening_year must be YYYY, got "${openingYear}"`)
      const parkSlug = asString(item.payload, 'park_slug')
      const parkName =
        typeof item.payload['park_name'] === 'string'
          ? (item.payload['park_name'] as string)
          : parkSlug

      // still-missing check (plan-local view)
      let targetPark = w.parksBySlug.get(parkSlug)
      if (!targetPark && item.payload['park_create'] !== true) {
        throw new Error(
          `park \`${parkSlug}\` not found and payload.park_create is false — mark park_create or fix payload`,
        )
      }
      const statements: SqlStatement[] = []
      if (!targetPark) {
        ops.push({
          seq: ++seq,
          kind: 'create_park',
          ref: item.id,
          describe: `Create park \`${parkName}\` (\`${parkSlug}\`)`,
          statements: [
            {
              text: "insert into public.parks (slug, name, source) values ($1, $2, 'admin')",
              params: [parkSlug, parkName],
              expectRows: 1,
            },
          ],
        })
        const created: ParkRow = {
          id: `plan:${parkSlug}`,
          name: parkName,
          slug: parkSlug,
          country: null,
          region: null,
          city: null,
          lat: null,
          lng: null,
          source: 'admin',
        }
        w.parksById.set(created.id, created)
        w.parksBySlug.set(created.slug, created)
        w.slugsByPark.set(created.id, new Set())
        targetPark = created
        warnings.push(
          `${item.id}: park \`${parkSlug}\` does not exist and park_create=true — will be created as \`${parkName}\``,
        )
      } else if (item.payload['park_create'] === true) {
        warnings.push(`${item.id}: park \`${parkSlug}\` already exists — creating coaster only`)
      }
      const targetSlugs = w.slugsByPark.get(targetPark.id) ?? new Set<string>()
      const existingSameName = [...w.coastersById.values()].find(
        (c) => c.park_id === targetPark!.id && normkey(c.name) === normkey(name),
      )
      if (existingSameName) {
        skipped.push({
          id: item.id,
          reason: `coaster \`${existingSameName.name}\` already exists at \`${targetPark.slug}\` — skipping creation`,
        })
        continue
      }
      const manuf = findManufacturer(
        snap.manufacturers,
        typeof item.payload['suggested_manufacturer'] === 'string'
          ? (item.payload['suggested_manufacturer'] as string)
          : null,
      )
      if (manuf.warning) warnings.push(`${item.id}: ${manuf.warning}`)
      const slug = disambiguateSlug(slugify(name), targetSlugs, openingYear)
      statements.push({
        text: `insert into public.coasters (park_id, name, slug, manufacturer_id, model, opening_date, status, material, source)
               values ((select id from public.parks where slug = $1), $2, $3, $4, null, $5, $6, $7, 'admin')`,
        params: [
          targetPark.slug,
          name,
          slug,
          manuf.id,
          openingYear ? `${openingYear}-01-01` : null,
          status,
          material,
        ],
        expectRows: 1,
      })
      const createdCoaster: CoasterRow = {
        id: `plan:${slug}@${targetPark.slug}`,
        park_id: targetPark.id,
        name,
        slug,
        model: null,
        opening_date: openingYear ? `${openingYear}-01-01` : null,
        status,
        material,
        manufacturer_id: manuf.id,
        manufacturer_name: null,
        source: 'admin',
        external_id: null,
        height_m: null,
        speed_kmh: null,
        length_m: null,
        inversions: null,
      }
      w.coastersById.set(createdCoaster.id, createdCoaster)
      targetSlugs.add(slug)
      ops.push({
        seq: ++seq,
        kind: 'create_coaster',
        ref: item.id,
        describe: `Create \`${name}\` @ \`${targetPark.name}\` (slug \`${slug}\`, ${status}, ${material}${openingYear ? `, ${openingYear}` : ''})`,
        statements,
      })
    } catch (err) {
      skipped.push({ id: item.id, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  // pending (undecided) items are not "skipped" — they are simply waiting
  const pending = decisions.items.length - decided.length
  if (pending > 0) warnings.push(`${pending} item(s) not yet decided — ignored by this plan`)

  return { ops, warnings, skipped }
}

// ---------- executor ----------

export interface ExecResult {
  opResults: { seq: number; ref: string; describe: string; rows: (number | null)[] }[]
  ok: boolean
  error?: string
}

export async function executePlan(pool: Pool, plan: PlanResult): Promise<ExecResult> {
  const client = await pool.connect()
  const opResults: ExecResult['opResults'] = []
  try {
    await client.query('begin')
    for (const op of plan.ops) {
      const rows: (number | null)[] = []
      for (const st of op.statements) {
        const res = await client.query(st.text, st.params)
        if (st.expectRows != null && res.rowCount !== st.expectRows) {
          throw new Error(
            `op #${op.seq} (${op.ref}): expected ${st.expectRows} affected row(s), got ${res.rowCount} — statement: ${st.text.replace(/\s+/g, ' ').slice(0, 120)}`,
          )
        }
        rows.push(res.rowCount)
      }
      opResults.push({ seq: op.seq, ref: op.ref, describe: op.describe, rows })
    }
    await client.query('commit')
    return { opResults, ok: true }
  } catch (err) {
    try {
      await client.query('rollback')
    } catch {
      /* ignore */
    }
    return { opResults, ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    client.release()
  }
}

export async function loadApplySnapshot(): Promise<Snapshot> {
  const { parks, coasters } = await loadDb()
  const url = process.env.SUPABASE_DB_URL
  if (!url) throw new Error('SUPABASE_DB_URL is not set')
  const pool = new Pool(poolConfig(url))
  try {
    const m = await pool.query('select id, name from public.manufacturers order by name')
    return { parks, coasters, manufacturers: m.rows }
  } finally {
    await pool.end()
  }
}

function fmtPlan(plan: PlanResult): string {
  const lines: string[] = []
  lines.push(`Plan: ${plan.ops.length} op(s)`)
  for (const op of plan.ops) {
    lines.push(
      `  #${op.seq} [${op.kind}] (${op.ref}) ${op.describe} — ${op.statements.length} statement(s)`,
    )
  }
  for (const s of plan.skipped) lines.push(`  SKIPPED ${s.id}: ${s.reason}`)
  for (const w of plan.warnings) lines.push(`  NOTE ${w}`)
  return lines.join('\n')
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const yes = args.includes('--yes')
  const decisionsIdx = args.indexOf('--decisions')
  const decisionsArg = decisionsIdx >= 0 ? args[decisionsIdx + 1] : undefined
  const decisionsPath = decisionsArg
    ? resolve(decisionsArg.startsWith('/') ? decisionsArg : join(REPO_ROOT, decisionsArg))
    : join(COVERAGE_DIR, 'decisions.json')

  console.log('Loading decisions from', decisionsPath.replace(REPO_ROOT, ''))
  const decisions = JSON.parse(readFileSync(decisionsPath, 'utf-8')) as DecisionsFile

  console.log('Loading live snapshot (read-only)...')
  const snap = await loadApplySnapshot()
  console.log(
    `  parks: ${snap.parks.length}, coasters: ${snap.coasters.length}, manufacturers: ${snap.manufacturers.length}`,
  )

  const plan = buildPlan(decisions, snap)
  console.log(fmtPlan(plan))

  if (!apply) {
    console.log(
      `\nDRY-RUN: no writes performed. Re-run with --apply --yes to execute ${plan.ops.length} op(s).`,
    )
    return
  }
  if (plan.ops.length === 0) {
    console.error('\nNothing to apply (no decided items produced plan ops).')
    process.exit(1)
  }
  if (!yes) {
    console.error('\nRefusing to write: --apply requires --yes.')
    process.exit(1)
  }

  const url = process.env.SUPABASE_DB_URL
  if (!url) throw new Error('SUPABASE_DB_URL is not set')
  const pool = new Pool(poolConfig(url))
  try {
    console.log(`\nExecuting ${plan.ops.length} op(s) in a single transaction...`)
    const result = await executePlan(pool, plan)
    if (!result.ok) {
      console.error('\nAPPLY FAILED — transaction rolled back. Error:', result.error)
      process.exit(1)
    }
    for (const r of result.opResults) {
      console.log(`  ✓ #${r.seq} (${r.ref}) ${r.describe}`)
    }
    const logPath = join(COVERAGE_DIR, `apply-log-${new Date().toISOString().slice(0, 10)}.md`)
    const log = [
      `# Apply log — ${new Date().toISOString()}`,
      '',
      `${result.opResults.length} op(s) executed against the live DB in one transaction.`,
      '',
      ...result.opResults.map((r) => `- #${r.seq} (${r.ref}) ${r.describe}`),
      '',
    ].join('\n')
    writeFileSync(logPath, log)
    console.log(
      `\nDone. Audit log: ${logPath.replace(REPO_ROOT, '')} (gitignored). Re-run coverage:sweep + coverage:doc for a fresh baseline.`,
    )
  } finally {
    await pool.end()
  }
}

const isDirectRun = process.argv[1]?.endsWith('apply.ts')
if (isDirectRun) {
  main().catch((err) => {
    console.error('Apply failed:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
