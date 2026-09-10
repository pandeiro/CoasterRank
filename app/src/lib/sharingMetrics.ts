// Admin "Sharing" tab client (app-side of the admin-sharing-metrics Edge
// Function): share-loop funnel over real users + CF Web Analytics (RUM)
// traffic on shared pages. Panel in components/admin/SharingPanel.
import { supabase } from './supabase'

export interface FunnelTotals {
  totalUsers: number
  withUsername: number
  eligible: number
  nudged: number
  sharingOn: number
}

export interface SharerRow {
  username: string
  rankedCount: number
  nudged: boolean
}

export interface DailyCount {
  day: string
  count: number
}

export interface RumDaily {
  day: string
  pageviews: number
  visits: number
}

export interface RumTopPath {
  path: string
  pageviews: number
  visits: number
}

export interface RumTopReferrer {
  host: string
  pageviews: number
  visits: number
}

export type RumSection =
  | {
      available: true
      daily: RumDaily[]
      topPaths: RumTopPath[]
      topReferrers: RumTopReferrer[]
    }
  | { available: false; reason: string }

export interface SharingMetrics {
  generatedAt: string
  window: { start: string; end: string }
  funnel: {
    totals: FunnelTotals
    sharers: SharerRow[]
    signupsDaily: DailyCount[]
  }
  rum: RumSection
}

/** Edge-function payload (SQL function emits snake_case) before mapping. */
interface SharingMetricsRaw {
  generatedAt: string
  window: { start: string; end: string }
  funnel: {
    totals: {
      total_users: number
      with_username: number
      eligible: number
      nudged: number
      sharing_on: number
    }
    sharers: { username: string; ranked_count: number; nudged: boolean }[]
    signups_daily: DailyCount[]
  }
  rum: RumSection
}

/** Raw edge-function JSON → camelCase. */
function mapFunnel(raw: SharingMetricsRaw['funnel']): SharingMetrics['funnel'] {
  return {
    totals: {
      totalUsers: raw.totals.total_users ?? 0,
      withUsername: raw.totals.with_username ?? 0,
      eligible: raw.totals.eligible ?? 0,
      nudged: raw.totals.nudged ?? 0,
      sharingOn: raw.totals.sharing_on ?? 0,
    },
    sharers: (raw.sharers ?? []).map((s) => ({
      username: s.username,
      rankedCount: s.ranked_count,
      nudged: s.nudged,
    })),
    signupsDaily: raw.signups_daily ?? [],
  }
}

export async function fetchSharingMetrics(): Promise<SharingMetrics> {
  const { data, error } = await supabase.functions.invoke<SharingMetricsRaw>(
    'admin-sharing-metrics',
    { method: 'GET' },
  )
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Empty response from admin-sharing-metrics')
  return { ...data, funnel: mapFunnel(data.funnel) }
}
