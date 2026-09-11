// Admin-gated "Sharing" view backend — share-loop funnel + Web Analytics.
//
// GET → one JSON payload combining:
//   1. Funnel (admin_sharing_funnel RPC, service role): stage counts over
//      non-synthetic users, current sharers, daily signups.
//   2. Cloudflare Web Analytics (RUM) traffic on shared pages (/riders/*,
//      the /@* vanity alias, and its /%40* %-encoded form), last 30 days via
//      the GraphQL Analytics API (one request, three aliased groups; `count`
//      = pageviews, `sum.visits` = entry visits from outside the site —
//      in-app navigations add pageviews but not visits, so visits can be 0).
//      Alias + case variants merge into canonical /riders/:username rows and
//      each rider row is annotated with live profile state (sharing /
//      private / unknown) so stale paths inside the 30d window read as stale.
//      RUM secrets (CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID) are optional:
//      when absent or failing, `rum.available: false` degrades the panel —
//      the funnel half must keep working.
//
// Authentication — exactly one of (mirrors admin-users):
//   - Bearer <SUPABASE_SERVICE_ROLE_KEY>  — ops debugging via curl
//   - Bearer <user JWT of an admin>       — the SPA tab (supabase.functions.
//     invoke). The JWT is validated against GoTrue, then profiles.is_admin is
//     checked server-side. No secret ever ships to the browser.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const RUM_DAYS = 30
const RUM_HOURLY_LIMIT = 1000 // 30d = 720 hourly buckets
const TOP_PATHS_LIMIT = 20
const TOP_REFERRERS_LIMIT = 10

interface FunnelPayload {
  totals: {
    total_users: number
    with_username: number
    eligible: number
    nudged: number
    sharing_on: number
  }
  sharers: { username: string; ranked_count: number; nudged: boolean }[]
  signups_daily: { day: string; count: number }[]
}

interface RumGroup {
  count: number
  sum: { visits: number }
  avg?: { sampleInterval?: number | null } | null
  dimensions: Record<string, string>
}

export type SharedPageStatus = 'sharing' | 'private' | 'unknown'

interface RumTopPath {
  path: string
  pageviews: number
  visits: number
  /** Rider-page profile state, or null when the path isn't a /riders/:username page. */
  status: SharedPageStatus | null
}

// Shared-page routes: /riders/:username (canonical) + the /@username vanity
// alias (sometimes %-encoded as /%40username by chat apps — the worker's
// run_worker_first covers both). RUM records the raw request path, so alias
// hits arrive as /@u or /%40u rows; canonicalize + merge them so each rider
// appears once under their canonical /riders/:username path.
const RIDER_PATH_RE = /^\/riders\/([A-Za-z0-9_]{3,20})\/?$/
const RIDER_ALIAS_RE = /^\/(?:@|%40)([A-Za-z0-9_]{3,20})\/?$/i

function canonicalSharedPath(raw: string): { canonical: string; username: string } | null {
  const rider = RIDER_PATH_RE.exec(raw)
  if (rider) {
    const username = rider[1].toLowerCase()
    return { canonical: `/riders/${username}`, username }
  }
  const alias = RIDER_ALIAS_RE.exec(raw)
  if (alias) {
    const username = alias[1].toLowerCase()
    return { canonical: `/riders/${username}`, username }
  }
  return null
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function toDay(iso: string): string {
  return iso.slice(0, 10)
}

function rumUnavailable(reason: string) {
  return { available: false as const, reason }
}

async function fetchRumSharedPageTraffic(
  accountTag: string,
  apiToken: string,
  // Service-role client for annotating top paths with profile state. Optional
  // so RUM parsing stays testable without a DB handle — without it every
  // rider path annotates as unknown.
  admin?: { from: (table: string) => any },
): Promise<
  | {
      available: true
      daily: { day: string; pageviews: number; visits: number }[]
      topPaths: RumTopPath[]
      topReferrers: { host: string; pageviews: number; visits: number }[]
      /** Max avg.sampleInterval across groups — >1 means CF kept 1-in-N events. */
      sampleIntervalMax: number
    }
  | { available: false; reason: string }
> {
  const end = new Date()
  const start = new Date(end.getTime() - RUM_DAYS * 24 * 60 * 60 * 1000)
  const filter = {
    AND: [
      { datetime_geq: start.toISOString() },
      { datetime_leq: end.toISOString() },
      {
        OR: [
          { requestPath_like: '/riders%' },
          { requestPath_like: '/@%' },
          // Chat apps %-encode the alias (@ → %40); RUM stores the raw path.
          { requestPath_like: '/%40%' },
        ],
      },
      { bot: 0 },
    ],
  }
  const query = `query SharingMetrics($accountTag: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!) {
    viewer {
      accounts(filter: { accountTag: $accountTag }) {
        hourly: rumPageloadEventsAdaptiveGroups(limit: ${RUM_HOURLY_LIMIT}, orderBy: [datetimeHour_ASC], filter: $filter) {
          count
          sum { visits }
          avg { sampleInterval }
          dimensions { datetimeHour }
        }
        topPaths: rumPageloadEventsAdaptiveGroups(limit: ${TOP_PATHS_LIMIT}, orderBy: [count_DESC], filter: $filter) {
          count
          sum { visits }
          avg { sampleInterval }
          dimensions { requestPath }
        }
        topReferrers: rumPageloadEventsAdaptiveGroups(limit: ${TOP_REFERRERS_LIMIT}, orderBy: [count_DESC], filter: $filter) {
          count
          sum { visits }
          avg { sampleInterval }
          dimensions { refererHost }
        }
      }
    }
  }`

  let res: Response
  try {
    res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { accountTag, filter },
      }),
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    return rumUnavailable(
      `Cloudflare GraphQL unreachable: ${err instanceof Error ? err.message : 'network error'}`,
    )
  }
  if (!res.ok) return rumUnavailable(`Cloudflare GraphQL HTTP ${res.status}`)
  const body: { data?: unknown; errors?: { message?: string }[] } = await res
    .json()
    .catch(() => ({}))
  if (body.errors?.length) {
    return rumUnavailable(body.errors.map((e) => e.message).join('; ').slice(0, 300))
  }
  // Shape verified against the live schema (2026-09-10): three aliased
  // rumPageloadEventsAdaptiveGroups groups under viewer.accounts[0].
  type RumAccount = { hourly?: RumGroup[]; topPaths?: RumGroup[]; topReferrers?: RumGroup[] }
  const accounts = (body.data as { viewer?: { accounts?: RumAccount[] } } | undefined)?.viewer
    ?.accounts
  const account = (accounts ?? [])[0]
  if (!account) return rumUnavailable('Cloudflare GraphQL returned no account node')

  // RUM buckets are hourly — roll up to UTC days for the overlay chart.
  const byDay = new Map<string, { pageviews: number; visits: number }>()
  let sampleIntervalMax = 1
  const trackSample = (g: RumGroup) => {
    const s = g.avg?.sampleInterval
    if (typeof s === 'number' && Number.isFinite(s) && s > sampleIntervalMax) {
      sampleIntervalMax = s
    }
  }
  for (const g of account.hourly ?? []) {
    const day = toDay(g.dimensions['datetimeHour'] ?? '')
    if (!day) continue
    const acc = byDay.get(day) ?? { pageviews: 0, visits: 0 }
    acc.pageviews += g.count
    acc.visits += g.sum?.visits ?? 0
    byDay.set(day, acc)
    trackSample(g)
  }
  // Alias (/@u, /%40u) and case variants merge into the canonical
  // /riders/:username row so each rider appears once with combined counts.
  // Non-rider leftovers (e.g. /riders/x/og.png image hits) pass through.
  const merged = new Map<string, { pageviews: number; visits: number; username: string | null }>()
  for (const g of account.topPaths ?? []) {
    trackSample(g)
    const raw = g.dimensions['requestPath'] ?? ''
    const hit = raw ? canonicalSharedPath(raw) : null
    const key = hit ? hit.canonical : raw
    const acc = merged.get(key) ?? { pageviews: 0, visits: 0, username: hit?.username ?? null }
    acc.pageviews += g.count
    acc.visits += g.sum?.visits ?? 0
    if (acc.username == null) acc.username = hit?.username ?? null
    merged.set(key, acc)
  }
  const topPaths: RumTopPath[] = [...merged.entries()]
    .sort(([, a], [, b]) => b.pageviews - a.pageviews)
    .slice(0, TOP_PATHS_LIMIT)
    .map(([path, v]) => ({ path, pageviews: v.pageviews, visits: v.visits, status: null }))

  // Annotate rider rows with live profile state so stale paths (deleted or
  // never-shared usernames still inside the 30d RUM window) are visible as
  // such instead of looking like live shared pages. Best-effort: any DB
  // failure leaves statuses null rather than failing the whole payload.
  try {
    const names = [...new Set(topPaths.map((p) => merged.get(p.path)?.username).filter((u) => u != null))]
    if (admin && names.length > 0) {
      const { data: rows } = await admin.from('profiles').select('username, public_list').in('username', names)
      const byName = new Map(
        ((rows ?? []) as { username: string; public_list: boolean }[]).map((r) => [r.username, r.public_list]),
      )
      for (const p of topPaths) {
        const username = merged.get(p.path)?.username
        if (username == null) continue
        p.status = !byName.has(username) ? 'unknown' : byName.get(username) ? 'sharing' : 'private'
      }
    } else {
      for (const p of topPaths) {
        if (merged.get(p.path)?.username != null) p.status = 'unknown'
      }
    }
  } catch {
    // statuses stay null — traffic counts are still valid
  }
  return {
    available: true,
    daily: [...byDay.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([day, v]) => ({ day, ...v })),
    topPaths,
    topReferrers: (account.topReferrers ?? []).map((g) => {
      trackSample(g)
      return {
        host: g.dimensions['refererHost'] ?? '',
        pageviews: g.count,
        visits: g.sum?.visits ?? 0,
      }
    }),
    sampleIntervalMax: Math.round(sampleIntervalMax * 10) / 10,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'GET') return json({ error: 'method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  })

  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token) return json({ error: 'missing bearer token' }, 401)

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

  const { data: funnel, error: funnelError } = await admin.rpc('admin_sharing_funnel')
  if (funnelError) return json({ error: funnelError.message }, 500)

  const cfToken = Deno.env.get('CLOUDFLARE_API_TOKEN')
  const cfAccount = Deno.env.get('CLOUDFLARE_ACCOUNT_ID')
  const rum =
    cfToken && cfAccount
      ? await fetchRumSharedPageTraffic(cfAccount, cfToken, admin)
      : rumUnavailable(
          'CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID secrets not set (supabase secrets set)',
        )

  return json(
    {
      generatedAt: new Date().toISOString(),
      window: { start: isoDaysAgo(RUM_DAYS), end: new Date().toISOString() },
      funnel,
      rum,
    },
    200,
  )
})
