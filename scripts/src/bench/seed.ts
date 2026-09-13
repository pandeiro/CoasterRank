// Bench seeder: creates BENCH-ELIGIBLE synthetic users. Unlike testride users
// (whose `synthetic` marker and @test.coasterrank.dev emails make
// pairwise_wins() skip them), bench users must be seen by the aggregation:
//   - email domain: @bench.coasterrank.dev (passes the eligibility filter)
//   - raw_user_meta_data.bench = true (harness/cleanup marker only)
// List lengths are exact (--rides N → every user ranks exactly N coasters) so
// R is deterministic. Ranking order reuses testride's shared-popularity model
// (latent quality + per-rider noise) so P/R ≈ prod's ~0.62 ratio.
import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import { makeRng, type Rng } from '../testride/rand'
import { multiRowInsert } from '../testride/sql'
import { assignQualities, orderForUser, popularityWeights, weightedSample } from '../testride/seed'

export const BENCH_EMAIL_DOMAIN = 'bench.coasterrank.dev'

// GoTrue quirks — same as scripts/src/testride/seed.ts (kept in sync there).
const GOTRUE_INSTANCE_ID = '00000000-0000-0000-0000-000000000000'
const GOTRUE_EMPTY_TEXT_COLUMNS = [
  'confirmation_token',
  'recovery_token',
  'email_change',
  'email_change_token_new',
] as const

export interface BenchUser {
  id: string
  email: string
  username: string
  rides: number
}

function labelSeed(label: string): number {
  let h = 2166136261
  for (const ch of label) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Stable per-point rng: the same label always generates the same board, so the
// baseline grid and the dirty-tracking variant later compare identical data.
export function rngFor(label: string): Rng {
  return makeRng(labelSeed(label))
}

export function makeUsers(label: string, users: number, rides: number): BenchUser[] {
  return Array.from({ length: users }, (_, i): BenchUser => {
    const handle = `${label}_${String(i + 1).padStart(4, '0')}`
    return {
      id: randomUUID(),
      email: `${handle.toLowerCase()}@${BENCH_EMAIL_DOMAIN}`,
      username: handle.toLowerCase(),
      rides,
    }
  })
}

export async function insertUsers(
  db: Pool | PoolClient,
  users: readonly BenchUser[],
): Promise<void> {
  if (users.length === 0) return
  const hashRes = await db.query<{ crypt: string }>(
    "select extensions.crypt('bench-password', extensions.gen_salt('bf')) as crypt",
  )
  const hash = hashRes.rows[0]?.crypt
  if (!hash) throw new Error('failed to compute password hash')
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
  const casts: readonly (string | undefined)[] = [
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    'jsonb',
    'jsonb',
    ...GOTRUE_EMPTY_TEXT_COLUMNS.map(() => undefined),
    undefined,
    undefined,
  ]
  const now = new Date()
  for (let i = 0; i < users.length; i += 100) {
    const slice = users.slice(i, i + 100)
    const rows = slice.map((u) => [
      u.id,
      'authenticated',
      'authenticated',
      GOTRUE_INSTANCE_ID,
      u.email,
      hash,
      now,
      JSON.stringify({ provider: 'email', providers: ['email'] }),
      JSON.stringify({ username: u.username, display_name: u.username, bench: true }),
      ...GOTRUE_EMPTY_TEXT_COLUMNS.map(() => ''),
      now,
      now,
    ])
    const { sql, params } = multiRowInsert('auth.users', columns, casts, rows)
    await db.query(sql, params)
  }
}

interface RideRow {
  userId: string
  coasterId: string
  rank: number
}

// Popularity-biased ranking, identical to testride's realistic model.
export function planRides(
  rng: Rng,
  users: readonly BenchUser[],
  coasterIds: readonly string[],
): RideRow[] {
  const rows: RideRow[] = []
  const qualities = assignQualities(rng, coasterIds)
  const weights = popularityWeights(qualities)
  for (const u of users) {
    const picked = weightedSample(rng, coasterIds, weights, Math.min(u.rides, coasterIds.length))
    const ordered = orderForUser(rng, qualities, picked)
    for (let r = 0; r < ordered.length; r++) {
      rows.push({ userId: u.id, coasterId: ordered[r] as string, rank: r + 1 })
    }
  }
  return rows
}

export async function insertRides(pool: Pool, rides: readonly RideRow[]): Promise<number> {
  if (rides.length === 0) return 0
  const client = await pool.connect()
  try {
    let inserted = 0
    for (let i = 0; i < rides.length; i += 500) {
      const rows = rides.slice(i, i + 500).map((r) => [r.userId, r.coasterId, true, r.rank])
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

export interface SeedResult {
  users: number
  ridesInserted: number
  coastersAvailable: number
}

export async function seedGridPoint(
  pool: Pool,
  label: string,
  users: number,
  rides: number,
): Promise<SeedResult> {
  const rng = rngFor(label)
  const benchUsers = makeUsers(label, users, rides)
  const coasterRes = await pool.query<{ id: string }>('select id from coasters order by id')
  const coasterIds = coasterRes.rows.map((r) => r.id)
  if (coasterIds.length === 0) throw new Error('coasters table is empty')
  await insertUsers(pool, benchUsers)
  const rideRows = planRides(rng, benchUsers, coasterIds)
  const inserted = await insertRides(pool, rideRows)
  return { users: benchUsers.length, ridesInserted: inserted, coastersAvailable: coasterIds.length }
}

// Bulk-import burst: insert every user + ride inside ONE transaction, so the
// recompute that follows sees freshly-written data with no ANALYZE pass (the
// "cold stats" case a bulk import burst produces in prod).
export async function seedGridPointBurst(
  pool: Pool,
  label: string,
  users: number,
  rides: number,
): Promise<SeedResult> {
  const rng = rngFor(label)
  const benchUsers = makeUsers(label, users, rides)
  const coasterRes = await pool.query<{ id: string }>('select id from coasters order by id')
  const coasterIds = coasterRes.rows.map((r) => r.id)
  if (coasterIds.length === 0) throw new Error('coasters table is empty')
  const rideRows = planRides(rng, benchUsers, coasterIds)
  const client = await pool.connect()
  try {
    await client.query('begin')
    await insertUsers(client, benchUsers)
    for (let i = 0; i < rideRows.length; i += 500) {
      const rows = rideRows.slice(i, i + 500).map((r) => [r.userId, r.coasterId, true, r.rank])
      const { sql, params } = multiRowInsert(
        'user_rides',
        ['user_id', 'coaster_id', 'ridden', 'rank'],
        [undefined, undefined, undefined, undefined],
        rows,
      )
      await client.query(`${sql} on conflict (user_id, coaster_id) do nothing`, params)
    }
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
  return {
    users: benchUsers.length,
    ridesInserted: rideRows.length,
    coastersAvailable: coasterIds.length,
  }
}
