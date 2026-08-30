// testride:recompute — invoke the recompute-rankings Edge Function with the
// service-role key. Used after seeding/cleanup to refresh derived ratings.
import { printBanner, type Connections } from './connections'

const TIMEOUT_MS = 600_000 // benchmark-scale recomputes can run long

export async function runRecompute(conns: Connections): Promise<void> {
  printBanner('recompute', conns)
  const { supabaseUrl, serviceKey } = conns
  if (!supabaseUrl || !serviceKey) {
    console.error(
      'Error: need --supabase-url and --service-key (or SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env).',
    )
    process.exit(1)
  }

  const started = Date.now()
  let res: Response
  try {
    res = await fetch(`${supabaseUrl}/functions/v1/recompute-rankings`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch (err) {
    console.error(`Error invoking recompute-rankings: ${err instanceof Error ? err.message : err}`)
    process.exit(1)
  }

  const text = await res.text()
  const seconds = ((Date.now() - started) / 1000).toFixed(1)
  console.log(`HTTP ${res.status} in ${seconds}s`)
  try {
    console.log(JSON.stringify(JSON.parse(text), null, 2))
  } catch {
    console.log(text)
  }
  if (!res.ok) process.exitCode = 1
}
