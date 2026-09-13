// testride:seed — create synthetic users (+ rides, optionally pending
// submissions) for manual UX testing and exercising the BT pipeline.
//
// Users are inserted directly into auth.users with email_confirmed_at set, so
// they are login-ready with NO email verification and NO SMTP involvement:
//   email:    mock_0001@test.coasterrank.dev
//   password: SYNTHETIC_PASSWORD (markers.ts)
// The handle_new_user() trigger creates their profiles rows.
//
// Manual levers only: --users, --rides (<n> or <min>-<max> ranked coasters per
// user), --unranked, --with-submissions. Dry-run by default; --apply writes.
// Purely additive: --users N creates N *additional* synthetic users, continuing
// numbering after the highest existing mock-XXXX user.
//
// Realism (default): list lengths are right-skewed (lognormal, clamped to the
// --rides bounds) and coaster inclusion/ordering is shared-popularity-biased:
// one global latent quality per coaster per run, each user's ranking = quality
// + per-user noise (Thurstone-style), so famous coasters recur and rank high
// across users instead of every list being an independent uniform shuffle.
// --uniform restores the legacy uniform counts/shuffle exactly.
import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import { printBanner, requirePool, type Connections } from './connections'
import { SYNTHETIC_PASSWORD, syntheticEmail } from './markers'
import { makeRng, type Rng } from './rand'
import { multiRowInsert } from './sql'

export interface RideSpec {
  min: number
  max: number
}

export interface SeedOptions {
  users: number
  rides: RideSpec
  unranked: number
  seed: number
  withSubmissions: boolean
  uniform: boolean
  apply: boolean
}

const USERS_CHUNK = 100
const RIDES_CHUNK = 500

// GoTrue scopes every auth query by instance_id; hosted Supabase always uses
// the zero UUID. Rows inserted with instance_id NULL (the column default) are
// invisible to GoTrue — not listed by admin users, not resolvable for login
// or generateLink — even though they exist in Postgres.
const GOTRUE_INSTANCE_ID = '00000000-0000-0000-0000-000000000000'

// GoTrue writes '' (never NULL) into these token/change-tracking text columns
// and scans them as non-nullable strings — rows with NULL there make GoTrue's
// admin list fail with "Database error finding users" (HTTP 500).
const GOTRUE_EMPTY_TEXT_COLUMNS = [
  'confirmation_token',
  'recovery_token',
  'email_change',
  'email_change_token_new',
] as const

interface RideCounts {
  ranked: number
  unranked: number
}

// Right-skewed list-length sampler: lognormal with median ~10 (mu=2.3) and
// sigma=0.8 (p90 ~28), clamped to the --rides bounds. Exact bounds (min==max,
// including 0 = no rides) stay exact; --uniform bypasses this entirely.
export const LIST_LENGTH_MU = 2.3
export const LIST_LENGTH_SIGMA = 0.8

export function realisticRankedCount(rng: Rng, rides: RideSpec): number {
  if (rides.max <= 0 || rides.min >= rides.max) return Math.max(0, rides.min)
  const sampled = Math.round(Math.exp(rng.gaussian(LIST_LENGTH_MU, LIST_LENGTH_SIGMA)))
  return Math.min(rides.max, Math.max(rides.min, sampled))
}

function rideCounts(rng: Rng, rides: RideSpec, unranked: number, uniform: boolean): RideCounts {
  return {
    ranked: uniform ? rng.int(rides.min, rides.max) : realisticRankedCount(rng, rides),
    unranked,
  }
}

interface GenUser {
  id: string
  email: string
  username: string
  displayName: string
  ranked: number
  unranked: number
}

function generateUsers(
  rng: Rng,
  rides: RideSpec,
  unranked: number,
  count: number,
  startOffset = 0,
  uniform = false,
): GenUser[] {
  const users: GenUser[] = []
  for (let i = 0; i < count; i++) {
    const num = startOffset + i + 1
    // profiles_username_format_check enforces ^[a-z0-9_]{3,20}$ — underscore, not hyphen.
    const username = `mock_${String(num).padStart(4, '0')}`
    const counts = rideCounts(rng, rides, unranked, uniform)
    users.push({
      id: randomUUID(),
      email: syntheticEmail(username),
      username,
      displayName: `Mock Rider ${num}`,
      ...counts,
    })
  }
  return users
}

async function maxExistingUsernameNumber(pool: Pool): Promise<number> {
  const res = await pool.query<{ username: string }>(
    `select raw_user_meta_data->>'username' as username from auth.users where raw_user_meta_data->>'username' like 'mock%'`,
  )
  let max = 0
  for (const row of res.rows) {
    // Tolerate the pre-hardening `mock-` spelling so old rows still count.
    const m = row.username.match(/^mock[-_](\d+)$/)
    if (m?.[1]) {
      const n = Number.parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return max
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
      'instance_id',
      'email',
      'encrypted_password',
      'email_confirmed_at',
      'raw_app_meta_data',
      'raw_user_meta_data',
      ...GOTRUE_EMPTY_TEXT_COLUMNS,
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
      undefined,
      'jsonb',
      'jsonb',
      ...GOTRUE_EMPTY_TEXT_COLUMNS.map(() => undefined as Cast | undefined),
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
        GOTRUE_INSTANCE_ID,
        u.email,
        hash,
        now,
        JSON.stringify({ provider: 'email', providers: ['email'] }),
        JSON.stringify({ username: u.username, display_name: u.displayName, synthetic: true }),
        ...GOTRUE_EMPTY_TEXT_COLUMNS.map(() => ''),
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

// Shared-popularity model (Thurstone-style):
//   - one global latent quality q_i ~ Normal(0, 1) per coaster per run,
//   - inclusion weight w_i = exp(q_i / POPULARITY_TEMPERATURE): famous
//     coasters are ridden by many users, obscure ones by few,
//   - each user's ordering = q_i + Normal(0, RIDER_NOISE): correlated across
//     users (real disagreement) instead of independent uniform shuffles.
export const POPULARITY_TEMPERATURE = 1.0
export const RIDER_NOISE = 1.0

// Deterministic in coaster-id order so the same --seed always yields the same
// board no matter how many users are seeded.
export function assignQualities(rng: Rng, coasterIds: readonly string[]): Map<string, number> {
  const qualities = new Map<string, number>()
  for (const id of coasterIds) qualities.set(id, rng.gaussian(0, 1))
  return qualities
}

function popularityWeights(qualities: ReadonlyMap<string, number>): Map<string, number> {
  const weights = new Map<string, number>()
  for (const [id, q] of qualities) weights.set(id, Math.exp(q / POPULARITY_TEMPERATURE))
  return weights
}

// Weighted sampling without replacement (Efraimidis–Spirakis: key = u^(1/w)).
export function weightedSample(
  rng: Rng,
  ids: readonly string[],
  weights: ReadonlyMap<string, number>,
  n: number,
): string[] {
  const scored = ids.map((id) => {
    const w = Math.max(weights.get(id) ?? 0, 1e-9)
    return { id, key: Math.pow(rng.float(), 1 / w) }
  })
  scored.sort((a, b) => b.key - a.key)
  return scored.slice(0, Math.max(0, Math.min(n, scored.length))).map((s) => s.id)
}

// One user's ranking of an already-chosen set: latent quality + per-rider
// noise, sorted best-first.
export function orderForUser(
  rng: Rng,
  qualities: ReadonlyMap<string, number>,
  picked: readonly string[],
): string[] {
  return [...picked]
    .map((id) => ({ id, s: (qualities.get(id) ?? 0) + rng.gaussian(0, RIDER_NOISE) }))
    .sort((a, b) => b.s - a.s)
    .map((r) => r.id)
}

export function planRides(
  rng: Rng,
  users: readonly GenUser[],
  idByEmail: Map<string, string>,
  coasterIds: readonly string[],
  uniform = false,
): RideRow[] {
  const rows: RideRow[] = []
  const qualities = uniform ? null : assignQualities(rng, coasterIds)
  const weights = qualities ? popularityWeights(qualities) : null
  for (const u of users) {
    const userId = idByEmail.get(u.email)
    if (!userId) continue
    const ranked = Math.min(u.ranked, coasterIds.length)
    const total = Math.min(u.ranked + u.unranked, coasterIds.length)
    if (uniform) {
      const picked = rng.shuffle(coasterIds)
      for (let r = 0; r < ranked; r++) {
        rows.push({ userId, coasterId: picked[r] as string, rank: r + 1 })
      }
      for (let k = 0; k < u.unranked; k++) {
        const coasterId = picked[ranked + k]
        if (!coasterId) break
        rows.push({ userId, coasterId, rank: null })
      }
      continue
    }
    const picked = weightedSample(rng, coasterIds, weights as Map<string, number>, total)
    const ordered = orderForUser(rng, qualities as Map<string, number>, picked.slice(0, ranked))
    for (let r = 0; r < ordered.length; r++) {
      rows.push({ userId, coasterId: ordered[r] as string, rank: r + 1 })
    }
    for (const coasterId of picked.slice(ranked)) {
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
  const ridesLabel =
    opts.rides.min === opts.rides.max ? `${opts.rides.min}` : `${opts.rides.min}-${opts.rides.max}`
  const modeLabel = opts.uniform ? 'uniform' : 'realistic'
  printBanner(
    `seed (users: ${opts.users}, rides: ${ridesLabel}, mode: ${modeLabel}, apply: ${opts.apply})`,
    conns,
  )
  const pool = requirePool(conns)

  const coasterRes = await pool.query<{ count: number }>(
    'select count(*)::int as count from coasters',
  )
  const coasterCount = coasterRes.rows[0]?.count ?? 0
  if (coasterCount === 0) {
    console.error('Error: coasters table is empty; run `npm run import-coasters` first.')
    process.exit(1)
  }

  const maxExisting = await maxExistingUsernameNumber(pool)
  const rng = makeRng(opts.seed)
  const users = generateUsers(rng, opts.rides, opts.unranked, opts.users, maxExisting, opts.uniform)
  const totalRanked = users.reduce((acc, u) => acc + u.ranked, 0)
  const totalUnranked = users.reduce((acc, u) => acc + u.unranked, 0)

  console.log(
    `users         : ${maxExisting} existing + ${users.length} new = ${maxExisting + users.length} total`,
  )
  console.log(`rides per user: ${ridesLabel} ranked + ${opts.unranked} unranked (${modeLabel})`)
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
  const rides = planRides(rng, users, idByEmail, coasterIds, opts.uniform)
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
