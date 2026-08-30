// testride:report — show synthetic users, recent (non-synthetic) users — the
// candidates for manual-test cleanup — and what each owns.
import { printBanner, requirePool, type Connections } from './connections'
import { isSyntheticEmail, TEST_EMAIL_DOMAIN } from './markers'

export interface ReportOptions {
  all: boolean
  limit: number
}

interface ReportRow {
  id: string
  email: string | null
  username: string | null
  display_name: string | null
  is_admin: boolean | null
  created_at: string | Date
  confirmed: boolean
  synthetic_meta: boolean
  rides: number
  ranked: number
  submissions: number
  reviews: number
}

const QUERY = `
  select u.id,
         u.email,
         u.raw_user_meta_data->>'username' as username,
         p.display_name,
         p.is_admin,
         u.created_at,
         (u.email_confirmed_at is not null) as confirmed,
         ((u.raw_user_meta_data->>'synthetic') = 'true') as synthetic_meta,
         (select count(*)::int from user_rides r where r.user_id = u.id) as rides,
         (select count(*)::int from user_rides r where r.user_id = u.id and r.rank is not null) as ranked,
         (select count(*)::int from coaster_submissions s where s.submitted_by = u.id) as submissions,
         (select count(*)::int from coaster_submissions s where s.reviewed_by = u.id) as reviews
  from auth.users u
  left join profiles p on p.id = u.id
  order by u.created_at desc
`

function trunc(value: string | null, width: number): string {
  const s = value ?? ''
  return s.length > width ? `${s.slice(0, width - 1)}…` : s
}

function pad(value: string | null, width: number): string {
  return trunc(value, width).padEnd(width)
}

function formatDate(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString() : value
  return iso.slice(0, 10)
}

function printTable(rows: readonly ReportRow[], title: string): void {
  console.log(`\n── ${title} (${rows.length}) ──`)
  if (rows.length === 0) {
    console.log('  (none)')
    return
  }
  console.log(
    pad('email', 34) +
      pad('username', 18) +
      pad('adm', 4) +
      pad('ok', 3) +
      pad('rides', 13) +
      pad('subs', 5) +
      pad('rev', 4) +
      'created',
  )
  for (const r of rows) {
    console.log(
      pad(r.email, 34) +
        pad(r.username, 18) +
        pad(r.is_admin ? 'yes' : '', 4) +
        pad(r.confirmed ? 'y' : 'n', 3) +
        pad(`${r.rides} (${r.ranked})`, 13) +
        pad(String(r.submissions), 5) +
        pad(String(r.reviews), 4) +
        formatDate(r.created_at),
    )
  }
}

async function storageCounts(
  conns: Connections,
  users: readonly ReportRow[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  const admin = conns.admin
  if (!admin) {
    console.log('\n(storage counts skipped: pass --supabase-url and --service-key)')
    return counts
  }
  for (const u of users.slice(0, 50)) {
    const { data } = await admin.storage.from('avatars').list(u.id, { limit: 1000, offset: 0 })
    counts.set(u.id, data?.length ?? 0)
  }
  return counts
}

export async function runReport(conns: Connections, opts: ReportOptions): Promise<void> {
  printBanner('report', conns)
  const pool = requirePool(conns)
  const res = await pool.query<ReportRow>(QUERY)
  const rows = res.rows

  const isSynthetic = (r: ReportRow): boolean => r.synthetic_meta || isSyntheticEmail(r.email)
  const synthetic = rows.filter(isSynthetic)
  const others = rows.filter((r) => !isSynthetic(r))

  console.log(`\nUsers total: ${rows.length}`)
  console.log(`  synthetic (either marker): ${synthetic.length}`)
  console.log(`  other (incl. real users) : ${others.length}`)

  // Marker drift: users matching exactly one marker will be missed by bulk
  // operations that assume the markers agree — surface them loudly.
  const metaOnly = synthetic.filter((r) => r.synthetic_meta && !isSyntheticEmail(r.email))
  const emailOnly = synthetic.filter((r) => !r.synthetic_meta && isSyntheticEmail(r.email))
  for (const r of metaOnly) {
    console.log(`  ⚠️  meta-flag only (email not on @${TEST_EMAIL_DOMAIN}): ${r.email ?? r.id}`)
  }
  for (const r of emailOnly) {
    console.log(`  ⚠️  email-domain only (metadata flag missing): ${r.email ?? r.id}`)
  }

  printTable(synthetic, 'synthetic users')
  printTable(
    opts.all ? others.slice(0, opts.limit) : others.slice(0, 15),
    opts.all
      ? `other users (limit ${opts.limit})`
      : 'other users — 15 most recent (candidates for manual-test cleanup; use --all for more)',
  )

  const counts = await storageCounts(conns, synthetic)
  if (counts.size > 0) {
    const withFiles = [...counts.entries()].filter(([, n]) => n > 0)
    console.log(`\nStorage objects (avatars bucket): ${withFiles.length} user folder(s) with files`)
    for (const [id, n] of withFiles.slice(0, 20)) {
      const email = synthetic.find((u) => u.id === id)?.email ?? id
      console.log(`  ${pad(email, 34)} ${n} file(s)`)
    }
    if (withFiles.length > 20) console.log(`  …and ${withFiles.length - 20} more`)
  }
}
