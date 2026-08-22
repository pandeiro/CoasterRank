import { supabaseAdmin } from './db/client.js'
import { program } from 'commander'
import { adjudicateParkOne, type ParkAdjudicateInput } from './llm/tasks.js'

const PAGE_SIZE = 1000

interface AdjudicationSummary {
  totalProcessed: number
  duplicate: number
  notDuplicate: number
  needsHuman: number
  parseFailures: number
}

async function fetchUnresolvedCandidates(reprocess: boolean): Promise<
  Array<{
    id: string
    park_a_id: string
    park_b_id: string
    similarity: number
    verdict: string | null
    resolved: boolean
  }>
> {
  const all: Array<{
    id: string
    park_a_id: string
    park_b_id: string
    similarity: number
    verdict: string | null
    resolved: boolean
  }> = []
  let offset = 0

  while (true) {
    let query = supabaseAdmin
      .from('park_dupe_candidates')
      .select('id, park_a_id, park_b_id, similarity, verdict, resolved')
      .range(offset, offset + PAGE_SIZE - 1)

    if (!reprocess) {
      query = query.or('verdict.is.null,resolved.eq.false')
    }

    const { data, error } = await query

    if (error) {
      console.error('Error fetching candidates:', error.message)
      process.exit(1)
    }

    all.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return all
}

async function fetchParkDetails(
  parkIds: string[],
): Promise<
  Map<
    string,
    { id: string; name: string; country: string | null; region: string | null; city: string | null }
  >
> {
  const map = new Map()
  const uniqueIds = [...new Set(parkIds)]

  for (let i = 0; i < uniqueIds.length; i += PAGE_SIZE) {
    const batch = uniqueIds.slice(i, i + PAGE_SIZE)
    const { data, error } = await supabaseAdmin
      .from('parks')
      .select('id, name, country, region, city')
      .in('id', batch)

    if (error) {
      console.error('Error fetching park details:', error.message)
      process.exit(1)
    }

    for (const park of data ?? []) {
      map.set(park.id, park)
    }
  }

  return map
}

async function adjudicateCandidates(
  apply: boolean,
  dryRun: boolean,
  reprocess: boolean,
): Promise<AdjudicationSummary> {
  const candidates = await fetchUnresolvedCandidates(reprocess)
  console.log(`Fetched ${candidates.length} unresolved candidates`)

  if (candidates.length === 0) {
    return { totalProcessed: 0, duplicate: 0, notDuplicate: 0, needsHuman: 0, parseFailures: 0 }
  }

  const parkIds = candidates.flatMap((c) => [c.park_a_id, c.park_b_id])
  const parkMap = await fetchParkDetails(parkIds)

  const summary: AdjudicationSummary = {
    totalProcessed: 0,
    duplicate: 0,
    notDuplicate: 0,
    needsHuman: 0,
    parseFailures: 0,
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    const parkA = parkMap.get(candidate.park_a_id)
    const parkB = parkMap.get(candidate.park_b_id)

    if (!parkA || !parkB) {
      console.error(`Missing park details for candidate ${candidate.id}`)
      summary.parseFailures++
      continue
    }

    const input: ParkAdjudicateInput = {
      pair_id: candidate.id,
      park_a: {
        park_id: parkA.id,
        name: parkA.name,
        country: parkA.country,
        region: parkA.region,
        city: parkA.city,
      },
      park_b: {
        park_id: parkB.id,
        name: parkB.name,
        country: parkB.country,
        region: parkB.region,
        city: parkB.city,
      },
      similarity: candidate.similarity,
    }

    try {
      const result = await adjudicateParkOne(input)
      summary.totalProcessed++

      switch (result.verdict) {
        case 'duplicate':
          summary.duplicate++
          break
        case 'not_duplicate':
          summary.notDuplicate++
          break
        case 'needs_human':
          summary.needsHuman++
          break
      }

      if (!dryRun && apply) {
        const { error } = await supabaseAdmin
          .from('park_dupe_candidates')
          .update({
            verdict: result.verdict,
            verdict_reasoning: result.reasoning,
            resolved: false,
          })
          .eq('id', candidate.id)

        if (error) {
          console.error(`Failed to update candidate ${candidate.id}:`, error.message)
        }
      } else if (dryRun) {
        console.log(
          `  [DRY-RUN] ${candidate.id} | "${parkA.name}" vs "${parkB.name}" | verdict=${result.verdict} confidence=${result.confidence.toFixed(2)}`,
        )
      }
    } catch (e) {
      summary.totalProcessed++
      summary.parseFailures++
      console.error(`Adjudication failed for ${candidate.id}:`, (e as Error).message)

      if (!dryRun && apply) {
        const { error } = await supabaseAdmin
          .from('park_dupe_candidates')
          .update({
            verdict: 'needs_human',
            verdict_reasoning: 'llm_parse_failure',
            resolved: false,
          })
          .eq('id', candidate.id)

        if (error) {
          console.error(`Failed to write fallback for ${candidate.id}:`, error.message)
        }
      }
    }
  }

  return summary
}

async function main(): Promise<void> {
  program
    .name('adjudicate-parks')
    .description('LLM adjudication for park duplicate candidates')
    .option('--apply', 'Write verdicts to database (default: dry-run)')
    .option('--dry-run', 'Print verdicts without writing (default if --apply not set)')
    .option('--reprocess', 'Re-process candidates that already have a verdict')
    .parse()

  const { apply, dryRun, reprocess } = program.opts()

  const isDryRun = !apply || dryRun

  console.log('Park duplicate adjudication')
  console.log(`  mode: ${isDryRun ? 'DRY-RUN (no DB writes)' : 'APPLY (write to DB)'}`)
  console.log(`  reprocess: ${reprocess ? 'yes' : 'no'}`)

  const summary = await adjudicateCandidates(apply, isDryRun, reprocess)

  console.log('\n--- Summary ---')
  console.log(`  Total processed: ${summary.totalProcessed}`)
  console.log(`  duplicate:       ${summary.duplicate}`)
  console.log(`  not_duplicate:   ${summary.notDuplicate}`)
  console.log(`  needs_human:     ${summary.needsHuman}`)
  console.log(`  parse failures:  ${summary.parseFailures}`)
}

main().catch((err) => {
  console.error('\nAdjudication failed:', (err as Error).message)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
