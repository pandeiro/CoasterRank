// testride:confirm — set email_confirmed_at for users that need to log in but
// whose email cannot be verified (synthetic users, manual test signups whose
// inbox you don't control).
//
// Safety: confirming a NON-synthetic email requires --any-email, because it
// would verify an account you may not own.
import { printBanner, requirePool, type Connections } from './connections'
import { isSyntheticEmail, SYNTHETIC_PREDICATE, TEST_EMAIL_DOMAIN } from './markers'

export interface ConfirmOptions {
  email?: string
  synthetic: boolean
  anyEmail: boolean
  apply: boolean
}

interface UserRow {
  id: string
  email: string | null
  confirmed: boolean
}

export async function runConfirm(conns: Connections, opts: ConfirmOptions): Promise<void> {
  printBanner(`confirm (apply: ${opts.apply})`, conns)
  const pool = requirePool(conns)
  const client = await pool.connect()
  try {
    if (opts.email) {
      const email = opts.email.toLowerCase().trim()
      if (!isSyntheticEmail(email) && !opts.anyEmail) {
        console.error(
          `Error: "${email}" is not on the synthetic domain (@${TEST_EMAIL_DOMAIN}). Confirming it would verify an account you may not own — pass --any-email to force.`,
        )
        process.exit(1)
      }
      const res = await client.query<UserRow>(
        `select u.id, u.email, (u.email_confirmed_at is not null) as confirmed
         from auth.users u where lower(u.email) = $1`,
        [email],
      )
      const row = res.rows[0]
      if (!row) {
        console.error(`No user found with email ${email}`)
        process.exit(1)
      }
      if (row.confirmed) {
        console.log(`${row.email} (${row.id}) is already confirmed. Nothing to do.`)
        return
      }
      if (!opts.apply) {
        console.log(`Would confirm ${row.email} (${row.id}). Re-run with --apply.`)
        return
      }
      await client.query('update auth.users set email_confirmed_at = now() where id = $1', [row.id])
      console.log(`Confirmed ${row.email} (${row.id}). This user can now log in and rank.`)
      return
    }

    if (opts.synthetic) {
      const res = await client.query<UserRow>(
        `select u.id, u.email, (u.email_confirmed_at is not null) as confirmed
         from auth.users u
         where ${SYNTHETIC_PREDICATE} and u.email_confirmed_at is null`,
        [`%@${TEST_EMAIL_DOMAIN}`],
      )
      const rows = res.rows
      if (rows.length === 0) {
        console.log('No unconfirmed synthetic users. Nothing to do.')
        return
      }
      for (const r of rows) console.log(`  ${r.email ?? r.id}`)
      if (!opts.apply) {
        console.log(`\nWould confirm ${rows.length} synthetic user(s). Re-run with --apply.`)
        return
      }
      const upd = await client.query(
        `update auth.users u set email_confirmed_at = now()
         where ${SYNTHETIC_PREDICATE} and u.email_confirmed_at is null`,
        [`%@${TEST_EMAIL_DOMAIN}`],
      )
      console.log(`Confirmed ${upd.rowCount ?? 0} synthetic user(s).`)
      return
    }

    console.error('Error: pass --email <address> or --synthetic.')
    process.exit(1)
  } finally {
    client.release()
  }
}
