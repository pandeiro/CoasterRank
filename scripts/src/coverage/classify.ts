import {
  baseCoasterSlug,
  normkey,
  slugify,
  trigramSim,
  type CoasterRow,
  type CsvRow,
  type ParkRow,
} from './lib.js'

export type Confidence = 'high' | 'medium' | 'low'

export interface DecisionItem {
  id: string
  kind: 'orphan_rehome' | 'coaster_merge' | 'park_merge' | 'create_coaster' | 'info'
  action:
    | 'rehome'
    | 'create_park_and_rehome'
    | 'merge_coasters'
    | 'merge_parks'
    | 'create_coaster'
    | 'none'
    | 'review'
  title: string
  confidence: Confidence
  evidence: string[]
  recommendation: string
  payload: Record<string, unknown>
}

export interface OrphanResult {
  items: DecisionItem[]
  resolvedBySlug: number
  resolvedByCsv: number
  csvAmbiguous: number
  reviewCount: number
}

export interface DupResult {
  items: DecisionItem[]
  groupsExamined: number
}

const OTHER_SLUG = 'other'

function slugTokenContains(haystackSlug: string, needleSlug: string): boolean {
  if (needleSlug.length < 5) return false
  return (
    haystackSlug === needleSlug ||
    haystackSlug.startsWith(needleSlug + '-') ||
    haystackSlug.endsWith('-' + needleSlug) ||
    haystackSlug.includes('-' + needleSlug + '-')
  )
}

/** De-hyphenated containment for accents that slugify splits ("méxico" → "me-xico"); length-guarded. */
function slugSquashContains(haystackSlug: string, needleSlug: string): boolean {
  const needle = needleSlug.replace(/-/g, '')
  if (needle.length < 8) return false
  return haystackSlug.replace(/-/g, '').includes(needle)
}

function statsScore(c: CoasterRow): number {
  return (
    (c.height_m != null ? 1 : 0) +
    (c.speed_kmh != null ? 1 : 0) +
    (c.length_m != null ? 1 : 0) +
    (c.inversions != null ? 1 : 0) +
    (c.model ? 1 : 0) +
    (c.manufacturer_id ? 1 : 0)
  )
}

/** Deterministic survivor pick for merges: operating first, then data completeness, then earliest opening. */
export function pickSurvivor(rows: CoasterRow[]): CoasterRow {
  return [...rows].sort((a, b) => {
    const op = (s: CoasterRow): number =>
      s.status === 'operating' ? 0 : s.status === 'sbno' ? 1 : 2
    if (op(a) !== op(b)) return op(a) - op(b)
    if (statsScore(b) !== statsScore(a)) return statsScore(b) - statsScore(a)
    const da = a.opening_date ?? '9999'
    const db = b.opening_date ?? '9999'
    if (da !== db) return da < db ? -1 : 1
    return a.slug.localeCompare(b.slug)
  })[0]!
}

function fmtCoaster(c: CoasterRow, parkName: string): string {
  const bits = [
    c.opening_date ? c.opening_date.slice(0, 4) : '????',
    c.status,
    c.model ?? 'no model',
    c.manufacturer_name ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
  return `\`${c.name}\` (${c.slug}) — ${bits} — ext \`${c.external_id ?? '—'}\` [${parkName}]`
}

// ---------- orphan classification ----------

export function classifyOrphans(
  parks: ParkRow[],
  coasters: CoasterRow[],
  csvRows: CsvRow[],
): OrphanResult {
  const otherPark = parks.find((p) => p.slug === OTHER_SLUG)
  if (!otherPark)
    return { items: [], resolvedBySlug: 0, resolvedByCsv: 0, csvAmbiguous: 0, reviewCount: 0 }
  const realParks = parks.filter((p) => p.slug !== OTHER_SLUG)

  // Park-slug lookup for Attempt A (boundary-safe substring in the coaster-slug part of external_id).
  const parkBySlug = new Map(realParks.map((p) => [p.slug, p]))
  // Attempt B index: CSV rows at real parks by normkey(name) (+year, +model).
  const csvAtRealPark = csvRows
    .filter(
      (r) =>
        (r['Location'] ?? '').trim().toLowerCase() !== 'other' &&
        (r['Location'] ?? '').trim() !== '',
    )
    .map((r) => ({
      name: normkey(r['coaster_name'] ?? ''),
      year: (r['Opening date'] ?? '').match(/\d{4}/)?.[0] ?? '',
      model: normkey(r['Model'] ?? ''),
      park: (r['Location'] ?? '').trim(),
      parkSlug: slugify((r['Location'] ?? '').trim()),
    }))
    .filter((r) => r.name.length > 0)

  const orphans = coasters.filter((c) => c.park_id === otherPark.id)
  const items: DecisionItem[] = []
  let resolvedBySlug = 0
  let resolvedByCsv = 0
  let csvAmbiguous = 0
  let reviewCount = 0
  let seq = 0

  for (const c of orphans) {
    seq++
    const id = `ORPH-${String(seq).padStart(3, '0')}`
    const cslug = (c.external_id ?? '').split('@')[0] ?? ''
    const evidence: string[] = [`DB row: ${fmtCoaster(c, otherPark.name)}`]

    // Attempt A — original park name embedded in the (pre-normalization) coaster slug.
    const candidates = realParks
      .filter((p) => slugTokenContains(cslug, p.slug) || slugSquashContains(cslug, p.slug))
      .sort((a, b) => b.slug.length - a.slug.length)
    const target = candidates[0]

    if (target) {
      // Collision check: does the target park already have a same-named row? (It may have been
      // re-homed there by earlier curation, or be a generational namesake — e.g. two Big Dippers
      // at Luna Park Sydney, 1935 vs 2021.) Never auto-rehome into a collision.
      const collisions = coasters.filter(
        (x) => x.park_id === target.id && normkey(x.name) === normkey(c.name),
      )
      if (collisions.length > 0) {
        reviewCount++
        items.push({
          id,
          kind: 'orphan_rehome',
          action: 'review',
          confidence: 'medium',
          title: `Resolve collision: \`${c.name}\` → ${target.name} (target park already has ${collisions.length} same-name row(s))`,
          evidence: [
            ...evidence,
            `external_id slug \`${cslug}\` contains park slug \`${target.slug}\` (= ${target.name}).`,
            ...collisions.map((x) => `Target already has: ${fmtCoaster(x, target.name)}`),
            "Options: (a) MERGE this orphan into the existing row if they are the same physical ride (the existing row may itself have been re-homed here by earlier curation — check its source/external_id); (b) re-home with a disambiguating name override if they are distinct installations (e.g. generational namesakes like Luna Park Sydney's 1935 wooden Big Dipper vs the 2021 Intamin).",
          ],
          recommendation:
            'Decide merge vs. disambiguated re-home — set payload accordingly (merge_coasters with survivor_id = the existing row, or rehome with overrides.name).',
          payload: {
            coaster_id: c.id,
            coaster_name: c.name,
            from_park: OTHER_SLUG,
            to_park_slug: target.slug,
            to_park_id: target.id,
            collides_with: collisions.map((x) => x.id),
          },
        })
        continue
      }
      resolvedBySlug++
      items.push({
        id,
        kind: 'orphan_rehome',
        action: 'rehome',
        confidence: 'high',
        title: `Re-home \`${c.name}\` → ${target.name}`,
        evidence: [
          ...evidence,
          `external_id slug \`${cslug}\` contains park slug \`${target.slug}\` (= ${target.name}); the raw CSV name likely embedded the park before name normalization.`,
          target.city || target.country
            ? `Target park: ${[target.city, target.region, target.country].filter(Boolean).join(', ')}`
            : `Target park: ${target.name} (no geo in DB)`,
        ],
        recommendation: `Move to **${target.name}** (\`${target.slug}\`). Sanity-check the model/year against the park's known lineup.`,
        payload: {
          coaster_id: c.id,
          coaster_name: c.name,
          from_park: OTHER_SLUG,
          to_park_slug: target.slug,
          to_park_id: target.id,
        },
      })
      continue
    }

    // Attempt B — same normalized name in the CSV at real parks; year/model tighten the match.
    const nameKey = normkey(c.name)
    const year = c.opening_date?.slice(0, 4) ?? ''
    const modelKey = c.model ? normkey(c.model) : ''
    const nameHits = csvAtRealPark.filter((r) => r.name === nameKey)
    const strictHits = nameHits.filter(
      (r) =>
        (!year || !r.year || r.year === year) &&
        (!modelKey || !r.model || r.model.includes(modelKey) || modelKey.includes(r.model)),
    )
    const strictParks = [...new Set(strictHits.map((h) => h.park))]
    const looseParks = [...new Set(nameHits.map((h) => h.park))]
    if (looseParks.length > 1) csvAmbiguous++

    const pushCsvItem = (
      parks: string[],
      hits: typeof strictHits,
      confidence: Confidence,
    ): void => {
      const parkSlug = slugify(parks[0]!)
      const park = parkBySlug.get(parkSlug) ?? bestParkByName(realParks, parks[0]!)
      // Collision check (same rule as Attempt A): never auto-rehome onto an existing same-name row.
      const collisions = park
        ? coasters.filter((x) => x.park_id === park.id && normkey(x.name) === nameKey)
        : []
      if (collisions.length > 0) {
        reviewCount++
        items.push({
          id,
          kind: 'orphan_rehome',
          action: 'review',
          confidence: 'medium',
          title: `Resolve collision: \`${c.name}\` → ${parks[0]} (target park already has ${collisions.length} same-name row(s))`,
          evidence: [
            ...evidence,
            `CSV has ${hits.length} row(s) of \`${c.name}\` at real park **${parks[0]}**${hits[0]!.year ? ` (year ${hits[0]!.year})` : ''}.`,
            ...collisions.map(
              (x) => `Target already has: ${fmtCoaster(x, park?.name ?? parks[0]!)}`,
            ),
            'Options: merge if same physical ride, or disambiguated re-home if distinct installations.',
          ],
          recommendation: 'Decide merge vs. disambiguated re-home — set payload accordingly.',
          payload: {
            coaster_id: c.id,
            coaster_name: c.name,
            from_park: OTHER_SLUG,
            to_park_slug: parkSlug,
            to_park_name: parks[0]!,
            to_park_id: park?.id ?? null,
            collides_with: collisions.map((x) => x.id),
          },
        })
        return
      }
      resolvedByCsv++
      items.push({
        id,
        kind: 'orphan_rehome',
        action: park ? 'rehome' : 'create_park_and_rehome',
        confidence,
        title: `Re-home \`${c.name}\` → ${parks[0]}${park ? '' : ' (park missing from DB)'}`,
        evidence: [
          ...evidence,
          `CSV has ${hits.length} row(s) of \`${c.name}\` at real park **${parks[0]}**${hits[0]!.year ? ` (year ${hits[0]!.year})` : ''}; no other park matches${confidence === 'low' ? ' on name alone' : ' name+year+model'}.`,
        ],
        recommendation: park
          ? `Move to **${park.name}** (\`${park.slug}\`).`
          : `Create park **${parks[0]}** (\`${parkSlug}\`) and move there.`,
        payload: {
          coaster_id: c.id,
          coaster_name: c.name,
          from_park: OTHER_SLUG,
          to_park_slug: parkSlug,
          to_park_name: parks[0]!,
          to_park_id: park?.id ?? null,
        },
      })
    }

    if (strictParks.length === 1) {
      pushCsvItem(strictParks, strictHits, 'medium')
      continue
    }
    if (strictParks.length === 0 && looseParks.length === 1) {
      pushCsvItem(looseParks, nameHits, 'low')
      continue
    }

    reviewCount++
    const family = coasters.filter((x) => x.park_id !== otherPark.id && normkey(x.name) === nameKey)
    const familyLine = family.length
      ? `Same name exists at real parks: ${[...new Set(family.map((f) => `${f.name} @ ${parks.find((p) => p.id === f.park_id)?.name}`))].join(', ')}.`
      : 'No same-name row exists at any real park in the DB or CSV.'
    const looseLine = looseParks.length
      ? `CSV name matches exist at multiple parks (ambiguous): ${looseParks.join(', ')}.`
      : `CSV row (Location="Other") carries: status "${csvStatusFor(csvRows, cslug)}", no park hint.`
    items.push({
      id,
      kind: 'orphan_rehome',
      action: 'review',
      confidence: 'low',
      title: `Decide home for \`${c.name}\` (${c.model ?? 'unmodeled'})`,
      evidence: [
        ...evidence,
        `external_id slug \`${cslug}\` contains no known park slug.`,
        familyLine,
        looseLine,
      ],
      recommendation:
        'Needs identification — use the year/model above with an external source; the doc enrichment may carry cited candidates for well-known models.',
      payload: { coaster_id: c.id, coaster_name: c.name, from_park: OTHER_SLUG },
    })
  }

  return { items, resolvedBySlug, resolvedByCsv, csvAmbiguous, reviewCount }
}

function csvStatusFor(csvRows: CsvRow[], cslug: string): string {
  const row = csvRows.find((r) => slugify(r['coaster_name'] ?? '') === cslug)
  return row?.['Status'] ?? '?'
}

/** Trigram fallback for park lookup when the CSV-derived slug misses the DB. */
function bestParkByName(parks: ParkRow[], name: string): ParkRow | undefined {
  let best: { p: ParkRow; sim: number } | undefined
  for (const p of parks) {
    const sim = trigramSim(p.name, name)
    if (sim >= 0.8 && (!best || sim > best.sim)) best = { p, sim }
  }
  return best?.p
}

// ---------- same-park duplicate classification ----------

export function classifyCoasterDups(
  parks: ParkRow[],
  coasters: CoasterRow[],
): { items: DecisionItem[]; groupsExamined: number } {
  const parkById = new Map(parks.map((p) => [p.id, p]))
  const groups = new Map<string, CoasterRow[]>()
  for (const c of coasters) {
    const key = `${c.park_id}::${normkey(c.name)}`
    const g = groups.get(key)
    if (g) g.push(c)
    else groups.set(key, [c])
  }
  const dupGroups = [...groups.entries()].filter(([, rows]) => rows.length > 1)
  const items: DecisionItem[] = []
  let seq = 0

  for (const [, rows] of dupGroups) {
    seq++
    const id = `DUP-${String(seq).padStart(3, '0')}`
    const park = parkById.get(rows[0]!.park_id)!
    const parkLabel = park.slug === OTHER_SLUG ? `${park.name} (orphan bucket)` : park.name
    const baseSlugs = new Set(rows.map((r) => baseCoasterSlug(r.slug)))
    const evidence = rows.map((r) => fmtCoaster(r, parkLabel))
    const years = rows.map((r) => r.opening_date?.slice(0, 4) ?? '????')
    const models = new Set(rows.map((r) => normkey(r.model ?? '')))
    const distinctYears = new Set(years).size === rows.length

    let action: DecisionItem['action']
    let confidence: Confidence
    let recommendation: string

    if (baseSlugs.size === 1 && models.size <= 1 && rows.length === 2 && park.slug !== OTHER_SLUG) {
      action = 'merge_coasters'
      confidence = distinctYears || models.size === 1 ? 'high' : 'medium'
      recommendation =
        'Two rows, one CSV identity (same base slug; the importer appended year suffixes) with no model divergence. Treat as **one physical ride** listed twice (relocation or name change in the source data): merge into the survivor, keep the other name as an alias.'
    } else if (
      baseSlugs.size === 1 &&
      models.size <= 1 &&
      rows.length === 2 &&
      park.slug === OTHER_SLUG
    ) {
      action = 'merge_coasters'
      confidence = 'high'
      recommendation =
        'Same CSV identity inside the orphan bucket. Merge into the survivor **after** the re-home decision for this family (see the related ORPH items), keeping one row.'
    } else if (baseSlugs.size === 1 && models.size <= 1 && rows.length > 2) {
      action = 'review'
      confidence = 'low'
      recommendation = `Rows share one CSV base slug, but ${rows.length} rows with a single name is also the signature of **sister-park conflation** (e.g. identical-name clones at sister parks flattened to one Location by the source data — check the year suffixes in the slugs against the parks' real build years). Do NOT merge until verified; likely some rows need re-homing instead.`
    } else if (baseSlugs.size === 1 && models.size > 1) {
      action = 'review'
      confidence = 'low'
      recommendation = `Rows share a CSV base slug but differ in model (${[...models].join(' vs ')}) — the importer year-suffixes genuinely distinct same-name coasters too. Likely **distinct installations**: verify and keep both unless evidence says one is a relocation of the other.`
    } else if (models.size === 1 && [...models][0] !== '') {
      action = 'review'
      confidence = 'low'
      recommendation = `Rows share model "${rows[0]!.model}" but have distinct CSV identities. Could be genuinely distinct installations (e.g. clones at one park over time), relocations, or source-data noise — verify externally before merging.`
    } else {
      action = 'review'
      confidence = 'low'
      recommendation =
        'Same normalized name at one park with different models/unknown provenance. Could be distinct installations or a rename. Verify before merging.'
    }

    if (action === 'merge_coasters') {
      const survivor = pickSurvivor(rows)
      const losers = rows.filter((r) => r.id !== survivor.id)
      items.push({
        id,
        kind: 'coaster_merge',
        action,
        confidence,
        title: `Merge ${rows.length} rows of \`${rows[0]!.name}\` @ ${parkLabel}`,
        evidence,
        recommendation: `${recommendation} **Survivor: \`${survivor.name}\` (${survivor.slug})**; merge losers: ${losers.map((l) => `\`${l.slug}\``).join(', ')}. Any user_rides remap to the survivor (currently none exist).`,
        payload: {
          park_id: park.id,
          park_slug: park.slug,
          survivor_id: survivor.id,
          survivor_slug: survivor.slug,
          merge_ids: losers.map((l) => l.id),
          aliases: losers.map((l) => l.name).filter((n) => n !== survivor.name),
        },
      })
    } else {
      items.push({
        id,
        kind: 'coaster_merge',
        action,
        confidence,
        title: `Review ${rows.length} rows of \`${rows[0]!.name}\` @ ${parkLabel}`,
        evidence,
        recommendation,
        payload: { park_id: park.id, park_slug: park.slug, ids: rows.map((r) => r.id) },
      })
    }
  }
  return { items, groupsExamined: dupGroups.length }
}

// ---------- park duplicate classification ----------

export function classifyParkDups(parks: ParkRow[], coasters: CoasterRow[]): DupResult {
  const realParks = parks.filter((p) => p.slug !== OTHER_SLUG)
  const countByPark = new Map<string, number>()
  for (const c of coasters) countByPark.set(c.park_id, (countByPark.get(c.park_id) ?? 0) + 1)

  const items: DecisionItem[] = []
  const claimed = new Set<string>()
  let seq = 0

  // Pass 1: exact normalized-name equality.
  const byNorm = new Map<string, ParkRow[]>()
  for (const p of realParks) {
    const k = normkey(p.name)
    const g = byNorm.get(k)
    if (g) g.push(p)
    else byNorm.set(k, [p])
  }

  // Pass 2: near-identical names (trigram) not already grouped.
  const pairs: [ParkRow, ParkRow, number][] = []
  for (let i = 0; i < realParks.length; i++) {
    for (let j = i + 1; j < realParks.length; j++) {
      const a = realParks[i]!
      const b = realParks[j]!
      const sim = trigramSim(a.name, b.name)
      if (sim >= 0.84) pairs.push([a, b, sim])
    }
  }

  const groups: { rows: ParkRow[]; sims: string[] }[] = []
  for (const [, rows] of byNorm) if (rows.length > 1) groups.push({ rows, sims: ['normkey-equal'] })
  for (const [a, b, sim] of pairs) {
    const ga = groups.find((g) => g.rows.includes(a))
    const gb = groups.find((g) => g.rows.includes(b))
    if (ga && ga === gb) {
      ga.sims.push(`trgm ${sim.toFixed(2)}: ${a.name} ~ ${b.name}`)
      continue
    }
    if (ga) {
      if (!ga.rows.includes(b)) ga.rows.push(b)
      ga.sims.push(`trgm ${sim.toFixed(2)}: ${a.name} ~ ${b.name}`)
      continue
    }
    if (gb) {
      if (!gb.rows.includes(a)) gb.rows.push(a)
      gb.sims.push(`trgm ${sim.toFixed(2)}: ${a.name} ~ ${b.name}`)
      continue
    }
    groups.push({ rows: [a, b], sims: [`trgm ${sim.toFixed(2)}: ${a.name} ~ ${b.name}`] })
  }

  for (const g of groups) {
    if (g.rows.some((r) => claimed.has(r.id))) continue
    for (const r of g.rows) claimed.add(r.id)
    seq++
    const canonical = [...g.rows].sort((a, b) => {
      const ca = countByPark.get(a.id) ?? 0
      const cb = countByPark.get(b.id) ?? 0
      if (ca !== cb) return cb - ca
      const geo = (p: ParkRow): number => (p.lat != null ? 0 : 1)
      if (geo(a) !== geo(b)) return geo(a) - geo(b)
      return b.name.length - a.name.length
    })[0]!
    const losers = g.rows.filter((r) => r.id !== canonical.id)
    const remap = losers.reduce((n, l) => n + (countByPark.get(l.id) ?? 0), 0)
    items.push({
      id: `PARK-${String(seq).padStart(3, '0')}`,
      kind: 'park_merge',
      action: 'merge_parks',
      confidence: g.sims.some((s) => s === 'normkey-equal') ? 'high' : 'medium',
      title: `Merge parks: ${g.rows.map((r) => `\`${r.name}\``).join(' / ')}`,
      evidence: [
        ...g.rows.map(
          (r) =>
            `\`${r.name}\` (${r.slug}) — ${countByPark.get(r.id) ?? 0} coasters — ${[r.city, r.region, r.country].filter(Boolean).join(', ') || 'no geo'} — source ${r.source}`,
        ),
        ...g.sims.map((s) => `Match: ${s}`),
      ],
      recommendation: `Keep **${canonical.name}** (\`${canonical.slug}\`); remap ${remap} coaster row(s) from ${losers.map((l) => `\`${l.slug}\``).join(', ')}, then delete the loser park rows. Verify the parks are truly the same venue (watch for same-name parks in different regions).`,
      payload: {
        survivor_id: canonical.id,
        survivor_slug: canonical.slug,
        merge_ids: losers.map((l) => l.id),
        coaster_remap: remap,
      },
    })
  }
  return { items, groupsExamined: groups.length }
}
