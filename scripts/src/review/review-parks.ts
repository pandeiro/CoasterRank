import { supabaseAdmin } from '../db/client.js'
import { program } from 'commander'
import { promptYNS, promptText } from './cli-utils.js'

const PAGE_SIZE = 1000

interface Candidate {
  id: string
  park_a_id: string
  park_b_id: string
  similarity: number
  verdict: string | null
  verdict_reasoning: string | null
  resolved: boolean
  reviewed_by: string | null
}

interface Park {
  id: string
  name: string
  country: string | null
  region: string | null
  city: string | null
}

interface ReviewSummary {
  totalPresented: number
  merged: number
  rejected: number
  skipped: number
  errors: number
}

async function fetchUnresolvedCandidates(filter?: number): Promise<Candidate[]> {
  const all: Candidate[] = []
  let offset = 0

  while (true) {
    let query = supabaseAdmin
      .from('park_dupe_candidates')
      .select(
        'id, park_a_id, park_b_id, similarity, verdict, verdict_reasoning, resolved, reviewed_by',
      )
      .eq('resolved', false)
      .order('similarity', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (filter !== undefined) {
      query = query.gte('similarity', filter)
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

async function fetchParkDetails(parkIds: string[]): Promise<Map<string, Park>> {
  const map = new Map<string, Park>()
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

async function getCoasterCountForPark(parkId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('coasters')
    .select('*', { count: 'exact', head: true })
    .eq('park_id', parkId)

  if (error) {
    console.error(`Error counting coasters for park ${parkId}:`, error.message)
    return 0
  }

  return count ?? 0
}

function displayCandidate(
  index: number,
  total: number,
  candidate: Candidate,
  parkA: Park,
  parkB: Park,
  coasterCountA: number,
  coasterCountB: number,
): void {
  console.log('\n' + '='.repeat(70))
  console.log(`Candidate ${index} of ${total}`)
  if (candidate.verdict) {
    console.log(
      `  LLM Verdict: ${candidate.verdict} | Confidence: ${candidate.similarity.toFixed(2)}`,
    )
    console.log(`  Reasoning: ${candidate.verdict_reasoning || 'N/A'}`)
  }
  console.log('-'.repeat(70))
  console.log(`  A (canonical): ${parkA.name}`)
  console.log(
    `       Country: ${parkA.country || 'N/A'} | Region: ${parkA.region || 'N/A'} | City: ${parkA.city || 'N/A'}`,
  )
  console.log(`       Coasters: ${coasterCountA}`)
  console.log('')
  console.log(`  B (duplicate): ${parkB.name}`)
  console.log(
    `       Country: ${parkB.country || 'N/A'} | Region: ${parkB.region || 'N/A'} | City: ${parkB.city || 'N/A'}`,
  )
  console.log(`       Coasters: ${coasterCountB}`)
  console.log(`  Similarity: ${candidate.similarity.toFixed(3)}`)
  console.log('='.repeat(70))
}

async function mergeParks(
  canonicalId: string,
  duplicateId: string,
  candidateId: string,
  reason: string,
  dryRun: boolean,
): Promise<boolean> {
  const coasterCount = await getCoasterCountForPark(duplicateId)
  if (dryRun) {
    console.log(
      `  [DRY-RUN] Would merge: re-point ${coasterCount} coasters from ${duplicateId} to ${canonicalId}, delete park ${duplicateId}`,
    )
    return true
  }

  const { data: coasters, error: coasterError } = await supabaseAdmin
    .from('coasters')
    .select('id')
    .eq('park_id', duplicateId)

  if (coasterError) {
    console.error('Error fetching coasters to re-point:', coasterError.message)
    return false
  }

  const coasterIds = (coasters ?? []).map((c) => c.id)

  const { error: txError } = await supabaseAdmin.rpc('apply_park_merge', {
    p_canonical_id: canonicalId,
    p_duplicate_id: duplicateId,
    p_candidate_id: candidateId,
    p_reason: reason,
  })

  if (txError) {
    console.error('Merge transaction failed:', txError.message)
    return false
  }

  console.log(
    `  ✓ Merge applied: ${coasterIds.length} coasters re-pointed, park ${duplicateId} deleted`,
  )
  return true
}

async function applyMerge(
  canonicalId: string,
  duplicateId: string,
  candidateId: string,
  reason: string,
  dryRun: boolean,
): Promise<boolean> {
  const coasterCount = await getCoasterCountForPark(duplicateId)

  if (dryRun) {
    console.log(
      `  [DRY-RUN] Would re-point ${coasterCount} coasters from ${duplicateId} to ${canonicalId}`,
    )
    console.log(`  [DRY-RUN] Would delete park ${duplicateId}`)
    console.log(`  [DRY-RUN] Would set candidate ${candidateId} resolved=true`)
    return true
  }

  if (coasterCount > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('coasters')
      .update({ park_id: canonicalId })
      .eq('park_id', duplicateId)

    if (updateError) {
      console.error('Error re-pointing coasters:', updateError.message)
      return false
    }
  }

  const { error: deleteError } = await supabaseAdmin.from('parks').delete().eq('id', duplicateId)

  if (deleteError) {
    console.error('Error deleting duplicate park:', deleteError.message)
    return false
  }

  const { error: candidateError } = await supabaseAdmin
    .from('park_dupe_candidates')
    .update({ resolved: true, reviewed_by: 'cli' })
    .eq('id', candidateId)

  if (candidateError) {
    console.error('Error updating candidate:', candidateError.message)
    return false
  }

  console.log(`  ✓ Merge applied: ${coasterCount} coasters re-pointed, park ${duplicateId} deleted`)
  return true
}

async function rejectCandidate(candidateId: string, dryRun: boolean): Promise<boolean> {
  if (dryRun) {
    console.log(`  [DRY-RUN] Would reject candidate ${candidateId}`)
    return true
  }

  const { error } = await supabaseAdmin
    .from('park_dupe_candidates')
    .update({
      verdict: 'not_duplicate',
      resolved: true,
      reviewed_by: 'cli',
    })
    .eq('id', candidateId)

  if (error) {
    console.error('Error rejecting candidate:', error.message)
    return false
  }

  console.log('  ✓ Rejected')
  return true
}

async function main(): Promise<void> {
  program
    .name('review-parks')
    .description('Interactive review of park duplicate candidates')
    .option('--dry-run', 'Show what would happen without writing to database')
    .option('--filter <threshold>', 'Only show candidates with similarity >= threshold', (v) =>
      parseFloat(v),
    )
    .parse()

  const { dryRun, filter } = program.opts()

  console.log('Park duplicate review')
  console.log(`  mode: ${dryRun ? 'DRY-RUN (no DB writes)' : 'LIVE (writes to DB)'}`)
  if (filter !== undefined) console.log(`  filter: similarity >= ${filter}`)

  const candidates = await fetchUnresolvedCandidates(filter)
  console.log(`\nFound ${candidates.length} unresolved candidates`)

  if (candidates.length === 0) {
    console.log('Nothing to review.')
    return
  }

  const parkIds = candidates.flatMap((c) => [c.park_a_id, c.park_b_id])
  const parkMap = await fetchParkDetails(parkIds)

  const summary: ReviewSummary = {
    totalPresented: 0,
    merged: 0,
    rejected: 0,
    skipped: 0,
    errors: 0,
  }

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    const parkA = parkMap.get(candidate.park_a_id)
    const parkB = parkMap.get(candidate.park_b_id)

    if (!parkA || !parkB) {
      console.error(`Missing park details for candidate ${candidate.id}`)
      summary.errors++
      continue
    }

    const coasterCountA = await getCoasterCountForPark(parkA.id)
    const coasterCountB = await getCoasterCountForPark(parkB.id)

    displayCandidate(
      i + 1,
      candidates.length,
      candidate,
      parkA,
      parkB,
      coasterCountA,
      coasterCountB,
    )

    const action = await promptYNS(
      '[y] Confirm merge (A=canonical, B=duplicate)  [n] Reject  [s] Skip > ',
    )

    if (action === 'y') {
      const reason = await promptText({
        prompt: 'Reason for merge',
        validate: (v) => (v.trim() ? null : 'Reason is required'),
      })

      const success = await applyMerge(parkA.id, parkB.id, candidate.id, reason, dryRun)
      if (success) {
        summary.merged++
      } else {
        summary.errors++
      }
    } else if (action === 'n') {
      const success = await rejectCandidate(candidate.id, dryRun)
      if (success) {
        summary.rejected++
      } else {
        summary.errors++
      }
    } else {
      console.log('  Skipped')
      summary.skipped++
    }

    summary.totalPresented++
  }

  console.log('\n--- Summary ---')
  console.log(`  Total presented: ${summary.totalPresented}`)
  console.log(`  Merged:          ${summary.merged}`)
  console.log(`  Rejected:        ${summary.rejected}`)
  console.log(`  Skipped:         ${summary.skipped}`)
  console.log(`  Errors:          ${summary.errors}`)
}

main().catch((err) => {
  console.error('\nReview failed:', (err as Error).message)
  if (err instanceof Error && err.stack) console.error(err.stack)
  process.exit(1)
})
