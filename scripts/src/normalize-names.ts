import { supabaseAdmin } from './db/client.js'
import { normalizeBatch, type NormalizeInput, type NormalizationResult } from './llm/tasks.js'

const APPLY = process.argv.includes('--apply')
const REPROCESS = process.argv.includes('--reprocess')
const BATCH_SIZE = (() => {
  const idx = process.argv.indexOf('--batch-size')
  if (idx === -1) return 10
  const val = Number(process.argv[idx + 1])
  if (!Number.isFinite(val) || val < 1) {
    console.error('Error: --batch-size must be a positive integer')
    process.exit(1)
  }
  return val
})()

type Summary = {
  totalFetched: number
  issueNone: number
  skipped: number
  nameUpdated: number
  stateOnlyFlagged: number
  parseFailures: number
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size))
  }
  return chunks
}

async function fetchCoasters(): Promise<
  { id: string; name: string; park_name: string }[]
> {
  let query = supabaseAdmin
    .from('coasters')
    .select('id, name, park_name:parks(name)')

  if (!REPROCESS) {
    // Default: only process active records
    query = query.eq('review_state', 'active')
  }
  // With --reprocess: fetch all records regardless of state

  const { data, error } = await query
  if (error) {
    console.error('Error fetching coasters:', error.message)
    process.exit(1)
  }

  return (data ?? []).map((row: any) => ({
    id: row.id,
    name: row.name,
    park_name: row.park_name?.name ?? 'Unknown Park',
  }))
}

async function applyHighConfidence(
  updates: { id: string; cleaned_name: string }[],
): Promise<number> {
  if (updates.length === 0) return 0
  let count = 0
  for (const u of updates) {
    const { error } = await supabaseAdmin
      .from('coasters')
      .update({
        name: u.cleaned_name,
        review_state: 'needs_review',
        needs_review_reason: 'name_normalized',
      })
      .eq('id', u.id)
    if (error) {
      console.error(`  Failed to update coaster ${u.id}:`, error.message)
    } else {
      count++
    }
  }
  return count
}

async function applyLowConfidence(
  updates: { id: string }[],
): Promise<number> {
  if (updates.length === 0) return 0
  let count = 0
  for (const u of updates) {
    const { error } = await supabaseAdmin
      .from('coasters')
      .update({
        review_state: 'needs_review',
        needs_review_reason: 'low_confidence_normalization',
      })
      .eq('id', u.id)
    if (error) {
      console.error(`  Failed to flag coaster ${u.id}:`, error.message)
    } else {
      count++
    }
  }
  return count
}

async function applyParseFailure(failedIds: string[]): Promise<void> {
  for (const id of failedIds) {
    await supabaseAdmin
      .from('coasters')
      .update({
        review_state: 'needs_review',
        needs_review_reason: 'llm_parse_failure',
      })
      .eq('id', id)
  }
}

async function main(): Promise<void> {
  console.log('CoasterRank name normalization')
  console.log('  mode:   ', APPLY ? 'APPLY (write to DB)' : 'DRY-RUN (no DB writes)')
  console.log('  reprocess:', REPROCESS ? 'yes' : 'no (skip already-processed)')
  console.log('  batch_size:', BATCH_SIZE)

  const coasters = await fetchCoasters()
  console.log(`\nFetched ${coasters.length} active coasters`)

  const summary: Summary = {
    totalFetched: coasters.length,
    issueNone: 0,
    skipped: 0,
    nameUpdated: 0,
    stateOnlyFlagged: 0,
    parseFailures: 0,
  }

  const batches = chunk(coasters, BATCH_SIZE)

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i]!
    const batchNum = i + 1
    console.log(`\nBatch ${batchNum}/${batches.length} (${batch.length} records)`)

    let results: NormalizationResult[]
    try {
      results = await normalizeBatch(
        batch.map((c) => ({
          coaster_id: c.id,
          name: c.name,
          park_name: c.park_name,
        })),
      )
    } catch (err) {
      console.error(`  Batch ${batchNum} failed: ${(err as Error).message}`)
      summary.parseFailures += batch.length
      if (APPLY) {
        await applyParseFailure(batch.map((c) => c.id))
      }
      continue
    }

    const highConfidenceUpdates: { id: string; cleaned_name: string }[] = []
    const lowConfidenceUpdates: { id: string }[] = []

    for (const r of results) {
      if (r.issue === 'none') {
        summary.issueNone++
        continue
      }

      if (!APPLY) {
        console.log(
          `  [DRY-RUN] ${r.coaster_id} | "${batch.find((c) => c.id === r.coaster_id)?.name ?? '?'}" → "${r.cleaned_name}" | issue=${r.issue} confidence=${r.confidence}`,
        )
      }

      if (r.confidence >= 0.7) {
        highConfidenceUpdates.push({ id: r.coaster_id, cleaned_name: r.cleaned_name })
      } else {
        lowConfidenceUpdates.push({ id: r.coaster_id })
      }
    }

    if (APPLY) {
      const updated = await applyHighConfidence(highConfidenceUpdates)
      const flagged = await applyLowConfidence(lowConfidenceUpdates)
      summary.nameUpdated += updated
      summary.stateOnlyFlagged += flagged
      console.log(`  Applied: ${updated} name updates, ${flagged} low-confidence flags`)
    } else {
      summary.nameUpdated += highConfidenceUpdates.length
      summary.stateOnlyFlagged += lowConfidenceUpdates.length
      console.log(
        `  [DRY-RUN] Would update: ${highConfidenceUpdates.length} names, ${lowConfidenceUpdates.length} low-confidence flags`,
      )
    }

    console.log(`  Batch ${batchNum} done (issue=none: ${results.filter((r) => r.issue === 'none').length})`)
  }

  console.log('\n--- Summary ---')
  console.log(`  Total fetched:       ${summary.totalFetched}`)
  console.log(`  issue=none:          ${summary.issueNone}`)
  console.log(`  Skipped:             ${summary.skipped}`)
  console.log(`  Name updated:        ${summary.nameUpdated}`)
  console.log(`  State-only flagged:  ${summary.stateOnlyFlagged}`)
  console.log(`  Parse failures:      ${summary.parseFailures}`)
}

main().catch((err) => {
  console.error('\nNormalization failed:', (err as Error).message)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
