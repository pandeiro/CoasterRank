import {
  normkey,
  slugify,
  trigramSim,
  type CoasterRow,
  type ListEntry,
  type ParkRow,
} from './lib.js'

export interface MissItem {
  id: string
  entry: ListEntry
  cls:
    | 'covered_exact'
    | 'covered_fuzzy'
    | 'found_elsewhere'
    | 'coaster_missing'
    | 'park_and_coaster_missing'
  parkMatch: { name: string; slug: string; sim: number; how: string } | null
  coasterMatch: { name: string; park: string; sim: number } | null
  note: string
}

export interface MissResult {
  items: MissItem[]
  missItems: MissItem[]
  coveragePct: string
}

interface Match<A> {
  value: A
  sim: number
  how: string
}

function best<A>(
  haystacks: A[],
  name: (a: A) => string,
  target: string,
  floor: number,
): Match<A> | null {
  const tk = normkey(target)
  let bestMatch: Match<A> | null = null
  for (const h of haystacks) {
    const hn = name(h)
    if (normkey(hn) === tk) {
      return { value: h, sim: 1, how: 'normalized-exact' }
    }
    const sim = trigramSim(hn, target)
    if (sim >= floor && (!bestMatch || sim > bestMatch.sim)) {
      bestMatch = { value: h, sim, how: 'trigram' }
    }
  }
  return bestMatch
}

export function matchCoverage(
  entries: ListEntry[],
  parks: ParkRow[],
  coasters: CoasterRow[],
  parkAliases: Record<string, string>,
): MissResult {
  const otherPark = parks.find((p) => p.slug === 'other')
  const realParks = parks.filter((p) => p.slug !== 'other')
  const coastersByPark = new Map<string, CoasterRow[]>()
  for (const c of coasters) {
    const g = coastersByPark.get(c.park_id)
    if (g) g.push(c)
    else coastersByPark.set(c.park_id, [c])
  }
  const items: MissItem[] = []
  let seq = 0

  for (const entry of entries) {
    seq++
    const id = `MISS-${String(seq).padStart(3, '0')}`
    const alias = parkAliases[entry.park]
    const parkQuery = alias ?? entry.park

    let parkHit: Match<ParkRow> | null = null
    if (alias) {
      const p = realParks.find((x) => normkey(x.name) === normkey(alias))
      if (p) parkHit = { value: p, sim: 1, how: `alias → ${alias}` }
    }
    if (!parkHit) {
      const p = realParks.find((x) => slugify(x.name) === slugify(parkQuery))
      if (p) parkHit = { value: p, sim: 0.99, how: 'slug-equal' }
    }
    if (!parkHit) parkHit = best(realParks, (p) => p.name, parkQuery, 0.62)

    let item: MissItem
    if (!parkHit) {
      // Global coaster search: right coaster at a wrong/unmatched park.
      const global = best(coasters, (c) => c.name, entry.coaster, 0.75)
      const globalPark = global ? parks.find((p) => p.id === global.value.park_id) : undefined
      item = {
        id,
        entry,
        cls:
          global && globalPark && globalPark.slug !== 'other'
            ? 'found_elsewhere'
            : 'park_and_coaster_missing',
        parkMatch: null,
        coasterMatch: global
          ? { name: global.value.name, park: globalPark?.name ?? '?', sim: global.sim }
          : null,
        note: global
          ? `Coaster found at ${globalPark?.name ?? '?'} (sim ${global.sim.toFixed(2)}) — check park naming.`
          : 'Park not matched — needs a new park row (or a park-aliases.json entry) before the coaster can be added.',
      }
    } else {
      const park = parkHit.value
      const atPark = coastersByPark.get(park.id) ?? []
      const coast = best(atPark, (c) => c.name, entry.coaster, 0.5)
      if (coast) {
        item = {
          id,
          entry,
          cls: coast.sim >= 0.92 ? 'covered_exact' : 'covered_fuzzy',
          parkMatch: { name: park.name, slug: park.slug, sim: parkHit.sim, how: parkHit.how },
          coasterMatch: { name: coast.value.name, park: park.name, sim: coast.sim },
          note:
            coast.sim >= 0.92
              ? ''
              : `Possible name variant — DB has \`${coast.value.name}\` (sim ${coast.sim.toFixed(2)}).`,
        }
      } else {
        const global = best(coasters, (c) => c.name, entry.coaster, 0.75)
        const globalPark = global ? parks.find((p) => p.id === global.value.park_id) : undefined
        item = {
          id,
          entry,
          cls:
            global && globalPark && globalPark.slug !== 'other'
              ? 'found_elsewhere'
              : 'coaster_missing',
          parkMatch: { name: park.name, slug: park.slug, sim: parkHit.sim, how: parkHit.how },
          coasterMatch: global
            ? { name: global.value.name, park: globalPark?.name ?? '?', sim: global.sim }
            : null,
          note: global
            ? `Not at ${park.name}, but \`${global.value.name}\` exists at ${globalPark?.name} (sim ${global.sim.toFixed(2)}) — either mis-homed or park-name mismatch.`
            : `Not present at ${park.name}. Candidate for creation.`,
        }
      }
    }
    if (otherPark && !item.coasterMatch) {
      // note if a same-named orphan sits in the Other bucket
      const orphan = coasters.find(
        (c) => c.park_id === otherPark.id && normkey(c.name) === normkey(entry.coaster),
      )
      if (orphan) {
        item.note += ` NB: \`${orphan.name}\` is currently in the Other bucket (ORPH flow).`
      }
    }
    items.push(item)
  }

  const missItems = items.filter((i) => i.cls !== 'covered_exact')
  const covered = items.filter((i) => i.cls === 'covered_exact' || i.cls === 'covered_fuzzy').length
  return {
    items,
    missItems,
    coveragePct: `${covered}/${entries.length} (${((covered / entries.length) * 100).toFixed(1)}%)`,
  }
}
