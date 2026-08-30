import { execSync, spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { buildPlan, executePlan, type DecisionsFile } from './apply.js'
import { loadDb } from './lib.js'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations')
const CONTAINER = 'cr-apply-test'
const PORT = 55432
const URL = `postgresql://postgres:test@localhost:${PORT}/postgres`

function sh(cmd: string, opts: { ok?: boolean } = {}): string {
  try {
    return execSync(cmd, { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    if (opts.ok) return ''
    throw err
  }
}

async function waitForDb(pool: Pool, tries = 30): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      await pool.query('select 1')
      return
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  throw new Error('scratch postgres never became ready')
}

const SHIM = `
create schema if not exists extensions;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  email_confirmed_at timestamptz
);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
create or replace function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
create schema if not exists storage;
create table if not exists storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text,
  name text,
  owner uuid,
  metadata jsonb
);
create table if not exists storage.buckets (id text primary key, name text, public boolean default false);
create schema if not exists vault;
create table if not exists vault.decrypted_secrets (uuid uuid, name text, secret text);
-- stub: the real is_admin() comes from rls_policies.sql; applier runs as superuser (RLS bypassed)
-- so a stub only needs to keep dependent migrations parsing.
create or replace function public.is_admin() returns boolean language sql stable as $$ select false $$;
`

async function main(): Promise<void> {
  if (!sh('docker info', { ok: true })) {
    console.error('SKIP: docker daemon not running')
    process.exit(0)
  }
  sh(`docker rm -f ${CONTAINER}`, { ok: true })
  console.log('Starting scratch postgres (postgres:17-alpine)...')
  sh('docker pull -q postgres:17-alpine', { ok: true })
  sh(
    `docker run -d --name ${CONTAINER} -e POSTGRES_PASSWORD=test -p ${PORT}:5432 postgres:17-alpine`,
  )

  const pool = new Pool({ connectionString: URL })
  try {
    await waitForDb(pool)

    console.log('Applying shim prelude + migrations (tolerating supabase-only pieces)...')
    await pool.query(SHIM)
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    let failed = 0
    for (const f of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf-8')
      try {
        await pool.query(sql)
      } catch (err) {
        failed++
        console.log(
          `  (non-fatal) ${f}: ${err instanceof Error ? err.message.split('\n')[0] : err}`,
        )
      }
    }
    console.log(`  ${files.length - failed}/${files.length} migrations applied cleanly`)

    const core = await pool.query(`
      select count(*)::int as n from information_schema.tables
      where table_schema = 'public' and table_name in
        ('parks','coasters','manufacturers','user_rides','coaster_ratings','coaster_aliases','coaster_submissions')`)
    if (core.rows[0].n < 7)
      throw new Error(`core tables missing (${core.rows[0].n}/7) — shim approach failed`)

    console.log('Seeding fixtures...')
    await pool.query(`
      insert into parks (id, name, slug, source) values
        ('00000000-0000-0000-0000-000000000001', 'Other (unknown location)', 'other', 'open-csv'),
        ('00000000-0000-0000-0000-000000000002', 'SeaWorld Orlando', 'seaworld-orlando', 'open-csv'),
        ('00000000-0000-0000-0000-000000000003', 'SeaWorld San Diego', 'seaworld-san-diego', 'open-csv'),
        ('00000000-0000-0000-0000-000000000004', 'SeaWorld San Antonio', 'seaworld-san-antonio', 'open-csv'),
        ('00000000-0000-0000-0000-000000000005', 'Six Flags Great America', 'six-flags-great-america', 'open-csv'),
        ('00000000-0000-0000-0000-000000000006', 'Six Flags Mexico', 'six-flags-mexico', 'open-csv'),
        ('00000000-0000-0000-0000-000000000007', 'Six Flags México', 'six-flags-mexico-2', 'open-csv');
      insert into manufacturers (id, name, slug) values
        ('00000000-0000-0000-0000-0000000000aa', 'Bolliger & Mabillard', 'bolliger-mabillard'),
        ('00000000-0000-0000-0000-0000000000ab', 'Mack Rides', 'mack-rides');
      insert into coasters (id, park_id, name, slug, manufacturer_id, opening_date, status, material, source, external_id) values
        ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Batman: The Ride', 'batman-the-ride', null, '1992-01-01', 'unknown', 'steel', 'open-csv', 'batman-the-ride@other'),
        ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000005', 'Batman: The Ride', 'batman-the-ride', '00000000-0000-0000-0000-0000000000aa', '1993-01-01', 'operating', 'steel', 'open-csv', 'batman-the-ride@six-flags-great-america'),
        ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-000000000002', 'Journey to Atlantis', 'journey-to-atlantis', '00000000-0000-0000-0000-0000000000ab', '1998-04-17', 'operating', 'steel', 'open-csv', 'journey-to-atlantis@seaworld-orlando'),
        ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-000000000002', 'Journey to Atlantis', 'journey-to-atlantis-2004', '00000000-0000-0000-0000-0000000000ab', '1998-04-17', 'operating', 'steel', 'open-csv', 'journey-to-atlantis-2004@seaworld-orlando'),
        ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-000000000002', 'Journey to Atlantis', 'journey-to-atlantis-2007', '00000000-0000-0000-0000-0000000000ab', '1998-04-17', 'operating', 'steel', 'open-csv', 'journey-to-atlantis-2007@seaworld-orlando'),
        ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-000000000006', 'Ride A', 'ride-a', null, null, 'operating', 'steel', 'open-csv', null),
        ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-000000000007', 'Ride B', 'ride-b', null, null, 'operating', 'steel', 'open-csv', null);
      insert into auth.users (id, email, email_confirmed_at) values
        ('00000000-0000-0000-0000-0000000000f1', 'rider@test.dev', now()),
        ('00000000-0000-0000-0000-0000000000f2', 'rider2@test.dev', now());
      insert into user_rides (user_id, coaster_id, ridden, rank) values
        ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000104', true, 1),
        ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000103', true, 2),
        ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-000000000101', true, 3),
        ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000101', true, 1),
        ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-000000000102', true, 2);
      insert into coaster_submissions (coaster_name, park_name, park_id, status, submitted_by) values
        ('Some Proposal', 'Six Flags México', '00000000-0000-0000-0000-000000000007', 'pending', '00000000-0000-0000-0000-0000000000f1');
    `)

    const decisions: DecisionsFile = {
      schemaVersion: 1,
      note: 'integration fixtures',
      items: [
        {
          id: 'ORPH-001',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: '00000000-0000-0000-0000-000000000104',
            coaster_name: 'Journey to Atlantis',
            from_park: 'seaworld-orlando',
            to_park_slug: 'seaworld-san-diego',
          },
        },
        {
          id: 'ORPH-002',
          kind: 'orphan_rehome',
          action: 'rehome',
          title: '',
          decided: true,
          payload: {
            coaster_id: '00000000-0000-0000-0000-000000000105',
            coaster_name: 'Journey to Atlantis',
            from_park: 'seaworld-orlando',
            to_park_slug: 'seaworld-san-antonio',
          },
        },
        {
          id: 'ORPH-003',
          kind: 'coaster_merge',
          action: 'merge_coasters',
          title: '',
          decided: true,
          payload: {
            survivor_id: '00000000-0000-0000-0000-000000000102',
            merge_ids: ['00000000-0000-0000-0000-000000000101'],
            aliases: ['Z-Force'],
            overrides: { opening_date: '1992-05-09' },
          },
        },
        {
          id: 'PARK-001',
          kind: 'park_merge',
          action: 'merge_parks',
          title: '',
          decided: true,
          payload: {
            survivor_id: '00000000-0000-0000-0000-000000000006',
            merge_ids: ['00000000-0000-0000-0000-000000000007'],
          },
        },
        {
          id: 'MISS-001',
          kind: 'create_coaster',
          action: 'create_coaster',
          title: '',
          decided: true,
          payload: {
            name: 'Palindrome',
            park_name: 'COTALand',
            park_slug: 'cotaland',
            park_create: true,
            opening_year: '2026',
            material: 'steel',
            status: 'operating',
            suggested_manufacturer: 'Gerstlauer',
          },
        },
      ],
    }

    process.env.SUPABASE_DB_URL = URL
    const db = await loadDb()
    const manufs = await pool.query('select id, name from manufacturers order by name')
    const snap = { ...db, manufacturers: manufs.rows }
    const plan = buildPlan(decisions, snap)
    console.log(
      `Plan: ${plan.ops.length} ops, ${plan.skipped.length} skipped, ${plan.warnings.length} warnings`,
    )
    for (const s of plan.skipped) console.log(`  SKIPPED ${s.id}: ${s.reason}`)
    for (const w of plan.warnings) console.log(`  NOTE ${w}`)
    if (plan.ops.length !== 6)
      throw new Error(
        `expected 6 ops (2 rehome + 1 create_park + 1 merge + 1 park_merge + 1 create_coaster), got ${plan.ops.length}`,
      )

    console.log('Executing against scratch DB (--apply semantics)...')
    const result = await executePlan(pool, plan)
    if (!result.ok) throw new Error(`apply failed: ${result.error}`)
    for (const r of result.opResults) console.log(`  ✓ #${r.seq} (${r.ref}) ${r.describe}`)

    console.log('Asserting end state...')
    const assertEq = async (sql: string, expected: unknown, label: string): Promise<void> => {
      const res = await pool.query(sql)
      const got = res.rows[0]?.v
      if (String(got) !== String(expected))
        throw new Error(`ASSERT ${label}: expected ${expected}, got ${got}`)
      console.log(`  ✓ ${label}`)
    }
    await assertEq(
      `select p.slug as v from coasters c join parks p on p.id=c.park_id where c.id='00000000-0000-0000-0000-000000000104'`,
      'seaworld-san-diego',
      'JTA 2004 re-homed to San Diego',
    )
    await assertEq(
      `select p.slug as v from coasters c join parks p on p.id=c.park_id where c.id='00000000-0000-0000-0000-000000000105'`,
      'seaworld-san-antonio',
      'JTA 2007 re-homed to San Antonio',
    )
    await assertEq(
      `select count(*)::int as v from coasters where id='00000000-0000-0000-0000-000000000101'`,
      0,
      'Batman orphan deleted by merge',
    )
    await assertEq(
      `select opening_date::text as v from coasters where id='00000000-0000-0000-0000-000000000102'`,
      '1992-05-09',
      'Batman survivor year fixed via override',
    )
    await assertEq(
      `select count(*)::int as v from coaster_aliases where name = 'Z-Force'`,
      1,
      'Z-Force alias inserted',
    )
    await assertEq(
      `select count(*)::int as v from user_rides where user_id='00000000-0000-0000-0000-0000000000f1' and coaster_id='00000000-0000-0000-0000-000000000102'`,
      1,
      'loser ride remapped to survivor (non-conflicting)',
    )
    await assertEq(
      `select count(*)::int as v from user_rides where user_id='00000000-0000-0000-0000-0000000000f2'`,
      1,
      'conflicting ride deduped: f2 keeps only the survivor ride',
    )
    await assertEq(
      `select count(*)::int as v from user_rides where coaster_id='00000000-0000-0000-0000-000000000101'`,
      0,
      'no rides left on the deleted loser',
    )
    await assertEq(
      `select count(*)::int as v from parks where slug='six-flags-mexico-2'`,
      0,
      'loser park deleted',
    )
    await assertEq(
      `select count(*)::int as v from coasters where park_id='00000000-0000-0000-0000-000000000006'`,
      2,
      'coasters remapped into survivor park',
    )
    await assertEq(
      `select park_id as v from coaster_submissions where coaster_name='Some Proposal'`,
      '00000000-0000-0000-0000-000000000006',
      'submission re-pointed to survivor park',
    )
    await assertEq(
      `select count(*)::int as v from coasters c join parks p on p.id=c.park_id where c.name='Palindrome' and p.slug='cotaland'`,
      1,
      'Palindrome created with new park',
    )
    await assertEq(
      `select count(*)::int as v from manufacturers m join coasters c on c.manufacturer_id=m.id where c.name='Palindrome'`,
      0,
      'unknown manufacturer left NULL',
    )
    await assertEq(
      `select opening_date::text as v from coasters where name='Palindrome'`,
      '2026-01-01',
      'Palindrome opening year applied',
    )

    console.log('\nINTEGRATION OK — all assertions passed.')
  } finally {
    await pool.end()
    sh(`docker rm -f ${CONTAINER}`, { ok: true })
    console.log('Scratch container removed.')
  }
}

main().catch((err) => {
  console.error('INTEGRATION FAILED:', err instanceof Error ? err.message : err)
  try {
    execSync(`docker rm -f ${CONTAINER}`, { stdio: 'ignore' })
  } catch {
    /* ignore */
  }
  process.exit(1)
})
