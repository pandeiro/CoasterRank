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
    const userMatch = raw.match(/postgres\.([a-z0-9]{20})@/i)
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
