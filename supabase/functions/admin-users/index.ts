// Admin-gated "Users" view backend — the general-purpose successor to
// assume-identity's synthetic-only listing.
//
// GET  → every user: GoTrue admin list (paginated) merged with per-user
//        aggregates from the admin_user_overview() RPC, plus baseline stats
//        computed from the merged set. No search/filter params: the SPA does
//        filtering + pagination client-side (one request; fine at current
//        scale — revisit with server-side pagination if the user table
//        outgrows a single payload).
// POST → { action: 'confirm' | 'delete', userId }
//        confirm: GoTrue admin update ({ email_confirm: true }).
//        delete: avatar storage objects are removed first (they do NOT
//        cascade), then deleteUser (FK cascade wipes profiles, user_rides and
//        coaster_submissions; ratings are derived — recompute restores them).
//
// Security:
//   - Caller must be an admin (user JWT validated against GoTrue +
//     profiles.is_admin) or the service-role key (ops debugging).
//   - Impersonation is NOT handled here — assume-identity mints the magic
//     link and enforces the synthetic-user restriction server-side.
//   - Platform-level JWT verification stays ON (default config): only
//     well-formed Supabase JWTs reach this code.
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
// GoTrue listUsers: 200/page max. 100 pages ≈ 20k users before truncation.
const LIST_PAGES_CAP = 100
const PER_PAGE = 200

interface OverviewRow {
  id: string
  username: string | null
  display_name: string | null
  avatar_url: string | null
  is_admin: boolean
  public_list: boolean
  created_at: string | null
  rides_total: number
  rides_ranked: number
  submissions_made: number
  submissions_reviewed: number
}

function isSyntheticUser(email: string | null, metadata: Record<string, unknown>): boolean {
  const flag = metadata['synthetic'] === true
  const domain = !!email && email.toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)
  return flag || domain
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
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
    const { data: profile } = await admin
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single()
    if (!profile?.is_admin) return json({ error: 'admin access required' }, 403)
  }

  if (req.method === 'GET') {
    const { data: overview, error: overviewError } = await admin.rpc('admin_user_overview')
    if (overviewError) return json({ error: overviewError.message }, 500)
    const byId = new Map<string, OverviewRow>(
      ((overview ?? []) as OverviewRow[]).map((row) => [row.id, row]),
    )

    interface MergedUser {
      id: string
      email: string
      username: string | null
      displayName: string | null
      avatarUrl: string | null
      isAdmin: boolean
      publicList: boolean
      confirmed: boolean
      synthetic: boolean
      createdAt: string | null
      ridesTotal: number
      ridesRanked: number
      submissionsMade: number
      submissionsReviewed: number
    }

    const users: MergedUser[] = []
    let truncated = false
    for (let page = 1; page <= LIST_PAGES_CAP; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE })
      if (error) return json({ error: error.message }, 500)
      const pageUsers = data?.users ?? []
      if (pageUsers.length === 0) break
      for (const u of pageUsers) {
        const metadata = (u.user_metadata ?? {}) as Record<string, unknown>
        const row = byId.get(u.id)
        users.push({
          id: u.id,
          email: u.email ?? '',
          // profiles.username is authoritative; metadata is the signup-time fallback.
          username: row?.username ?? (typeof metadata['username'] === 'string' ? (metadata['username'] as string) : null),
          displayName: row?.display_name ?? null,
          avatarUrl: row?.avatar_url ?? null,
          isAdmin: row?.is_admin ?? false,
          publicList: row?.public_list ?? false,
          confirmed: !!u.email_confirmed_at,
          synthetic: isSyntheticUser(u.email ?? null, metadata),
          createdAt: u.created_at ?? null,
          ridesTotal: row?.rides_total ?? 0,
          ridesRanked: row?.rides_ranked ?? 0,
          submissionsMade: row?.submissions_made ?? 0,
          submissionsReviewed: row?.submissions_reviewed ?? 0,
        })
      }
      if (pageUsers.length < PER_PAGE) break
      if (page === LIST_PAGES_CAP) truncated = true
    }

    const cutoff7 = daysAgoIso(7)
    const cutoff30 = daysAgoIso(30)
    const stats = {
      totalUsers: users.length,
      confirmedUsers: users.filter((u) => u.confirmed).length,
      testUsers: users.filter((u) => u.synthetic).length,
      adminUsers: users.filter((u) => u.isAdmin).length,
      rankedUsers: users.filter((u) => u.ridesRanked > 0).length,
      signups7d: users.filter((u) => !!u.createdAt && u.createdAt >= cutoff7).length,
      signups30d: users.filter((u) => !!u.createdAt && u.createdAt >= cutoff30).length,
    }
    return json({ users, stats, truncated }, 200)
  }

  // POST — confirm email / delete user.
  const body = (await req.json().catch(() => null)) as
    | { action?: 'confirm' | 'delete'; userId?: string }
    | null
  if (!body?.userId || (body.action !== 'confirm' && body.action !== 'delete')) {
    return json({ error: "expected { action: 'confirm' | 'delete', userId }" }, 400)
  }

  if (body.action === 'confirm') {
    const { error } = await admin.auth.admin.updateUserById(body.userId, { email_confirm: true })
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true }, 200)
  }

  // delete — remove avatar/og-card storage objects first (they do NOT cascade).
  const { data: objects } = await admin.storage.from('avatars').list(body.userId, {
    limit: 1000,
    offset: 0,
  })
  const paths = (objects ?? []).map((f) => `${body.userId}/${f.name}`)
  if (paths.length > 0) {
    const { error } = await admin.storage.from('avatars').remove(paths)
    if (error) return json({ error: `storage cleanup failed: ${error.message}` }, 500)
  }
  const { error } = await admin.auth.admin.deleteUser(body.userId)
  if (error) return json({ error: error.message }, 500)
  return json({ ok: true }, 200)
})
