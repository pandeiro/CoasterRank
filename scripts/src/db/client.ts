import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { createClient } from '@supabase/supabase-js'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: join(SCRIPT_DIR, '..', '..', '..', '.env') })

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set')
  process.exit(1)
}

export const supabaseAdmin = createClient(url, key, {
  auth: { persistSession: false },
})
