// testride:cleanup — delete synthetic/test users and everything they own.
//
// Targets: --synthetic (either marker), --emails a@x,c@y, and/or --ids uuid.
// profiles/user_rides/coaster_submissions cascade from auth.users; avatar
// storage objects do NOT (deleted via the service-role storage API first);
// coaster_ratings are derived (run testride:recompute afterwards).
//
// Preview by default; --yes executes.
import { printBanner, requirePool, type Connections } from './connections'
import { SYNTHETIC_PREDICATE, TEST_EMAIL_DOMAIN } from './markers'
import { parseCsv } from './sql'

export interface CleanupOptions {
  synthetic: boolean
  emails?: string
  ids?: string
  yes: boolean
}

interface TargetUser {
  id: string
  email: string | null
  username: string | null
}

interface CountRow {
  count: number
}

interface CountsRow {
  rides: number
  subs: number
  reviews: number
}

async function storagePaths(conns: Connections, targets: readonly TargetUser[]): Promise<string[]> {
  const admin = conns.admin
  if (!admin) {
    console.log(
      '\n⚠️  No service-role client (--supabase-url/--service-key): avatar storage files will be ORPHANED by this cleanup.',
    )
    return []
  }
  const paths: string[] = []
  for (const t of targets) {
    const { data } = await admin.storage.from('avatars').list(t.id, { limit: 1000, offset: 0 })
    for (const f of data ?? []) paths.push(`${t.id}/${f.name}`)
  }
  return paths
}

export async function runCleanup(conns: Connections, opts: CleanupOptions): Promise<void> {
  printBanner(`cleanup (apply: ${opts.yes})`, conns)
  const pool = requirePool(conns)
  const client = await pool.connect()

  const byId = new Map<string, TargetUser>()
  const add = (rows: TargetUser[]): void => {
    for (const r of rows) byId.set(r.id, r)
  }
  try {
    if (opts.synthetic) {
      const res = await client.query<TargetUser>(
        `select u.id, u.email, u.raw_user_meta_data->>'username' as username
         from auth.users u where ${SYNTHETIC_PREDICATE}`,
        [`%@${TEST_EMAIL_DOMAIN}`],
      )
      add(res.rows)
    }
    const emails = parseCsv(opts.emails)
    if (emails.length > 0) {
      const res = await client.query<TargetUser>(
        `select u.id, u.email, u.raw_user_meta_data->>'username' as username
         from auth.users u where lower(u.email) = any($1::text[])`,
        [emails],
      )
      add(res.rows)
    }
    const ids = parseCsv(opts.ids)
    if (ids.length > 0) {
      const res = await client.query<TargetUser>(
        `select u.id, u.email, u.raw_user_meta_data->>'username' as username
         from auth.users u where u.id = any($1::uuid[])`,
        [ids],
      )
      add(res.rows)
    }
  } finally {
    client.release()
  }

  if (byId.size === 0) {
    console.log('No matching users. Nothing to do.')
    return
  }
  const targets = [...byId.values()]
  const uuids = targets.map((t) => t.id)

  const countRes = await pool.query<CountsRow>(
    `select
       (select count(*)::int from user_rides where user_id = any($1::uuid[])) as rides,
       (select count(*)::int from coaster_submissions where submitted_by = any($1::uuid[])) as subs,
       (select count(*)::int from coaster_submissions where reviewed_by = any($1::uuid[])) as reviews`,
    [uuids],
  )
  const counts = countRes.rows[0]

  console.log(`Targets: ${targets.length} user(s)`)
  for (const t of targets.slice(0, 30)) {
    console.log(`  ${t.email ?? t.id}${t.username ? ` (@${t.username})` : ''}`)
  }
  if (targets.length > 30) console.log(`  …and ${targets.length - 30} more`)
  console.log('\nWill delete (FK cascade):')
  console.log(`  profiles            : ${targets.length}`)
  console.log(`  user_rides          : ${counts?.rides ?? 0}`)
  console.log(`  submissions (their) : ${counts?.subs ?? 0}`)
  if ((counts?.reviews ?? 0) > 0) {
    console.log(
      `  ⚠️  ${counts?.reviews ?? 0} submission(s) REVIEWED by these users: reviewer (reviewed_by) will be set to NULL (rows kept).`,
    )
  }

  const storageScanStarted = Date.now()
  const storage = await storagePaths(conns, targets)
  const storageScanSecs = ((Date.now() - storageScanStarted) / 1000).toFixed(1)
  console.log(`  storage files       : ${storage.length}`)
  console.log(`  (scanned ${targets.length} user(s) via storage API in ${storageScanSecs}s)`)

  if (!opts.yes) {
    console.log('\nDry run. Re-run with --yes to delete.')
    return
  }

  const admin = conns.admin
  let storageDeleted = 0
  if (admin && storage.length > 0) {
    for (let i = 0; i < storage.length; i += 50) {
      const chunk = storage.slice(i, i + 50)
      const { error } = await admin.storage.from('avatars').remove(chunk)
      if (error) {
        console.error(`  storage remove error: ${error.message} (continuing)`)
      } else {
        storageDeleted += chunk.length
      }
    }
  }
  console.log(`Storage files deleted: ${storageDeleted}`)

  const poolStats = (): string =>
    `total=${pool.totalCount} idle=${pool.idleCount} waiting=${pool.waitingCount}`
  console.log(`\nPool stats before delete: ${poolStats()}`)
  let deleted = 0
  try {
    const delRes = await pool.query(
      'delete from auth.users where id = any($1::uuid[]) returning id',
      [uuids],
    )
    deleted = delRes.rowCount ?? 0
  } catch (err) {
    console.error(`\nDelete failed: ${err instanceof Error ? err.message : String(err)}`)
    console.error(`Pool stats at failure: ${poolStats()}`)
    console.error(
      'Hint: pg-pool may have reaped the idle connection (default idleTimeoutMillis=10s) during the storage phase.',
    )
    process.exitCode = 1
    throw err
  }

  const verifyRes = await pool.query<CountRow>(
    'select count(*)::int as count from auth.users where id = any($1::uuid[])',
    [uuids],
  )
  const remaining = verifyRes.rows[0]?.count ?? 0

  console.log(`\nUsers deleted: ${deleted} (remaining matching: ${remaining})`)
  if (remaining > 0) {
    console.error('⚠️  Some targets were not deleted — inspect manually.')
    process.exitCode = 1
  }
  console.log('\nNext: run `npm run testride:recompute` to restore the board (derived ratings).')
}
