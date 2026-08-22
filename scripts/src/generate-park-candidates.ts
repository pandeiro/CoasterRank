import { supabaseAdmin } from './db/client.js'
import { program } from 'commander'

const PAGE_SIZE = 1000

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

async function fetchParks(): Promise<Array<{ id: string; name: string; country: string | null }>> {
  const all: Array<{ id: string; name: string; country: string | null }> = []
  let offset = 0

  while (true) {
    const { data, error } = await supabaseAdmin
      .from('parks')
      .select('id, name, country')
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error('Error fetching parks:', error.message)
      process.exit(1)
    }

    all.push(...(data ?? []))
    if (!data || data.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }

  return all
}

async function generateCandidates(apply: boolean): Promise<CandidateSummary> {
  const parks = await fetchParks()
  console.log(`Fetched ${parks.length} parks`)

  let wouldInsert = 0
  let inserted = 0

  for (let i = 0; i < parks.length; i++) {
    const parkA = parks[i]!
    if (!parkA.country) continue

    for (let j = i + 1; j < parks.length; j++) {
      const parkB = parks[j]!
      if (parkB.country !== parkA.country) continue

      const { data: simData, error: simError } = await supabaseAdmin.rpc('word_similarity', {
        a: parkA.name,
        b: parkB.name,
      })

      if (simError) {
        console.error(
          `Error computing similarity for ${parkA.id} vs ${parkB.id}:`,
          simError.message,
        )
        continue
      }

      const similarity = Number(simData)
      if (similarity > 0.6) {
        wouldInsert++
        if (apply) {
          const { error } = await supabaseAdmin.from('park_dupe_candidates').upsert(
            {
              park_a_id: parkA.id,
              park_b_id: parkB.id,
              similarity,
            },
            { onConflict: 'park_a_id,park_b_id', ignoreDuplicates: true },
          )

          if (error) {
            console.error(`Error inserting candidate ${parkA.id}/${parkB.id}:`, error.message)
          } else {
            inserted++
          }
        }
      }
    }
  }

  const totalCandidates = await getCandidateCount()
  return { wouldInsert, inserted, totalCandidates }
}

async function main(): Promise<void> {
  program
    .name('generate-park-candidates')
    .description('Generate park duplicate candidates using pg_trgm word_similarity')
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
