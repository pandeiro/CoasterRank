// Admin-gated testride ops for the Admin Impersonate view.
//
// POST { action: 'seed', users, ridesMin, ridesMax, unranked, seed? }
// POST { action: 'cleanup' }
// GET  ?action=report  (optional — returns synthetic user count + preview)
//
// Security:
//  - Caller must be an admin (user JWT validated against GoTrue + profiles.is_admin)
//    or the service-role key (ops debugging). Same pattern as assume-identity.
//  - Targets are strictly synthetic users (email @test.coasterrank.dev OR
//    user_metadata.synthetic === true). Real users are never touched.
//  - Caps: seed limited to 50 users and 100 rides per user per call to prevent
//    accidental DB flooding from the browser.
//  - Platform JWT verification is OFF (see supabase/config.toml) so the function
//    can do its own 3-way check (cron secret not used here, just admin JWT /
//    service_role).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const SYNTHETIC_EMAIL_DOMAIN = 'test.coasterrank.dev'
const SYNTHETIC_PASSWORD = 'testride-password'
const LIST_PAGES_CAP = 50
const USERS_CAP = 500

// Safety caps for browser-triggered writes.
const SEED_USERS_MAX = 50
const SEED_RIDES_MAX = 100

function isSyntheticUser(email: string | null, metadata: Record<string, unknown>): boolean {
  const flag = metadata['synthetic'] === true
  const domain = !!email && email.toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)
  return flag || domain
}

function syntheticEmail(local: string): string {
  return `${local.toLowerCase()}@${SYNTHETIC_EMAIL_DOMAIN}`
}

// mulberry32 — same as scripts/src/testride/rand.ts so seeds are reproducible
// if the caller passes one.
function makeRng(seed: number) {
  let a = seed >>> 0
  const next = (): number => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number): number => min + Math.floor(next() * (max - min + 1))
  return {
    int,
    shuffle: <T>(arr: readonly T[]): T[] => {
      const out = [...arr]
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(0, i)
        const tmp = out[i] as T
        out[i] = out[j] as T
        out[j] = tmp
      }
      return out
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return json({ error: 'missing bearer token' }, 401)

  // service-role key (ops debugging) or an admin user JWT.
  if (token !== serviceKey) {
    const me = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: serviceKey },
    })
    if (!me.ok) return json({ error: 'invalid or expired token' }, 401)
    const user: { id?: string } = await me.json()
    if (!user.id) return json({ error: 'invalid token subject' }, 401)
    const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).single()
    if (!profile?.is_admin) return json({ error: 'admin access required' }, 403)
  }

  // GET report — lightweight synthetic count for the UI header
  if (req.method === 'GET') {
    let syntheticCount = 0
    for (let page = 1; page <= LIST_PAGES_CAP; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) return json({ error: error.message }, 500)
      const pageUsers = data?.users ?? []
      if (pageUsers.length === 0) break
      for (const u of pageUsers) {
        const meta = (u.user_metadata ?? {}) as Record<string, unknown>
        if (isSyntheticUser(u.email ?? null, meta)) syntheticCount++
      }
      if (syntheticCount >= USERS_CAP) break
      if (pageUsers.length < 200) break
    }
    return json({ syntheticCount }, 200)
  }

  // POST — seed or cleanup
  const body = (await req.json().catch(() => null)) as
    | { action?: string; users?: number; ridesMin?: number; ridesMax?: number; unranked?: number; seed?: number }
    | null
  if (!body?.action) return json({ error: 'missing action' }, 400)

  if (body.action === 'cleanup') {
    // Collect all synthetic user ids
    const targets: Array<{ id: string; email: string | null }> = []
    for (let page = 1; page <= LIST_PAGES_CAP && targets.length < USERS_CAP; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) return json({ error: error.message }, 500)
      const pageUsers = data?.users ?? []
      if (pageUsers.length === 0) break
      for (const u of pageUsers) {
        const meta = (u.user_metadata ?? {}) as Record<string, unknown>
        if (isSyntheticUser(u.email ?? null, meta)) targets.push({ id: u.id, email: u.email ?? null })
      }
      if (pageUsers.length < 200) break
    }
    if (targets.length === 0) return json({ deleted: 0, message: 'no synthetic users' }, 200)

    // Delete storage files first (avatars bucket is per-user folder)
    let storageDeleted = 0
    for (const t of targets) {
      const { data } = await admin.storage.from('avatars').list(t.id, { limit: 1000, offset: 0 })
      const files = data ?? []
      if (files.length === 0) continue
      const paths = files.map((f) => `${t.id}/${f.name}`)
      for (let i = 0; i < paths.length; i += 50) {
        const chunk = paths.slice(i, i + 50)
        const { error } = await admin.storage.from('avatars').remove(chunk)
        if (!error) storageDeleted += chunk.length
      }
    }

    let deleted = 0
    const errors: string[] = []
    for (const t of targets) {
      const { error } = await admin.auth.admin.deleteUser(t.id)
      if (error) errors.push(`${t.email ?? t.id}: ${error.message}`)
      else deleted++
    }
    return json({ deleted, storageDeleted, errors: errors.length ? errors : undefined }, 200)
  }

  if (body.action === 'seed') {
    const users = body.users ?? 0
    const ridesMin = body.ridesMin ?? 0
    const ridesMax = body.ridesMax ?? ridesMin
    const unranked = body.unranked ?? 0
    const seed = body.seed ?? 42

    if (!Number.isInteger(users) || users < 1 || users > SEED_USERS_MAX) {
      return json({ error: `users must be 1..${SEED_USERS_MAX}` }, 400)
    }
    if (!Number.isInteger(ridesMin) || !Number.isInteger(ridesMax) || ridesMin < 0 || ridesMax < ridesMin || ridesMax > SEED_RIDES_MAX) {
      return json({ error: `ridesMin/ridesMax must be 0..${SEED_RIDES_MAX} with min <= max` }, 400)
    }
    if (!Number.isInteger(unranked) || unranked < 0 || unranked > SEED_RIDES_MAX) {
      return json({ error: `unranked must be 0..${SEED_RIDES_MAX}` }, 400)
    }

    // Find max existing mock-XXXX number to continue numbering additively
    let maxExisting = 0
    for (let page = 1; page <= LIST_PAGES_CAP; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
      if (error) return json({ error: error.message }, 500)
      const pageUsers = data?.users ?? []
      if (pageUsers.length === 0) break
      for (const u of pageUsers) {
        const meta = (u.user_metadata ?? {}) as Record<string, unknown>
        const username = typeof meta['username'] === 'string' ? (meta['username'] as string) : ''
        const m = username.match(/^mock-(\d+)$/)
        if (m?.[1]) {
          const n = Number.parseInt(m[1], 10)
          if (n > maxExisting) maxExisting = n
        }
      }
      if (pageUsers.length < 200) break
    }

    // Fetch coaster ids once
    const { data: coasters, error: coastersError } = await admin.from('coasters').select('id')
    if (coastersError) return json({ error: `fetch coasters: ${coastersError.message}` }, 500)
    const coasterIds = (coasters ?? []).map((c: { id: string }) => c.id)
    if (coasterIds.length === 0) return json({ error: 'coasters table is empty; import first' }, 400)

    const rng = makeRng(seed)
    let created = 0
    let ridesInserted = 0
    const createdEmails: string[] = []
    const errors: string[] = []

    for (let i = 0; i < users; i++) {
      const num = maxExisting + i + 1
      const username = `mock-${String(num).padStart(4, '0')}`
      const email = syntheticEmail(username)
      const displayName = `Mock Rider ${num}`

      const { data: newUser, error: createError } = await admin.auth.admin.createUser({
        email,
        password: SYNTHETIC_PASSWORD,
        email_confirm: true,
        user_metadata: { username, display_name: displayName, synthetic: true },
      })
      if (createError || !newUser?.user) {
        errors.push(`${email}: ${createError?.message ?? 'create failed'}`)
        continue
      }
      const userId = newUser.user.id
      created++
      createdEmails.push(email)

      const ranked = rng.int(ridesMin, ridesMax)
      const totalNeeded = ranked + unranked
      if (totalNeeded === 0) continue

      const picked = rng.shuffle(coasterIds)
      const rows: Array<{ user_id: string; coaster_id: string; ridden: boolean; rank: number | null }> = []
      const rankedCount = Math.min(ranked, coasterIds.length)
      for (let r = 0; r < rankedCount; r++) {
        rows.push({ user_id: userId, coaster_id: picked[r] as string, ridden: true, rank: r + 1 })
      }
      for (let k = 0; k < unranked; k++) {
        const coasterId = picked[rankedCount + k]
        if (!coasterId) break
        rows.push({ user_id: userId, coaster_id: coasterId as string, ridden: true, rank: null })
      }
      if (rows.length === 0) continue
      // Chunk inserts to avoid payload limits
      for (let c = 0; c < rows.length; c += 500) {
        const chunk = rows.slice(c, c + 500)
        const { error: rideError } = await admin.from('user_rides').insert(chunk)
        if (rideError) {
          errors.push(`${email} rides: ${rideError.message}`)
          break
        } else {
          ridesInserted += chunk.length
        }
      }
    }

    return json({ created, ridesInserted, maxExisting, nextUsername: `mock-${String(maxExisting + 1).padStart(4, '0')}`, createdEmails, errors: errors.length ? errors : undefined }, 200)
  }

  return json({ error: 'unknown action' }, 400)
})
