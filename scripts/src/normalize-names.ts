import { supabaseAdmin } from './db/client.js'

const APPLY = process.argv.includes('--apply')
const REPROCESS = process.argv.includes('--reprocess')
const LIMIT = (() => {
  const idx = process.argv.indexOf('--limit')
  if (idx === -1) return Infinity
  const val = Number(process.argv[idx + 1])
  if (!Number.isFinite(val) || val < 1) {
    console.error('Error: --limit must be a positive integer')
    process.exit(1)
  }
  return val
})()

// Strip trailing parenthesized text: "Name (Park)" → "Name"
// Also handles "Name (roller coaster)", "Name (disambiguation)", etc.
export function normalizeName(name: string): { cleaned: string; changed: boolean } {
  const cleaned = name.replace(/\s*\(.*\)\s*$/, '').trim()
  return { cleaned, changed: cleaned !== name }
}

type Summary = {
  totalFetched: number
  nameUpdated: number
  unchanged: number
}

const PAGE_SIZE = 1000

async function fetchCoasters(): Promise<{ id: string; name: string }[]> {
  const all: { id: string; name: string }[] = []
  let offset = 0

  while (true) {
    let query = supabaseAdmin
      .from('coasters')
      .select('id, name')
      .range(offset, offset + PAGE_SIZE - 1)

    if (!REPROCESS) {
      query = query.eq('review_state', 'active')
    }

    const { data, error } = await query
    if (error) {
      console.error('Error fetching coasters:', error.message)
      process.exit(1)
    }

    all.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return all
}

async function main(): Promise<void> {
  console.log('CoasterRank name normalization (regex)')
  console.log('  mode:    ', APPLY ? 'APPLY (write to DB)' : 'DRY-RUN (no DB writes)')
  console.log('  reprocess:', REPROCESS ? 'yes' : 'no (skip already-processed)')
  if (LIMIT !== Infinity) console.log('  limit:   ', LIMIT)

  const allCoasters = await fetchCoasters()
  const coasters = LIMIT !== Infinity ? allCoasters.slice(0, LIMIT) : allCoasters
  console.log(
    `\nFetched ${allCoasters.length} coasters${LIMIT !== Infinity ? ` (limited to ${LIMIT})` : ''}`,
  )

  const summary: Summary = {
    totalFetched: coasters.length,
    nameUpdated: 0,
    unchanged: 0,
  }

  const updates: { id: string; cleaned: string }[] = []

  for (const c of coasters) {
    const { cleaned, changed } = normalizeName(c.name)
    if (changed) {
      if (!APPLY) {
        console.log(`  [DRY-RUN] ${c.id} | "${c.name}" → "${cleaned}"`)
      }
      updates.push({ id: c.id, cleaned })
    } else {
      summary.unchanged++
    }
  }

  if (APPLY) {
    let applied = 0
    for (const u of updates) {
      const { error } = await supabaseAdmin
        .from('coasters')
        .update({
          name: u.cleaned,
          review_state: 'needs_review',
          needs_review_reason: 'name_normalized',
        })
        .eq('id', u.id)
      if (error) {
        console.error(`  Failed to update ${u.id}:`, error.message)
      } else {
        applied++
      }
    }
    summary.nameUpdated = applied
    console.log(`\nApplied: ${applied} name updates`)
  } else {
    summary.nameUpdated = updates.length
    console.log(`\n[DRY-RUN] Would update: ${updates.length} names`)
  }

  console.log('\n--- Summary ---')
  console.log(`  Total fetched: ${summary.totalFetched}`)
  console.log(`  Name updated:  ${summary.nameUpdated}`)
  console.log(`  Unchanged:     ${summary.unchanged}`)
}

main().catch((err) => {
  console.error('\nNormalization failed:', (err as Error).message)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
