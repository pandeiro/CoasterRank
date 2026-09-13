// Growth simulation: the recompute pipeline's realistic steady state is NOT
// the grid's reset-and-reseed pattern — users accumulate over time and each
// cron slot processes only the DIRTY set (new users + existing users who
// edited their rankings). This sim walks a schedule of epochs
// `{totalUsers, changedExisting}`, accumulates state, and records per-run
// cost against both axes: total data (R, P) and the dirty set (count, R_dirty).
//
// Two runs per epoch: 'apply' (right after the changes) and 'idle' (nothing
// changed — the warm floor; for dirty-tracking variants nothing should
// re-process, for baseline it re-does everything).
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Pool } from 'pg'
import { REPO_ROOT } from './env'
import { resolveVariant } from './variants'
import { resetBenchData } from './reset'
import { measureScale } from './measure'
import { invokeRecompute } from './recompute'
import { makeUsers, planRides, insertUsers, insertRides, rngFor } from './seed'
import type { BenchUser } from './seed'

const CHURN_JSONL = join(REPO_ROOT, 'scripts', 'src', 'bench', 'results', 'churn.jsonl')

export interface ChurnEpochSpec {
  total: number
  changed: number
}

export function parseSchedule(spec: string): ChurnEpochSpec[] {
  return spec.split(',').map((part) => {
    const m = part.trim().match(/^(\d+)(?::(\d+))?$/)
    if (!m) throw new Error(`bad schedule epoch "${part}" (want total:changed)`)
    return { total: Number.parseInt(m[1] as string, 10), changed: Number.parseInt(m[2] ?? '0', 10) }
  })
}

export interface ChurnOptions {
  variant: string
  rides: number
  schedule: ChurnEpochSpec[]
  bursts: number[]
  burstRides: number
}

export interface ChurnSample {
  ts: string
  variant: string
  epoch: number
  run: 'apply' | 'idle'
  totalUsers: number
  newUsers: number
  changedUsers: number
  burstUsers: number
  ridesPerUser: number
  dirtyUsers: number | null
  dirtyR: number | null
  R: number
  P: number | null
  ok: boolean
  invokeMs: number
  durationMs: number | null
  rpcMs: number | null
  rpcBytes: number | null
  iterations: number | null
  error: string | null
}

// One user re-ranks: wipe their rides, re-rank from a fresh seed. The dirty
// triggers (when installed) mark them automatically.
async function mutateUser(
  pool: Pool,
  userId: string,
  rides: number,
  coasterIds: readonly string[],
  rng: ReturnType<typeof rngFor>,
): Promise<void> {
  await pool.query('delete from public.user_rides where user_id = $1', [userId])
  const user: BenchUser = { id: userId, email: '', username: '', rides }
  const rideRows = planRides(rng, [user], coasterIds)
  await insertRides(pool, rideRows)
}

async function countDirty(pool: Pool): Promise<number | null> {
  try {
    const res = await pool.query<{ count: string }>(
      'select count(*)::text as count from bench.dirty_users',
    )
    return Number.parseInt(res.rows[0]?.count ?? '0', 10)
  } catch {
    return null // dirty machinery not installed (baseline/b variants)
  }
}

async function dirtyR(pool: Pool): Promise<number | null> {
  try {
    const res = await pool.query<{ r: string }>(
      `select coalesce(sum(n * (n - 1) / 2), 0)::text as r
       from (
         select ur.user_id, count(*)::bigint as n
         from public.user_rides ur
         where ur.rank is not null
           and ur.user_id in (select user_id from bench.dirty_users)
         group by ur.user_id
       ) s`,
    )
    return Number.parseInt(res.rows[0]?.r ?? '0', 10)
  } catch {
    return null
  }
}

async function countFitPairs(pool: Pool): Promise<number | null> {
  try {
    const res = await pool.query<{ count: string }>(
      'select count(*)::text as count from bench.fit_pairs',
    )
    return Number.parseInt(res.rows[0]?.count ?? '0', 10)
  } catch {
    return null
  }
}

interface HarvestedLog {
  ok: boolean
  invokeMs: number
  durationMs: number | null
  rpcMs: number | null
  rpcBytes: number | null
  pairs: number | null
  iterations: number | null
  error: string | null
}

async function runOnce(pool: Pool, functionName: string): Promise<HarvestedLog> {
  const startedAt = new Date(Date.now() - 3000)
  const invoke = await invokeRecompute(functionName)
  const res = await pool.query(
    `select status, duration_ms, pairs, iterations, error_message, rpc_stats->'pairwise_wins' as pairwise
     from public.cron_execution_logs
     where created_at > $1
     order by created_at desc
     limit 1`,
    [startedAt.toISOString()],
  )
  const log = (res.rows[0] ?? null) as {
    status: string
    duration_ms: number | null
    pairs: number | null
    iterations: number | null
    error_message: string | null
    pairwise: { ms?: number; bytes?: number } | null
  } | null
  return {
    ok: invoke.ok && log?.status === 'success',
    invokeMs: invoke.invokeMs,
    durationMs: log?.duration_ms ?? null,
    rpcMs: log?.pairwise?.ms ?? null,
    pairs: log?.pairs ?? null,
    rpcBytes: log?.pairwise?.bytes ?? null,
    iterations: log?.iterations ?? null,
    error: invoke.ok
      ? (log?.error_message ?? null)
      : `invoke: HTTP ${invoke.status} ${invoke.body.slice(0, 120)}`,
  }
}

export async function runChurn(pool: Pool, opts: ChurnOptions): Promise<void> {
  const v = resolveVariant(opts.variant)
  console.log(`\n══ churn simulation — variant ${v.name} (rides/user: ${opts.rides}) ══`)

  for (const sqlFile of v.restoreSql) await pool.query(readFileSync(sqlFile, 'utf8'))
  for (const sqlFile of v.installSql) await pool.query(readFileSync(sqlFile, 'utf8'))
  await resetBenchData(pool)
  // Fresh accumulation: the sim models a system growing from zero, so clear
  // any dirty marks / pair rows left by earlier variant runs.
  try {
    await pool.query('truncate bench.dirty_users')
    await pool.query('truncate bench.user_pairs')
  } catch {
    // variant has no dirty machinery — nothing to clear
  }

  mkdirSync(join(REPO_ROOT, 'scripts', 'src', 'bench', 'results'), { recursive: true })
  const coasterRes = await pool.query<{ id: string }>('select id from coasters order by id')
  const coasterIds = coasterRes.rows.map((r) => r.id)

  let prevTotal = 0
  let createdSoFar = 0
  let consecutiveFailures = 0

  for (const [epochIdx, spec] of opts.schedule.entries()) {
    const newCount = spec.total - prevTotal
    if (newCount < 0) throw new Error(`schedule must be non-decreasing (epoch ${epochIdx + 1})`)
    const burstHere = opts.bursts.includes(spec.total)
    const burstCount = burstHere ? 1 : 0

    // 1. New users join (bulk import burst = one extra user with a big list).
    let burstRidesInserted = 0
    if (newCount > 0) {
      const users = makeUsers('churn', newCount, opts.rides).map((u, i): BenchUser => ({
        ...u,
        id: u.id,
        username: `churn_${String(createdSoFar + i + 1).padStart(4, '0')}`,
        email: `churn_${String(createdSoFar + i + 1).padStart(4, '0')}@bench.coasterrank.dev`,
      }))
      createdSoFar += newCount
      await insertUsers(pool, users)
      const rideRows = planRides(rngFor(`${v.name}-churn-e${epochIdx}`), users, coasterIds)
      await insertRides(pool, rideRows)
    }
    if (burstCount > 0) {
      const burstUser = makeUsers('churnburst', 1, opts.burstRides).map((u): BenchUser => ({
        ...u,
        username: `churn_${String(createdSoFar + 1).padStart(4, '0')}`,
        email: `churn_${String(createdSoFar + 1).padStart(4, '0')}@bench.coasterrank.dev`,
      }))
      createdSoFar += 1
      await insertUsers(pool, burstUser)
      const rideRows = planRides(
        rngFor(`${v.name}-churn-burst-e${epochIdx}`),
        burstUser,
        coasterIds,
      )
      await insertRides(pool, rideRows)
      burstRidesInserted = rideRows.length
    }

    // 2. Existing users edit their rankings.
    if (spec.changed > 0) {
      const existingRes = await pool.query<{ id: string }>(
        `select u.id from auth.users u
         join public.profiles p on p.id = u.id
         where p.is_admin = false and u.email like 'churn_%@bench.coasterrank.dev'
         order by u.id`,
      )
      const ids = existingRes.rows.map((r) => r.id)
      const rng = rngFor(`${v.name}-churn-mut-e${epochIdx}`)
      const picked = rng.shuffle(ids).slice(0, Math.min(spec.changed, ids.length))
      for (const id of picked) await mutateUser(pool, id, opts.rides, coasterIds, rng)
    }

    // 3. Record the epoch's state, then run apply + idle.
    const dirtyUsers = await countDirty(pool)
    const dirtyRVal = dirtyUsers !== null ? await dirtyR(pool) : null
    const { R, usersRanking } = await measureScale(pool)

    const applyRes = await runOnce(pool, v.functionName)
    const idleRes = await runOnce(pool, v.functionName)
    // Distinct-pair total: fit_pairs for in-DB-fit variants (exactly P rows);
    // otherwise the log's own pairs field.
    const P = (await countFitPairs(pool)) ?? applyRes.pairs

    for (const [runName, harvested] of [
      ['apply', applyRes],
      ['idle', idleRes],
    ] as const) {
      const sample: ChurnSample = {
        ts: new Date().toISOString(),
        variant: v.name,
        epoch: epochIdx + 1,
        run: runName,
        totalUsers: spec.total + burstCount,
        newUsers: newCount,
        changedUsers: spec.changed,
        burstUsers: burstCount,
        ridesPerUser: opts.rides,
        dirtyUsers,
        dirtyR: dirtyRVal,
        R,
        P,
        ok: harvested.ok,
        invokeMs: harvested.invokeMs,
        durationMs: harvested.durationMs,
        rpcMs: harvested.rpcMs,
        rpcBytes: harvested.rpcBytes,
        iterations: harvested.iterations,
        error: harvested.error,
      }
      appendFileSync(CHURN_JSONL, `${JSON.stringify(sample)}\n`)
    }

    const fmtMs = (h: HarvestedLog) =>
      h.ok
        ? `${h.durationMs ?? h.invokeMs}ms rpc=${h.rpcMs ?? '?'}ms`
        : `FAILED: ${(h.error ?? '').slice(0, 70)}`
    console.log(
      `  e${epochIdx + 1}: total=${spec.total}${burstCount ? `+1burst(${burstRidesInserted} rides)` : ''} new=${newCount} changed=${spec.changed} dirty=${dirtyUsers ?? '—'} R=${R.toLocaleString()}${dirtyRVal !== null ? ` Rdirty=${dirtyRVal.toLocaleString()}` : ''}`,
    )
    console.log(`     apply: ${fmtMs(applyRes)} | idle: ${fmtMs(idleRes)}`)

    consecutiveFailures = applyRes.ok || idleRes.ok ? 0 : consecutiveFailures + 1
    if (consecutiveFailures >= 2) {
      console.log(`  stopping: 2 consecutive failed epochs — the break point for this variant`)
      break
    }
    prevTotal = spec.total + burstCount
  }

  for (const sqlFile of v.restoreSql) await pool.query(readFileSync(sqlFile, 'utf8'))
  console.log(`\nchurn complete — report via \`npm run bench -- report\``)
}
