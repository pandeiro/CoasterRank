// testride:seed — create synthetic users (+ ranked rides, optionally pending
// submissions) for manual UX testing and BT benchmarking.
//
// Users are inserted directly into auth.users with email_confirmed_at set, so
// they are login-ready with NO email verification and NO SMTP involvement:
//   email:    <username>@test.coasterrank.dev
//   password: SYNTHETIC_PASSWORD (markers.ts)
// The handle_new_user() trigger creates their profiles rows.
//
// Dry-run by default; --apply writes. Deterministic for a given --seed:
// re-runs skip existing users; rides are ON CONFLICT DO NOTHING.
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import {
  isProdRef,
  parseProjectRef,
  printBanner,
  requirePool,
  type Connections,
} from './connections'
import { SYNTHETIC_PASSWORD, syntheticEmail } from './markers'
import { makeRng, type Rng } from './rand'
import { multiRowInsert } from './sql'

export type SeedProfile = 'ux' | 'benchmark'

export interface SeedOptions {
  profile: SeedProfile
  users: number
  seed: number
  withSubmissions: boolean
  apply: boolean
  iKnowThisIsProd: boolean
}

const USERS_CHUNK = 100
const RIDES_CHUNK = 500

interface RideCounts {
  ranked: number
  unranked: number
}

// Benchmark distribution (all rides ranked): ~70% casual / 20% mid / 10% power.
// 500 users -> ~17k ranked rides, matching the task-2.3 "~500 users, ~15k
// rides" baseline; escalate via --users (2000 -> ~70k, 5000 -> ~175k).
function rideCounts(rng: Rng, profile: SeedProfile): RideCounts {
  if (profile === 'ux') {
    return { ranked: rng.int(5, 25), unranked: rng.int(0, 5) }
  }
  const roll = rng.float()
  if (roll < 0.7) return { ranked: rng.int(10, 30), unranked: 0 }
  if (roll < 0.9) return { ranked: rng.int(31, 70), unranked: 0 }
  return { ranked: rng.int(71, 150), unranked: 0 }
}

const UX_WORDS = [
  'otter',
  'falcon',
  'maple',
  'cedar',
  'ripple',
  'summit',
  'canyon',
  'lynx',
  'harbor',
  'ember',
  'willow',
  'quartz',
  'mango',
  'pebble',
  'comet',
  'basin',
] as const

interface GenUser {
  id: string
  email: string
  username: string
  displayName: string
  ranked: number
  unranked: number
}

function generateUsers(rng: Rng, profile: SeedProfile, count: number): GenUser[] {
  const users: GenUser[] = []
  for (let i = 0; i < count; i++) {
    const username =
      profile === 'benchmark'
        ? `bench-${String(i + 1).padStart(4, '0')}`
        : `ux-${rng.pick(UX_WORDS)}-${rng.int(10, 99)}`
    const word = rng.pick(UX_WORDS)
    const displayName =
      profile === 'benchmark'
        ? `Bench Rider ${i + 1}`
        : `UX ${word.charAt(0).toUpperCase() + word.slice(1)} Tester`
    const counts = rideCounts(rng, profile)
    users.push({
      id: randomUUID(),
      email: syntheticEmail(username),
      username,
      displayName,
      ...counts,
    })
  }
  return users
}

// Refuse benchmark-scale writes against prod (or an unidentifiable target)
// unless explicitly acknowledged. Small ux seeds are always allowed.
function guard(conns: Connections, opts: SeedOptions): void {
  const ref = parseProjectRef(conns.dbUrl, conns.supabaseUrl)
  if (opts.profile !== 'benchmark' || !opts.apply || opts.iKnowThisIsProd) return
  const prod = isProdRef(ref)
  if (prod || ref === null) {
    console.error(
      ref === null
        ? 'Error: could not determine the target project ref; benchmark-scale seeding requires explicit acknowledgement. Re-run with --i-know-this-is-prod if this is really not prod.'
        : 'Error: refusing to benchmark-seed the PRODUCTION project. Re-run with --i-know-this-is-prod if you really mean this.',
    )
    process.exit(1)
  }
}

interface ExistingRow {
  id: string
  email: string
}

type Cast = string | undefined

async function insertUsers(
  pool: Pool,
  users: GenUser[],
): Promise<{ created: number; idByEmail: Map<string, string> }> {
  const client = await pool.connect()
  try {
    // One shared bcrypt hash for all synthetic users (cheap; test data only).
    const hashRes = await client.query<{ crypt: string }>(
      "select extensions.crypt($1, extensions.gen_salt('bf')) as crypt",
      [SYNTHETIC_PASSWORD],
    )
    const hash = hashRes.rows[0]?.crypt
    if (!hash) throw new Error('failed to compute password hash')

    const emails = users.map((u) => u.email)
    const existingRes = await client.query<ExistingRow>(
      'select id, email from auth.users where lower(email) = any($1::text[])',
      [emails],
    )
    const idByEmail = new Map<string, string>(
      existingRes.rows.map((r) => [r.email.toLowerCase(), r.id]),
    )

    const toCreate = users.filter((u) => !idByEmail.has(u.email))
    const columns = [
      'id',
      'aud',
      'role',
      'email',
      'encrypted_password',
      'email_confirmed_at',
      'raw_app_meta_data',
      'raw_user_meta_data',
      'created_at',
      'updated_at',
    ] as const
    const casts: readonly Cast[] = [
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'jsonb',
      'jsonb',
      undefined,
      undefined,
    ]
    const now = new Date()
    let created = 0
    for (let i = 0; i < toCreate.length; i += USERS_CHUNK) {
      const slice = toCreate.slice(i, i + USERS_CHUNK)
      const rows = slice.map((u) => [
        u.id,
        'authenticated',
        'authenticated',
        u.email,
        hash,
        now,
        JSON.stringify({ provider: 'email', providers: ['email'] }),
        JSON.stringify({ username: u.username, display_name: u.displayName, synthetic: true }),
        now,
        now,
      ])
      const { sql, params } = multiRowInsert('auth.users', columns, casts, rows)
      const res = await client.query(sql, params)
      created += res.rowCount ?? 0
      for (const u of slice) idByEmail.set(u.email, u.id)
    }
    return { created, idByEmail }
  } finally {
    client.release()
  }
}

interface RideRow {
  userId: string
  coasterId: string
  rank: number | null
}

function planRides(
  rng: Rng,
  users: readonly GenUser[],
  idByEmail: Map<string, string>,
  coasterIds: readonly string[],
): RideRow[] {
  const rows: RideRow[] = []
  for (const u of users) {
    const userId = idByEmail.get(u.email)
    if (!userId) continue
    const picked = rng.shuffle(coasterIds)
    const ranked = Math.min(u.ranked, coasterIds.length)
    for (let r = 0; r < ranked; r++) {
      rows.push({ userId, coasterId: picked[r] as string, rank: r + 1 })
    }
    for (let k = 0; k < u.unranked; k++) {
      const coasterId = picked[ranked + k]
      if (!coasterId) break
      rows.push({ userId, coasterId, rank: null })
    }
  }
  return rows
}

async function insertRides(pool: Pool, rides: readonly RideRow[]): Promise<number> {
  if (rides.length === 0) return 0
  const client = await pool.connect()
  try {
    let inserted = 0
    for (let i = 0; i < rides.length; i += RIDES_CHUNK) {
      const rows = rides.slice(i, i + RIDES_CHUNK).map((r) => [r.userId, r.coasterId, true, r.rank])
      const { sql, params } = multiRowInsert(
        'user_rides',
        ['user_id', 'coaster_id', 'ridden', 'rank'],
        [undefined, undefined, undefined, undefined],
        rows,
      )
      const res = await client.query(`${sql} on conflict (user_id, coaster_id) do nothing`, params)
      inserted += res.rowCount ?? 0
    }
    return inserted
  } finally {
    client.release()
  }
}

async function insertSubmissions(
  pool: Pool,
  users: readonly GenUser[],
  idByEmail: Map<string, string>,
): Promise<number> {
  const rows = users
    .map((u, i) => ({ userId: idByEmail.get(u.email), i }))
    .filter((r): r is { userId: string; i: number } => !!r.userId)
    .map((r) => [`Test Coaster ${r.i + 1}`, `Test Park ${r.i + 1}`, r.userId])
  if (rows.length === 0) return 0
  const client = await pool.connect()
  try {
    const { sql, params } = multiRowInsert(
      'coaster_submissions',
      ['coaster_name', 'park_name', 'submitted_by'],
      [undefined, undefined, undefined],
      rows,
    )
    const res = await client.query(sql, params)
    return res.rowCount ?? 0
  } finally {
    client.release()
  }
}

export async function runSeed(conns: Connections, opts: SeedOptions): Promise<void> {
  guard(conns, opts)
  printBanner(`seed (${opts.profile}, apply: ${opts.apply})`, conns)
  const pool = requirePool(conns)

  const coasterRes = await pool.query<{ count: number }>(
    'select count(*)::int as count from coasters',
  )
  const coasterCount = coasterRes.rows[0]?.count ?? 0
  if (coasterCount === 0) {
    console.error('Error: coasters table is empty; run `npm run import-coasters` first.')
    process.exit(1)
  }

  const rng = makeRng(opts.seed)
  const users = generateUsers(rng, opts.profile, opts.users)
  const totalRanked = users.reduce((acc, u) => acc + u.ranked, 0)
  const totalUnranked = users.reduce((acc, u) => acc + u.unranked, 0)

  console.log(`profile       : ${opts.profile}`)
  console.log(`users         : ${users.length}`)
  console.log(
    `rides planned : ${totalRanked} ranked + ${totalUnranked} unranked (coasters available: ${coasterCount})`,
  )
  if (!opts.apply) {
    console.log('\nDry-run complete. Re-run with --apply to write to the database.')
    return
  }

  const { created, idByEmail } = await insertUsers(pool, users)
  const coasterRows = await pool.query<{ id: string }>('select id from coasters order by id')
  const coasterIds = coasterRows.rows.map((r) => r.id)
  const rides = planRides(rng, users, idByEmail, coasterIds)
  const ridesInserted = await insertRides(pool, rides)
  const submissionsCreated = opts.withSubmissions
    ? await insertSubmissions(pool, users, idByEmail)
    : 0

  console.log(`\nUsers created : ${created} (${users.length - created} already existed)`)
  console.log(`Rides ensured : ${ridesInserted} of ${rides.length} planned (rest already present)`)
  if (opts.withSubmissions) {
    console.log(`Submissions   : ${submissionsCreated} pending in the admin queue`)
  }
  const sample = users[0]
  if (sample) {
    console.log('\nLog in as any seeded user (no email verification needed):')
    console.log(`  email   : ${sample.email}`)
    console.log(`  password: ${SYNTHETIC_PASSWORD}`)
    console.log("  (or use the admin page's 'Assume identity' feature)")
  }
  console.log('\nNext: run `npm run testride:recompute` to refresh the board.')
}
