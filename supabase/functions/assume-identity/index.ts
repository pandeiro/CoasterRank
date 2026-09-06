// Admin-gated "assume identity" for synthetic/test users (testride ecosystem).
//
// POST → { userId, redirectTo } → GoTrue magiclink generateLink for that
//        user. The SPA navigates to the returned action link, which logs the
//        admin's browser in AS the synthetic user (no password, no email).
//        (User listing moved to the admin-users Edge Function.)
//
// Security:
//   - Caller must be an admin (user JWT validated against GoTrue +
//     profiles.is_admin) or the service-role key (ops debugging).
//   - The TARGET must match the synthetic markers — enforced here, server
//     side, so this function can never mint a login for a real user.
//   - The gateway does not replace this boundary: requests carrying an
//     apikey can reach this function, so bearer validation and the admin
//     profile lookup below are authoritative.
//
// Action links are single-use and short-lived (GoTrue magiclink defaults).
// The SPA backs up the admin session before navigating and restores it on
// "Return to admin" (app/src/lib/impersonation.ts).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3'

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

function isSyntheticUser(email: string | null, metadata: Record<string, unknown>): boolean {
  const flag = metadata['synthetic'] === true
  const domain = !!email && email.toLowerCase().endsWith(`@${SYNTHETIC_EMAIL_DOMAIN}`)
  return flag || domain
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405)

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

  // Generate a magiclink for a synthetic user.
  const body = (await req.json().catch(() => null)) as
    | { userId?: string; redirectTo?: string }
    | null
  if (!body?.userId) return json({ error: 'missing userId' }, 400)

  const { data: target, error: targetError } = await admin.auth.admin.getUserById(body.userId)
  if (targetError || !target?.user) return json({ error: 'user not found' }, 404)

  const targetUser = target.user
  const metadata = (targetUser.user_metadata ?? {}) as Record<string, unknown>
  if (!targetUser.email || !isSyntheticUser(targetUser.email, metadata)) {
    return json({ error: 'only synthetic users can be impersonated' }, 403)
  }

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetUser.email,
    options: { redirectTo: body.redirectTo },
  })
  if (linkError || !link?.properties?.action_link) {
    return json({ error: linkError?.message ?? 'failed to generate login link' }, 500)
  }
  return json({ actionLink: link.properties.action_link }, 200)
})
