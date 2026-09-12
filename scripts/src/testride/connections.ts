// Target resolution for testride commands. Every command runs against an
// explicit "target" project — prod by default (from .env), or a throwaway
// project via --db-url / --supabase-url / --service-key overrides.
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { Pool } from 'pg'

const __dirname = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(__dirname, '..', '..', '..', '.env') })

export interface ConnOptions {
  dbUrl?: string
  supabaseUrl?: string
  serviceKey?: string
  prod?: boolean
}

export interface Connections {
  dbUrl?: string
  supabaseUrl?: string
  serviceKey?: string
  pool?: Pool
  admin?: SupabaseClient
}

export function resolveConnections(opts: ConnOptions): Connections {
  const dbUrl = opts.dbUrl || process.env.SUPABASE_DB_URL
  const supabaseUrl = opts.supabaseUrl || process.env.SUPABASE_URL
  const serviceKey = opts.serviceKey || process.env.SUPABASE_SERVICE_ROLE_KEY
  const conns: Connections = { dbUrl, supabaseUrl, serviceKey }
  if (dbUrl) {
    conns.pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })
  }
  if (supabaseUrl && serviceKey) {
    conns.admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  }
  return conns
}

export async function closeConnections(conns: Connections): Promise<void> {
  if (conns.pool) await conns.pool.end()
}

export function requirePool(conns: Connections): Pool {
  if (!conns.pool) {
    console.error('Error: no Postgres connection. Pass --db-url or set SUPABASE_DB_URL in .env.')
    process.exit(1)
  }
  return conns.pool
}

export function requireAdmin(conns: Connections): SupabaseClient {
  if (!conns.admin) {
    console.error(
      'Error: no Supabase admin client. Pass --supabase-url and --service-key, or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.',
    )
    process.exit(1)
  }
  return conns.admin
}

// Best-effort project-ref extraction from a Supabase URL or Postgres URL.
// Handles: https://<ref>.supabase.co, https://<ref>.<region>.supabase.co,
// db.<ref>.supabase.co, and pooler URLs where the ref is the username
// (postgres.<ref>@host).
export function parseProjectRef(dbUrl?: string, supabaseUrl?: string): string | null {
  const sources = [supabaseUrl, dbUrl]
  for (const raw of sources) {
    if (!raw) continue
    // Pooler URLs carry the ref as the username: postgres.<ref>:<password>@host
    // (or passwordless postgres.<ref>@host).
    const userMatch = raw.match(/postgres\.([a-z0-9]{20})[:@]/i)
    if (userMatch?.[1]) return userMatch[1].toLowerCase()
    try {
      const host = new URL(raw).host
      const hostMatch = host.match(/([a-z0-9]{20})/i)
      if (hostMatch?.[1]) return hostMatch[1].toLowerCase()
    } catch {
      // Not a parseable URL; fall through.
    }
  }
  return null
}

function targetHost(conns: Connections): string | null {
  try {
    if (conns.supabaseUrl) return new URL(conns.supabaseUrl).host
    if (conns.dbUrl) return new URL(conns.dbUrl).host
  } catch {
    return null
  }
  return null
}

export function isProdRef(ref: string | null): boolean {
  const prodRef = process.env.PROJECT_REF?.toLowerCase()
  return !!ref && !!prodRef && ref === prodRef
}

// Prints which project a destructive/data-creating command is about to touch.
// Returns the parsed project ref (or null if unknown).
export function printBanner(label: string, conns: Connections): string | null {
  const ref = parseProjectRef(conns.dbUrl, conns.supabaseUrl)
  const host = targetHost(conns)
  console.log(`── testride ${label} ──`)
  console.log(`   target : ${host ?? 'unknown host'}`)
  console.log(`   project: ${ref ?? 'unknown ref'}`)
  if (isProdRef(ref)) console.log('   ⚠️  This is the PRODUCTION project.')
  console.log()
  return ref
}

export interface TargetInfo {
  ref: string | null
  prodRef: string | null
  /** True when the target is production — or cannot be proven otherwise. */
  isProd: boolean
  /** True when the target could not be positively identified (fail-closed). */
  unknown: boolean
}

// Resolves whether a connection target is production. Fail-closed: when
// $PROJECT_REF is unset or the target ref is unparseable, the target is
// treated as production (unknown: true) so callers demand --prod.
export function resolveTarget(conns: Connections): TargetInfo {
  const ref = parseProjectRef(conns.dbUrl, conns.supabaseUrl)
  const rawProd = process.env.PROJECT_REF?.toLowerCase() ?? ''
  const prodRef = rawProd.length > 0 ? rawProd : null
  if (!prodRef || !ref) {
    return { ref, prodRef, isProd: true, unknown: true }
  }
  return { ref, prodRef, isProd: ref === prodRef, unknown: false }
}

// Every testride command (including read-only `report`) must pass this before
// touching the target: when the target is (or may be) production, the run is
// refused unless the operator passed --prod. Exits the process on refusal.
export function requireProdConsent(
  conns: Connections,
  prodFlag: boolean | undefined,
  cmdName: string,
): TargetInfo {
  const target = resolveTarget(conns)
  if (target.isProd && !prodFlag) {
    if (target.unknown) {
      console.error(
        `Error: cannot verify testride ${cmdName} target is NOT production ` +
          `(target ref: ${target.ref ?? 'unknown'}; $PROJECT_REF ${target.prodRef ? 'is set' : 'is NOT set'}). ` +
          `Pass --prod to acknowledge the target, or retarget with --db-url / --supabase-url.`,
      )
    } else {
      console.error(
        `Error: testride ${cmdName} targets PRODUCTION (${target.ref}). ` +
          `Pass --prod to acknowledge, or retarget with --db-url / --supabase-url.`,
      )
    }
    process.exit(1)
  }
  return target
}
