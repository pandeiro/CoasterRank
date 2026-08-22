import { supabaseAdmin } from './db/client.js'
import { program } from 'commander'

interface CandidateSummary {
  wouldInsert: number
  inserted: number
  totalCandidates: number
}

async function getCandidateCount(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('park_dupe_candidates')
    .select('*', { count: 'exact', head: true })
  if (error) {
    console.error('Error counting candidates:', error.message)
    process.exit(1)
  }
  return count ?? 0
}

async function countCandidatesToInsert(): Promise<number> {
  // Use the same logic as the RPC but as a SELECT count(*)
  const { data, error } = await supabaseAdmin.rpc('count_park_candidates', {
    p_threshold: 0.6,
  })

  if (error) {
    console.error('Error counting candidates:', error.message)
    process.exit(1)
  }

  return data ?? 0
}

async function generateCandidates(apply: boolean): Promise<CandidateSummary> {
  console.log('Generating park candidates via SQL self-join...')

  if (apply) {
    const { data, error } = await supabaseAdmin.rpc('generate_park_candidates', {
      p_threshold: 0.6,
    })

    if (error) {
      console.error('Error generating candidates:', error.message)
      process.exit(1)
    }

    const inserted = data ?? 0
    const totalCandidates = await getCandidateCount()
    return { wouldInsert: 0, inserted, totalCandidates }
  } else {
    // Dry-run: count exactly what would be inserted without writing
    const wouldInsert = await countCandidatesToInsert()
    const totalCandidates = await getCandidateCount()

    console.log(`  Would insert: ${wouldInsert} new candidate pairs`)

    return { wouldInsert, inserted: 0, totalCandidates }
  }
}

async function main(): Promise<void> {
  program
    .name('generate-park-candidates')
    .description(
      'Generate park duplicate candidates using pg_trgm word_similarity (single SQL query)',
    )
    .option('--apply', 'Write candidates to database (default: dry-run)')
    .parse()

  const { apply } = program.opts()

  console.log('Park duplicate candidate generation')
  console.log(`  mode: ${apply ? 'APPLY (write to DB)' : 'DRY-RUN (no DB writes)'}`)

  const summary = await generateCandidates(apply)

  console.log('\n--- Summary ---')
  if (apply) {
    console.log(`  Candidates inserted: ${summary.inserted}`)
  } else {
    console.log(`  Candidates would insert: ${summary.wouldInsert}`)
  }
  console.log(`  Total candidate set size: ${summary.totalCandidates}`)
}

main().catch((err) => {
  console.error('\nCandidate generation failed:', (err as Error).message)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
