import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  COVERAGE_DIR,
  loadCsv,
  loadDb,
  loadGoldenTicket,
  loadJson,
  loadVoteCoasters,
  normkey,
  trigramSim,
  type CoasterRow,
  type ListEntry,
} from './lib.js'
import { classifyCoasterDups, classifyOrphans, classifyParkDups } from './classify.js'
import { matchCoverage } from './missing.js'

export interface SweepOutput {
  generatedAt: string
  baseline: {
    parks: number
    coasters: number
    otherParkCoasters: number
    openCsvCoasters: number
    adminCoasters: number
    statusDist: Record<string, number>
    ratedCoasters: number
    rankedUsers: number
    aliasRows: number
  }
  orphans: ReturnType<typeof classifyOrphans>
  dups: ReturnType<typeof classifyCoasterDups>
  parkDups: ReturnType<typeof classifyParkDups>
  missing: {
    entries: number
    coveragePct: string
    missItems: ReturnType<typeof matchCoverage>['missItems']
  }
  notables: NotablesFile
}

export interface NotablesFile {
  note: string
  candidates: {
    name: string
    park: string
    year: number
    why: string
    sources: string[]
    inDb?: boolean | 'fuzzy'
    matchedTo?: string
  }[]
}

/** Match notable candidates against the DB: exact normalized name → true; close variant → 'fuzzy'. */
function matchNotables(
  candidates: NotablesFile['candidates'],
  coasters: CoasterRow[],
): NotablesFile['candidates'] {
  const norm = (s: string): string => normkey(s)
  return candidates.map((c) => {
    const target = norm(c.name)
    const exact = coasters.find((x) => norm(x.name) === target)
    if (exact) return { ...c, inDb: true as const }
    let bestSim = 0
    let bestName: string | undefined
    for (const x of coasters) {
      const sim = trigramSim(x.name, c.name)
      if (sim > bestSim) {
        bestSim = sim
        bestName = x.name
      }
    }
    if (bestSim >= 0.62 && bestName) return { ...c, inDb: 'fuzzy' as const, matchedTo: bestName }
    return { ...c, inDb: false as const }
  })
}

async function countDb(): Promise<{
  ratedCoasters: number
  rankedUsers: number
  aliasRows: number
  statusDist: Record<string, number>
}> {
  const { loadDb: _ } = await import('./lib.js')
  const url = process.env.SUPABASE_DB_URL
  if (!url) throw new Error('SUPABASE_DB_URL is not set')
  const { Pool } = await import('pg')
  const pool = new Pool({ connectionString: url, ssl: { rejectUnauthorized: false } })
  try {
    const q = await pool.query(`
      select
        (select count(*)::int from coaster_ratings) as rated_coasters,
        (select count(distinct user_id)::int from user_rides where rank is not null) as ranked_users,
        (select count(*)::int from coaster_aliases) as alias_rows`)
    const s = await pool.query(
      `select status::text as status, count(*)::int as n from coasters group by 1`,
    )
    const statusDist: Record<string, number> = {}
    for (const r of s.rows) statusDist[r.status] = r.n
    return {
      ratedCoasters: q.rows[0].rated_coasters,
      rankedUsers: q.rows[0].ranked_users,
      aliasRows: q.rows[0].alias_rows,
      statusDist,
    }
  } finally {
    await pool.end()
  }
}

async function main(): Promise<void> {
  console.log('Loading DB...')
  const { parks, coasters } = await loadDb()
  console.log(`  parks: ${parks.length}, coasters: ${coasters.length}`)

  console.log('Loading CSV + external lists...')
  const csvRows = loadCsv()
  const entries: ListEntry[] = [
    ...loadVoteCoasters(),
    ...loadGoldenTicket('steel'),
    ...loadGoldenTicket('wooden'),
  ]
  console.log(`  csv rows: ${csvRows.length}, list entries: ${entries.length}`)

  const parkAliases = loadJson<Record<string, string>>('park-aliases.json', {})

  console.log('Classifying orphans...')
  const orphans = classifyOrphans(parks, coasters, csvRows)
  console.log(
    `  ${orphans.items.length} items (slug-resolved: ${orphans.resolvedBySlug}, csv-resolved: ${orphans.resolvedByCsv}, review: ${orphans.reviewCount})`,
  )
  const ambiguous = orphans.items.filter((i) => i.action === 'review')
  if (process.argv.includes('--debug-orphans')) {
    for (const i of ambiguous.slice(0, 200)) {
      console.log(`    ${i.id}: ${i.title}`)
    }
  }

  console.log('Classifying same-park coaster dups...')
  const dups = classifyCoasterDups(parks, coasters)
  console.log(`  ${dups.items.length} items from ${dups.groupsExamined} duplicate groups`)

  console.log('Classifying park dups...')
  const parkDups = classifyParkDups(parks, coasters)
  console.log(`  ${parkDups.items.length} items`)

  console.log('Matching external lists...')
  const miss = matchCoverage(entries, parks, coasters, parkAliases)
  console.log(`  coverage: ${miss.coveragePct}, non-exact items: ${miss.missItems.length}`)

  const otherPark = parks.find((p) => p.slug === 'other')
  const otherCount = otherPark ? coasters.filter((c) => c.park_id === otherPark.id).length : 0
  const extra = await countDb()
  const notablesRaw = loadJson<NotablesFile>('notables.json', { note: '', candidates: [] })
  const notables: NotablesFile = {
    note: notablesRaw.note,
    candidates: matchNotables(notablesRaw.candidates, coasters),
  }

  const out: SweepOutput = {
    generatedAt: new Date().toISOString(),
    baseline: {
      parks: parks.length,
      coasters: coasters.length,
      otherParkCoasters: otherCount,
      openCsvCoasters: coasters.filter((c) => c.source === 'open-csv').length,
      adminCoasters: coasters.filter((c) => c.source !== 'open-csv').length,
      statusDist: extra.statusDist,
      ratedCoasters: extra.ratedCoasters,
      rankedUsers: extra.rankedUsers,
      aliasRows: extra.aliasRows,
    },
    orphans,
    dups,
    parkDups,
    missing: { entries: entries.length, coveragePct: miss.coveragePct, missItems: miss.missItems },
    notables,
  }

  writeFileSync(join(COVERAGE_DIR, 'sweep.json'), JSON.stringify(out, null, 2))

  // decisions.json — machine-readable companion for the (future) applier.
  const all = [...orphans.items, ...dups.items, ...parkDups.items]
  const decisions = {
    schemaVersion: 1,
    note: 'Mark decided:true and adjust action/payload per item. The applier (future step) consumes this file; nothing in it has been executed.',
    items: all.map((i) => ({
      id: i.id,
      kind: i.kind,
      action: i.action,
      confidence: i.confidence,
      title: i.title,
      decided: false,
      payload: i.payload,
    })),
  }
  writeFileSync(join(COVERAGE_DIR, 'decisions.json'), JSON.stringify(decisions, null, 2))

  console.log('\nWrote data/coverage/sweep.json + decisions.json')
  console.log(
    `Decision items: ${all.length} (orphan ${orphans.items.length}, dup ${dups.items.length}, park ${parkDups.items.length})`,
  )
}

main().catch((err) => {
  console.error('Sweep failed:', err instanceof Error ? err.message : err)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
