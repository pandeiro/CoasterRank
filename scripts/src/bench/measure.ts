// One grid-point measurement: reset → seed → (analyze) → K manual recomputes
// → harvest cron_execution_logs → append JSONL. Results live in
// scripts/src/bench/results/runs.jsonl; report.ts turns them into docs.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'pg'
import type { GridPoint } from './points'
import { MAX_CONSECUTIVE_FAILURES, defaultRepeats } from './points'
import { resetBenchData } from './reset'
import { seedGridPoint, seedGridPointBurst } from './seed'
import { invokeRecompute } from './recompute'
import { captureExplain } from './explain'
import { resolveVariant } from './variants'
import type { RunSample } from './stats'
import { REPO_ROOT } from './env'

const RESULTS_DIR = join(REPO_ROOT, 'scripts', 'src', 'bench', 'results')
const RUNS_JSONL = join(RESULTS_DIR, 'runs.jsonl')

interface ScaleRow {
  r: string
  users_ranking: number
}

// R = Σ_u n_u(n_u−1)/2 over eligible (bench) users — measured, not nominal.
export async function measureScale(pool: Pool): Promise<{ R: number; usersRanking: number }> {
  const res = await pool.query<ScaleRow>(`
    with eligible as (
      select u.id from auth.users u join public.profiles p on p.id = u.id
      where p.is_admin = false
    ),
    ranked as (
      select ur.user_id, count(*)::bigint as n
      from public.user_rides ur join eligible e on e.id = ur.user_id
      where ur.rank is not null
      group by ur.user_id
    )
    select coalesce(sum(n * (n - 1) / 2), 0)::text as r, count(*)::int as users_ranking from ranked
  `)
  const row = res.rows[0]
  return { R: Number.parseInt(row?.r ?? '0', 10), usersRanking: row?.users_ranking ?? 0 }
}

interface LogRow {
  created_at: string
  status: string
  duration_ms: number | null
  pairs: number | null
  updated: number | null
  iterations: number | null
  error_message: string | null
  pairwise: { ms?: number; bytes?: number; retries?: number } | null
}

async function harvestLatest(pool: Pool, after: Date): Promise<LogRow | null> {
  const res = await pool.query<LogRow>(
    `select created_at, status, duration_ms, pairs, updated, iterations, error_message,
            rpc_stats->'pairwise_wins' as pairwise
     from public.cron_execution_logs
     where created_at > $1
     order by created_at desc
     limit 1`,
    [after.toISOString()],
  )
  return res.rows[0] ?? null
}

export interface RunOptions {
  repeats?: number
  burst?: boolean
  skipExplain?: boolean
  variant?: string
}

export async function runPoint(
  pool: Pool,
  point: GridPoint,
  opts: RunOptions = {},
): Promise<RunSample[]> {
  const v = resolveVariant(opts.variant)
  const variant = opts.burst ? `${v.name}-burst` : v.name
  const repeats = opts.repeats ?? defaultRepeats(point.users, point.rides)
  console.log(`\n── ${point.label} (${variant}) — reset`)
  await resetBenchData(pool)

  // Variant SQL: restore the production shape first (guarantees the previous
  // variant's body swap is undone even after a crashed run), then install.
  for (const sqlFile of v.restoreSql) await pool.query(readFileSync(sqlFile, 'utf8'))
  for (const sqlFile of v.installSql) await pool.query(readFileSync(sqlFile, 'utf8'))

  console.log(`── ${point.label} (${variant}) — seed ${point.users} users × ${point.rides} rides`)
  if (opts.burst) {
    const seeded = await seedGridPointBurst(pool, point.label, point.users, point.rides)
    console.log(
      `   burst-inserted ${seeded.ridesInserted} rides in one transaction (no ANALYZE before first run)`,
    )
  } else {
    const seeded = await seedGridPoint(pool, point.label, point.users, point.rides)
    console.log(`   inserted ${seeded.ridesInserted} rides (${seeded.coastersAvailable} coasters)`)
  }

  const { R, usersRanking } = await measureScale(pool)
  console.log(`   measured: ${usersRanking} ranking users, R = ${R.toLocaleString()} raw pair rows`)

  const samples: RunSample[] = []
  let consecutiveFailures = 0
  mkdirSync(RESULTS_DIR, { recursive: true })

  for (let repeat = 1; repeat <= repeats; repeat++) {
    // Baseline runs get fresh stats after the first (autovacuum-equivalent);
    // burst-cold runs deliberately skip this on repeat 1.
    if (!opts.burst || repeat > 1) {
      await pool.query('analyze public.user_rides')
    }
    const startedAt = new Date(Date.now() - 3000)
    const invoke = await invokeRecompute(v.functionName)
    const log = await harvestLatest(pool, startedAt)
    const sample: RunSample = {
      ts: new Date().toISOString(),
      label: point.label,
      variant,
      users: point.users,
      rides: point.rides,
      R,
      repeat,
      ok: invoke.ok && log?.status === 'success',
      invokeMs: invoke.invokeMs,
      durationMs: log?.duration_ms ?? null,
      rpcMs: log?.pairwise?.ms ?? null,
      rpcBytes: log?.pairwise?.bytes ?? null,
      pairs: log?.pairs ?? null,
      iterations: log?.iterations ?? null,
      error: invoke.ok
        ? (log?.error_message ?? null)
        : `invoke: HTTP ${invoke.status} ${invoke.body.slice(0, 120)}`,
      updated: log?.updated ?? null,
    }
    samples.push(sample)
    appendFileSync(RUNS_JSONL, `${JSON.stringify(sample)}\n`)

    const rpc =
      sample.rpcMs !== null
        ? `rpc ${sample.rpcMs}ms/${Math.round((sample.rpcBytes ?? 0) / 1024)}KB`
        : 'no rpc stat'
    const dur =
      sample.durationMs !== null ? `run ${sample.durationMs}ms` : `invoke ${invoke.invokeMs}ms`
    const flag = sample.ok ? '✓' : '✗'
    console.log(
      `   ${flag} repeat ${repeat}/${repeats}: ${dur}, ${rpc}, pairs=${sample.pairs} iters=${sample.iterations}${sample.error ? ` — ${sample.error.slice(0, 80)}` : ''}`,
    )

    consecutiveFailures = sample.ok ? 0 : consecutiveFailures + 1
    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      console.log(`   stopping point early: ${MAX_CONSECUTIVE_FAILURES} consecutive failures`)
      break
    }
  }

  // SQL-side decomposition on the same seeded data (once per point): the
  // plan shows the real join/aggregate shape + execution time without the
  // PostgREST/HTTP layers.
  if (!opts.skipExplain) {
    try {
      const summary = await captureExplain(pool, `${variant}-${point.label}`)
      if (summary) {
        console.log(
          `   plan: SQL execution ${summary.executionTimeMs.toFixed(0)}ms, temp blocks ${summary.tempBlocks.toLocaleString()} (saved to results/plans/${variant}-${point.label}.json)`,
        )
      }
    } catch (err) {
      console.log(`   plan capture failed: ${err instanceof Error ? err.message : err}`)
    }
  }

  // Leave the production function shape behind (the next runPoint restores +
  // installs its own variant SQL, but end clean for ad-hoc psql use).
  for (const sqlFile of v.restoreSql) await pool.query(readFileSync(sqlFile, 'utf8'))
  return samples
}
