// bench CLI — load-generator + measurement harness for the recompute pipeline.
// Runs ONLY against the disposable staging project (see env.ts tripwire).
//
//   npm run bench -- reset                       wipe user data (staging only)
//   npm run bench -- run --users 50 --rides 50   one grid point, K recomputes
//   npm run bench -- sweep                       the whole R-sweep grid
//   npm run bench -- report                      RESULTS.md + chart + csv
import { join } from 'node:path'
import { Pool } from 'pg'
import { Command } from 'commander'
import { loadBenchEnv } from './env'
import { GRID, MAX_CONSECUTIVE_FAILURES, defaultRepeats, estimateR } from './points'
import { runChurn, parseSchedule } from './churn'
import { runPoint, measureScale } from './measure'
import { captureExplain } from './explain'
import { runReport } from './report'
import { resetBenchData } from './reset'
import { seedGridPoint } from './seed'

const program = new Command()

function connect(): { pool: Pool; close: () => Promise<void> } {
  const env = loadBenchEnv()
  const pool = new Pool({ connectionString: env.dbUrl, ssl: { rejectUnauthorized: false } })
  return { pool, close: () => pool.end() }
}

program.name('bench').description('recompute-pipeline benchmark on the disposable staging project')

program
  .command('reset')
  .description('wipe all non-admin users + derived tables on the bench project')
  .action(async () => {
    const { pool, close } = connect()
    try {
      const res = await resetBenchData(pool)
      console.log(`deleted ${res.usersDeleted} users (bench project only)`)
    } finally {
      await close()
    }
  })

program
  .command('seed')
  .description('seed bench users + rides (no recompute)')
  .requiredOption('--users <n>', 'user count', Number)
  .requiredOption('--rides <n>', 'ranked rides per user (exact)', Number)
  .action(async (opts: { users: number; rides: number }) => {
    const { pool, close } = connect()
    try {
      const label = `${opts.users}x${opts.rides}`
      const seeded = await seedGridPoint(pool, label, opts.users, opts.rides)
      console.log(`seeded ${seeded.users} users, ${seeded.ridesInserted} rides`)
      const scale = await measureScale(pool)
      console.log(`measured R = ${scale.R.toLocaleString()} (${scale.usersRanking} ranking users)`)
    } finally {
      await close()
    }
  })

program
  .command('run')
  .description('one grid point: reset → seed → K manual recomputes → record')
  .requiredOption('--users <n>', 'user count', Number)
  .requiredOption('--rides <n>', 'ranked rides per user (exact)', Number)
  .option('--repeats <n>', 'recompute invocations', Number)
  .option('--variant <name>', 'baseline | a-dirty | b-plpgsql', 'baseline')
  .option('--burst', 'seed in one bulk transaction + recompute with cold stats')
  .action(
    async (opts: {
      users: number
      rides: number
      repeats?: number
      variant?: string
      burst?: boolean
    }) => {
      const { pool, close } = connect()
      try {
        const label = `${opts.users}x${opts.rides}`
        await runPoint(
          pool,
          { label, users: opts.users, rides: opts.rides },
          {
            repeats: opts.repeats,
            variant: opts.variant,
            burst: opts.burst,
          },
        )
      } finally {
        await close()
      }
    },
  )

program
  .command('sweep')
  .description('run the R-sweep grid across variants (skips points past the failure cliff)')
  .option('--repeats <n>', 'override default repeats per point', Number)
  .option('--variants <list>', 'comma list of variants', 'baseline,a-dirty,b-plpgsql')
  .action(async (opts: { repeats?: number; variants: string }) => {
    const { pool, close } = connect()
    const variants = opts.variants
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    try {
      for (const variant of variants) {
        for (const point of GRID) {
          await runPoint(pool, point, { repeats: opts.repeats, variant })
          // cheap inter-point pause; lets Postgres settle between points
          await new Promise((r) => setTimeout(r, 5000))
        }
      }
      console.log('\nsweep complete — run `npm run bench -- report`')
    } finally {
      await close()
    }
  })

program
  .command('explain')
  .description('EXPLAIN (ANALYZE, BUFFERS) the production pairwise_wins() on current data')
  .action(async () => {
    const { pool, close } = connect()
    try {
      const scale = await measureScale(pool)
      console.log(`R = ${scale.R.toLocaleString()}; capturing plan...`)
      const summary = await captureExplain(pool, `adhoc-R${scale.R}`)
      if (summary) {
        console.log(
          `SQL execution: ${summary.executionTimeMs.toFixed(0)}ms | planning ${summary.planningTimeMs.toFixed(0)}ms | temp blocks ${summary.tempBlocks.toLocaleString()}`,
        )
      }
    } finally {
      await close()
    }
  })

program
  .command('parity')
  .description(
    'fit the same data both ways (JS MM via the baseline function, plpgsql MM) and compare scores',
  )
  .action(async () => {
    const { pool, close } = connect()
    try {
      const env = loadBenchEnv()
      // Production body first (a previous variant run may have swapped it).
      const restore = await import('node:fs/promises').then((f) =>
        f.readFile(join('src', 'bench', 'sql', 'a-dirty-restore.sql'), 'utf8'),
      )
      await pool.query(restore)

      // 1. JS MM through the real recompute path → coaster_ratings.
      const res = await fetch(`${env.supabaseUrl}/functions/v1/recompute-rankings`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.serviceKey}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (!res.ok) {
        console.error(`baseline recompute failed: HTTP ${res.status} ${await res.text()}`)
        process.exit(1)
      }
      const js = await pool.query<{ coaster_id: string; score: number }>(
        'select coaster_id, score from public.coaster_ratings',
      )
      const jsScores = new Map(js.rows.map((r) => [r.coaster_id, r.score]))

      // 2. plpgsql MM on the same data (function result only; no writes).
      const pg = await pool.query<{
        coaster_id: string
        score: number
        iterations: number
        converged: boolean
      }>('select * from public.bench_recompute_plpgsql()')
      const pgScores = new Map(pg.rows.map((r) => [r.coaster_id, r.score]))

      // 3. Compare on shared coasters.
      let maxDelta = 0
      let shared = 0
      for (const [id, jsScore] of jsScores) {
        const pgScore = pgScores.get(id)
        if (!pgScore) continue
        shared++
        maxDelta = Math.max(maxDelta, Math.abs(Math.log(pgScore / jsScore)))
      }
      const onlyJs = jsScores.size - shared
      const onlyPg = pgScores.size - shared
      console.log(`js rows: ${jsScores.size}, plpgsql rows: ${pgScores.size} (shared: ${shared})`)
      if (onlyJs > 0) console.log(`coasters only in JS fit: ${onlyJs}`)
      if (onlyPg > 0) console.log(`coasters only in plpgsql fit: ${onlyPg}`)
      console.log(`fit: iterations=${pg.rows[0]?.iterations} converged=${pg.rows[0]?.converged}`)
      console.log(
        `max |Δ log score| = ${maxDelta.toExponential(3)} — ${maxDelta < 1e-6 ? 'PARITY ✓' : 'MISMATCH ✗'}`,
      )
      if (maxDelta >= 1e-6 || onlyJs > 0 || onlyPg > 0) process.exitCode = 1
    } finally {
      await close()
    }
  })

program
  .command('churn')
  .description(
    'growth simulation: accumulating users, only the dirty set changes per epoch (reset once)',
  )
  .option('--variant <name>', 'baseline | a-dirty | b-plpgsql | ab-combined', 'ab-combined')
  .option('--rides <n>', 'ranked rides per user (uniform)', Number, 50)
  .option(
    '--schedule <list>',
    'epochs as total:changedExisting (comma-separated, non-decreasing totals)',
    '10:0,20:2,25:1,50:5,100:10,200:15,350:20,500:25,750:35,1000:50',
  )
  .option('--bursts <list>', 'totals at which a bulk-import burst user joins', '100,350,750')
  .option('--burst-rides <n>', 'ride count for the bulk-import burst user', Number, 220)
  .action(
    async (opts: {
      variant: string
      rides: number
      schedule: string
      bursts: string
      burstRides: number
    }) => {
      const { pool, close } = connect()
      try {
        await runChurn(pool, {
          variant: opts.variant,
          rides: opts.rides,
          schedule: parseSchedule(opts.schedule),
          bursts: opts.bursts
            .split(',')
            .map((s) => Number.parseInt(s.trim(), 10))
            .filter((n) => !Number.isNaN(n)),
          burstRides: opts.burstRides,
        })
      } finally {
        await close()
      }
    },
  )

program
  .command('report')
  .description('generate RESULTS.md + chart.svg + results.csv from recorded runs')
  .action(async () => {
    runReport()
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})

export { estimateR, defaultRepeats, MAX_CONSECUTIVE_FAILURES }
