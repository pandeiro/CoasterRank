#!/usr/bin/env node
// testride — mock + test data lifecycle for CoasterRank.
//
//   npm run testride:seed      — create synthetic users (+rides [+submissions])
//   npm run testride:report    — inspect synthetic + recent users
//   npm run testride:cleanup   — delete synthetic/test users and their data
//   npm run testride:confirm   — email-verification workaround for test logins
//   npm run testride:recompute — refresh derived ratings after seed/cleanup
//
// Targets prod (.env) by default; any other project via
// --db-url / --supabase-url / --service-key.
import { Command } from 'commander'
import {
  closeConnections,
  resolveConnections,
  type ConnOptions,
  type Connections,
} from './connections'
import { runSeed, type RideSpec, type SeedOptions } from './seed'
import { runReport } from './report'
import { runCleanup } from './cleanup'
import { runConfirm } from './confirm'
import { runRecompute } from './recompute'

async function runAction(
  opts: ConnOptions,
  fn: (conns: Connections) => Promise<void>,
): Promise<void> {
  const conns = resolveConnections(opts)
  try {
    await fn(conns)
  } finally {
    await closeConnections(conns)
  }
}

function parseIntArg(value: string, flag: string): number {
  const n = Number.parseInt(value, 10)
  if (!Number.isInteger(n) || n < 0) {
    console.error(`Error: --${flag} must be a non-negative integer (got "${value}")`)
    process.exit(1)
  }
  return n
}

// --rides accepts a single number ("30") or an inclusive range ("10-25").
function parseRidesSpec(value: string | undefined): RideSpec {
  if (!value) return { min: 0, max: 0 }
  const single = value.match(/^(\d+)$/)
  if (single) {
    const n = Number.parseInt(single[1] as string, 10)
    return { min: n, max: n }
  }
  const range = value.match(/^(\d+)-(\d+)$/)
  if (range) {
    const min = Number.parseInt(range[1] as string, 10)
    const max = Number.parseInt(range[2] as string, 10)
    if (min > max) {
      console.error(`Error: --rides range "${value}" has min > max`)
      process.exit(1)
    }
    return { min, max }
  }
  console.error(`Error: --rides must be <n> or <min>-<max> (got "${value}")`)
  process.exit(1)
}

const program = new Command()
program
  .name('testride')
  .description('Mock + test data lifecycle for CoasterRank (synthetic users, rides, cleanup).')
  .version('0.1.0')

const withConn = (cmd: Command): Command =>
  cmd
    .option('--db-url <url>', 'Postgres connection string (default: $SUPABASE_DB_URL)')
    .option('--supabase-url <url>', 'Supabase project URL (default: $SUPABASE_URL)')
    .option('--service-key <key>', 'Service-role key (default: $SUPABASE_SERVICE_ROLE_KEY)')

interface SeedCliOpts extends ConnOptions {
  users: string
  rides?: string
  unranked: string
  seed: string
  withSubmissions: boolean
  apply: boolean
}

withConn(program.command('seed'))
  .description('Create synthetic users (+rides [+submissions]). Dry-run unless --apply.')
  .requiredOption('-u, --users <n>', 'number of synthetic users to create')
  .option(
    '--rides <n|min-max>',
    'ranked coasters per user (each user gets a random count in the range)',
  )
  .option('--unranked <n>', 'extra ridden-but-unranked coasters per user', '0')
  .option('--seed <n>', 'PRNG seed for deterministic generation', '42')
  .option(
    '--with-submissions',
    'also create a pending submission per user (admin-queue testing)',
    false,
  )
  .option('--apply', 'write to the database', false)
  .action(async (raw: SeedCliOpts) => {
    const opts: SeedOptions = {
      users: parseIntArg(raw.users, 'users'),
      rides: parseRidesSpec(raw.rides),
      unranked: parseIntArg(raw.unranked, 'unranked'),
      seed: parseIntArg(raw.seed, 'seed'),
      withSubmissions: raw.withSubmissions,
      apply: raw.apply,
    }
    await runAction(raw, (conns) => runSeed(conns, opts))
  })

interface ReportCliOpts extends ConnOptions {
  all: boolean
  limit: string
}

withConn(program.command('report'))
  .description('Show synthetic users, recent users, and what each owns.')
  .option('--all', 'list all users (up to --limit) instead of synthetic + 15 recent', false)
  .option('--limit <n>', 'max users listed with --all', '100')
  .action(async (raw: ReportCliOpts) => {
    await runAction(raw, (conns) =>
      runReport(conns, { all: raw.all, limit: parseIntArg(raw.limit, 'limit') }),
    )
  })

interface CleanupCliOpts extends ConnOptions {
  synthetic: boolean
  emails?: string
  ids?: string
  yes: boolean
}

withConn(program.command('cleanup'))
  .description('Delete synthetic/test users and everything they own. Preview unless --yes.')
  .option('--synthetic', 'target all users matching the synthetic markers', false)
  .option('--emails <csv>', 'target exact emails (comma-separated)')
  .option('--ids <csv>', 'target exact user ids (comma-separated)')
  .option('--yes', 'execute the deletion', false)
  .action(async (raw: CleanupCliOpts) => {
    if (!raw.synthetic && !raw.emails && !raw.ids) {
      console.error('Error: pass --synthetic, --emails, or --ids (at least one target).')
      process.exit(1)
    }
    await runAction(raw, (conns) =>
      runCleanup(conns, {
        synthetic: raw.synthetic,
        emails: raw.emails,
        ids: raw.ids,
        yes: raw.yes,
      }),
    )
  })

interface ConfirmCliOpts extends ConnOptions {
  email?: string
  synthetic: boolean
  anyEmail: boolean
  apply: boolean
}

withConn(program.command('confirm'))
  .description('Email-verification workaround: set email_confirmed_at for test users.')
  .option('--email <address>', 'confirm one user by exact email')
  .option('--synthetic', 'confirm ALL unconfirmed synthetic users', false)
  .option('--any-email', 'allow confirming a non-synthetic email (dangerous)', false)
  .option('--apply', 'write to the database', false)
  .action(async (raw: ConfirmCliOpts) => {
    await runAction(raw, (conns) =>
      runConfirm(conns, {
        email: raw.email,
        synthetic: raw.synthetic,
        anyEmail: raw.anyEmail,
        apply: raw.apply,
      }),
    )
  })

withConn(program.command('recompute'))
  .description('Invoke the recompute-rankings Edge Function (service-role).')
  .action(async (raw: ConnOptions) => {
    await runAction(raw, (conns) => runRecompute(conns))
  })

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
