// Bench environment: loads ONLY `.env.bench` from the repo root — never the
// prod `.env`. Refuses to run against the production project ref (tripwire).
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
export const REPO_ROOT = join(__dirname, '..', '..', '..')

const res = dotenv.config({ path: join(REPO_ROOT, '.env.bench') })
if (res.error) {
  console.error(
    'Error: .env.bench not found at repo root. See docs/research/benchmarks/2026-09-pairwise/.',
  )
  process.exit(1)
}

export const PROD_REF = 'zqwmjnpauzqfgkocxfoy'

export interface BenchEnv {
  projectRef: string
  supabaseUrl: string
  serviceKey: string
  dbUrl: string
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) {
    console.error(`Error: ${name} missing from .env.bench`)
    process.exit(1)
  }
  return v
}

export function loadBenchEnv(): BenchEnv {
  const env: BenchEnv = {
    projectRef: required('BENCH_PROJECT_REF'),
    supabaseUrl: required('BENCH_SUPABASE_URL'),
    serviceKey: required('BENCH_SERVICE_KEY'),
    dbUrl: required('BENCH_DB_URL'),
  }
  if (
    env.projectRef === PROD_REF ||
    env.supabaseUrl.includes(PROD_REF) ||
    env.dbUrl.includes(PROD_REF)
  ) {
    console.error('FATAL: .env.bench points at the PRODUCTION project ref. Refusing to run.')
    process.exit(1)
  }
  return env
}
