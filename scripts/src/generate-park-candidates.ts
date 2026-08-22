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
    // Dry-run: count what would be inserted without writing
    const { count, error } = await supabaseAdmin
      .from('parks')
      .select('id', { count: 'exact', head: true })

    if (error) {
      console.error('Error counting parks:', error.message)
      process.exit(1)
    }

    // Estimate using a sampled query - just run the actual logic but don't insert
    // For dry-run we can use the same RPC but it's write-only, so we'll just report
    // the park count and note it's an estimate
    console.log(`  Parks in database: ${count ?? 0}`)
    console.log('  (Dry-run: exact candidate count requires running the similarity check)')

    const totalCandidates = await getCandidateCount()
    return { wouldInsert: -1, inserted: 0, totalCandidates }
  }
}

async function main(): Promise<void> {
  program
    .name('generate-park-candidates')
    .description('Generate park duplicate candidates using pg_trgm word_similarity (single SQL query)')
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
    console.log(`  Candidates would insert: run with --apply to see exact count`)
  }
  console.log(`  Total candidate set size: ${summary.totalCandidates}`)
}

main().catch((err) => {
  console.error('\nCandidate generation failed:', (err as Error).message)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})